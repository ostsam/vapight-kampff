import type { Vapi } from "@vapi-ai/server-sdk";
import type {
  CallMode,
  CallTransport,
  LiveEvent,
  LiveSessionSnapshot,
  OperatorActionName,
  TrapDefinition,
  VapiWebhookEnvelope,
} from "@/lib/shared/types";
import {
  applyOperatorOverride,
  applyTranscriptToSnapshot,
  createInitialSnapshot,
  selectNextTrap,
  snapshotFromSession,
} from "@/lib/server/coordinator";
import { getDb, type AppDatabase } from "@/lib/server/db/client";
import {
  appendCallEvent,
  createTrapAttempt,
  createVerdictSnapshot,
  ensureSession,
  findSessionById,
  getLatestTrapAttempt,
  markWebhookDeliveryProcessed,
  registerWebhookDelivery,
  updateSession,
} from "@/lib/server/db/repositories";
import { getEnv } from "@/lib/server/env";
import { createId } from "@/lib/server/ids";
import {
  getLiveSnapshot,
  publishLiveEvent,
  setLiveSnapshot,
} from "@/lib/server/live/store";
import { getTrapById } from "@/lib/server/traps";
import { sendControlMessage } from "@/lib/server/vapi/client";
import {
  deriveWebhookDedupeKey,
  deriveWebhookPayloadHash,
  verifyVapiSignature,
} from "@/lib/server/vapi/signature";
import {
  isSupportedMessageType,
  parseWebhookEnvelope,
  type SupportedVapiMessage,
} from "@/lib/server/vapi/types";

interface VariableValues {
  sessionId?: string;
  label?: string;
  mode?: CallMode;
  transport?: CallTransport;
}

export interface VapiWebhookResult {
  status: number;
  body: object | null;
  deferred: {
    deliveryId: string;
    envelope: VapiWebhookEnvelope;
    rawBody: string;
  } | null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readVariableValues(message: {
  call?: {
    assistantOverrides?: { variableValues?: Record<string, unknown> };
    workflowOverrides?: { variableValues?: Record<string, unknown> };
  };
}): VariableValues {
  const assistantValues = message.call?.assistantOverrides?.variableValues ?? {};
  const workflowValues = message.call?.workflowOverrides?.variableValues ?? {};

  return {
    sessionId: readString(assistantValues.sessionId) ?? readString(workflowValues.sessionId) ?? undefined,
    label: readString(assistantValues.label) ?? readString(workflowValues.label) ?? undefined,
    mode:
      (readString(assistantValues.mode) as CallMode | null) ??
      (readString(workflowValues.mode) as CallMode | null) ??
      undefined,
    transport:
      (readString(assistantValues.transport) as CallTransport | null) ??
      (readString(workflowValues.transport) as CallTransport | null) ??
      undefined,
  };
}

function resolveSessionId(message: {
  call?: {
    id?: string;
    assistantOverrides?: { variableValues?: Record<string, unknown> };
    workflowOverrides?: { variableValues?: Record<string, unknown> };
  };
}): string | null {
  const variableValues = readVariableValues(message);
  return variableValues.sessionId ?? readString(message.call?.id);
}

function inferModeAndTransport(message: SupportedVapiMessage): {
  mode: CallMode;
  transport: CallTransport;
  label: string | null;
} {
  const variableValues = readVariableValues(message);
  const callType = readString(message.call?.type);

  const transport =
    variableValues.transport ??
    (callType?.includes("Phone") ? "pstn" : "web");

  return {
    mode: variableValues.mode ?? "production",
    transport,
    label: variableValues.label ?? null,
  };
}

function resolveSnapshotSeed(message: SupportedVapiMessage): LiveSessionSnapshot {
  const sessionId = resolveSessionId(message);
  if (!sessionId) {
    throw new Error("Unable to resolve a call session id from the Vapi message.");
  }

  const inferred = inferModeAndTransport(message);
  return createInitialSnapshot({
    sessionId,
    externalCallId: readString(message.call?.id),
    mode: inferred.mode,
    transport: inferred.transport,
    label: inferred.label,
    sourceNumber: readString(message.customer?.number),
    startedAt: readString(message.call?.startedAt) ?? undefined,
    status: readString((message as { status?: string }).status) ?? "created",
  });
}

async function getOrCreateSnapshot(
  message: SupportedVapiMessage
): Promise<LiveSessionSnapshot> {
  const seed = resolveSnapshotSeed(message);
  const snapshot = await getLiveSnapshot(seed.sessionId);
  return snapshot ?? seed;
}

function buildTranscriptEventPayload(
  message: Vapi.ServerMessageTranscript
): LiveEvent<{
  sessionId: string;
  speaker: string;
  transcript: string;
  transcriptType: string;
}> {
  return {
    event: "transcript.delta",
    data: {
      sessionId: resolveSessionId(message) ?? "",
      speaker: message.role,
      transcript: message.transcript,
      transcriptType: message.transcriptType,
    },
  };
}

function buildSnapshotEvent(snapshot: LiveSessionSnapshot): LiveEvent<LiveSessionSnapshot> {
  return {
    event: "session.snapshot",
    data: snapshot,
  };
}

async function controlTransfer(snapshot: LiveSessionSnapshot): Promise<boolean> {
  const controlUrl = snapshot.controlUrl;
  if (!controlUrl) {
    return false;
  }

  const env = getEnv();
  const message: Vapi.ClientInboundMessage = {
    message: {
      type: "transfer",
      content: "You sound gloriously human. One sec, transferring you.",
      destination: {
        type: "number",
        number: env.SALES_TRANSFER_NUMBER,
        description: "Sales transfer destination",
        message: "You sound gloriously human. One sec, transferring you.",
      },
    },
  };

  await sendControlMessage(controlUrl, message);
  return true;
}

async function controlEndCall(snapshot: LiveSessionSnapshot): Promise<boolean> {
  const controlUrl = snapshot.controlUrl;
  if (!controlUrl) {
    return false;
  }

  await sendControlMessage(controlUrl, {
    message: {
      type: "end-call",
    },
  });

  return true;
}

async function buildToolCallResult(
  message: Vapi.ServerMessageToolCalls,
  toolCall: Vapi.ToolCall
): Promise<Vapi.ToolCallResult> {
  const snapshot = await getOrCreateSnapshot(message);
  const functionName = toolCall.function.name;

  if (functionName === "get_next_trap") {
    const selection = selectNextTrap(snapshot);
    await setLiveSnapshot(selection.snapshot);
    await publishLiveEvent(selection.snapshot.sessionId, buildSnapshotEvent(selection.snapshot));

    if (selection.trap) {
      await publishLiveEvent(selection.snapshot.sessionId, {
        event: "trap.changed",
        data: {
          trap: selection.trap,
          sessionId: selection.snapshot.sessionId,
        },
      });
    }

    return {
      name: functionName,
      toolCallId: toolCall.id,
      result: JSON.stringify({
        trap: selection.trap,
        verdictState: selection.snapshot.verdictState,
      }),
    };
  }

  if (functionName === "transfer_to_human") {
    const nextSnapshot: LiveSessionSnapshot = {
      ...applyOperatorOverride(snapshot, "likely_human"),
      transferStatus: "queued",
    };

    let performed = false;
    try {
      performed = await controlTransfer(nextSnapshot);
    } catch {
      performed = false;
    }

    const updatedSnapshot: LiveSessionSnapshot = {
      ...nextSnapshot,
      transferStatus: performed ? "completed" : "queued",
    };

    await setLiveSnapshot(updatedSnapshot);
    await publishLiveEvent(updatedSnapshot.sessionId, buildSnapshotEvent(updatedSnapshot));
    await publishLiveEvent(updatedSnapshot.sessionId, {
      event: "verdict.changed",
      data: {
        sessionId: updatedSnapshot.sessionId,
        verdictState: updatedSnapshot.verdictState,
        operatorOverrideTarget: updatedSnapshot.operatorOverrideTarget,
      },
    });

    return {
      name: functionName,
      toolCallId: toolCall.id,
      result: JSON.stringify({
        action: "transfer",
        performed,
        destinationNumber: getEnv().SALES_TRANSFER_NUMBER,
        message: "You sound gloriously human. One sec, transferring you.",
      }),
    };
  }

  if (functionName === "end_screening_call") {
    const nextSnapshot: LiveSessionSnapshot = {
      ...applyOperatorOverride(snapshot, "likely_ai"),
      transferStatus: snapshot.transferStatus,
    };

    let performed = false;
    try {
      performed = await controlEndCall(nextSnapshot);
    } catch {
      performed = false;
    }

    const updatedSnapshot: LiveSessionSnapshot = {
      ...nextSnapshot,
      status: performed ? "ending" : nextSnapshot.status,
    };

    await setLiveSnapshot(updatedSnapshot);
    await publishLiveEvent(updatedSnapshot.sessionId, buildSnapshotEvent(updatedSnapshot));
    await publishLiveEvent(updatedSnapshot.sessionId, {
      event: "verdict.changed",
      data: {
        sessionId: updatedSnapshot.sessionId,
        verdictState: updatedSnapshot.verdictState,
        operatorOverrideTarget: updatedSnapshot.operatorOverrideTarget,
      },
    });

    return {
      name: functionName,
      toolCallId: toolCall.id,
      result: JSON.stringify({
        action: "end-call",
        performed,
        message: "Denied. Synthetic pitch detected. Goodbye.",
      }),
    };
  }

  return {
    name: functionName,
    toolCallId: toolCall.id,
    error: `Unsupported tool: ${functionName}`,
  };
}

async function buildToolCallResponse(
  message: Vapi.ServerMessageToolCalls
): Promise<Vapi.ServerMessageResponseToolCalls> {
  const results = await Promise.all(
    message.toolCallList.map((toolCall: Vapi.ToolCall) =>
      buildToolCallResult(message, toolCall)
    )
  );

  return { results };
}

function buildAssistantRequestResponse(
  message: Vapi.ServerMessageAssistantRequest
): Vapi.ServerMessageResponseAssistantRequest {
  const env = getEnv();
  const sessionId = resolveSessionId(message) ?? readString(message.call?.id);

  return {
    workflowId: env.VAPI_WORKFLOW_ID_PRODUCTION,
    workflowOverrides: {
      variableValues: {
        sessionId,
        mode: "production",
        transport: "pstn",
      },
    },
  };
}

export async function handleIncomingVapiWebhook(
  request: {
    headers: Headers;
    rawBody: string;
  },
  db: AppDatabase = getDb()
): Promise<VapiWebhookResult> {
  const env = getEnv();
  const signature = request.headers.get("x-vapi-signature");

  if (!verifyVapiSignature(request.rawBody, signature, env.VAPI_WEBHOOK_SECRET)) {
    return {
      status: 401,
      body: { error: "Invalid Vapi signature." },
      deferred: null,
    };
  }

  const envelope = parseWebhookEnvelope(request.rawBody);
  if (!isSupportedMessageType(envelope.message.type)) {
    return {
      status: 204,
      body: null,
      deferred: null,
    };
  }

  const message = envelope.message as SupportedVapiMessage;
  const messageType = message.type ?? envelope.message.type;
  const dedupeKey = deriveWebhookDedupeKey(request.rawBody);
  const payloadHash = deriveWebhookPayloadHash(request.rawBody);

  const registration = await registerWebhookDelivery(db, {
    dedupeKey,
    externalCallId: readString(message.call?.id),
    messageType,
    payloadHash,
    rawBody: request.rawBody,
    payload: envelope as unknown as Record<string, unknown>,
  });

  if (registration.duplicate) {
    return {
      status: 204,
      body: null,
      deferred: null,
    };
  }

  if (message.type === "assistant-request") {
    return {
      status: 200,
      body: buildAssistantRequestResponse(message),
      deferred: {
        deliveryId: registration.delivery.id,
        envelope,
        rawBody: request.rawBody,
      },
    };
  }

  if (message.type === "tool-calls") {
    return {
      status: 200,
      body: await buildToolCallResponse(message),
      deferred: {
        deliveryId: registration.delivery.id,
        envelope,
        rawBody: request.rawBody,
      },
    };
  }

  return {
    status: 204,
    body: null,
    deferred: {
      deliveryId: registration.delivery.id,
      envelope,
      rawBody: request.rawBody,
    },
  };
}

function inferSpeaker(message: SupportedVapiMessage): string | null {
  if ("role" in message && typeof message.role === "string") {
    return message.role;
  }

  return null;
}

function normalizeEventOccurredAt(message: SupportedVapiMessage): Date {
  if (typeof message.timestamp === "number") {
    return new Date(message.timestamp);
  }

  if (readString(message.call?.updatedAt)) {
    return new Date(message.call!.updatedAt!);
  }

  return new Date();
}

async function persistTrapSelection(
  db: AppDatabase,
  sessionId: string,
  snapshot: LiveSessionSnapshot,
  trap: TrapDefinition
): Promise<void> {
  await createTrapAttempt(db, {
    id: createId("trap"),
    callSessionId: sessionId,
    trapId: trap.id,
    phase: trap.phase,
    voiceMode: trap.voiceMode,
    prompt: trap.prompt,
    metadata: {
      followUpPrompt: trap.followUpPrompt,
      timeoutFallback: trap.timeoutFallback,
    },
  });

  await updateSession(db, sessionId, {
    currentPhase: snapshot.phase,
    currentTrapId: snapshot.currentTrapId,
    currentVoiceMode: snapshot.activeVoiceMode,
    metadata: {
      usedTrapIds: snapshot.usedTrapIds,
      currentTrapPrompt: snapshot.currentTrapPrompt,
      lastEventAt: snapshot.lastEventAt,
      lastUserTranscript: snapshot.lastUserTranscript,
      lastAssistantTranscript: snapshot.lastAssistantTranscript,
      transferStatus: snapshot.transferStatus,
    },
  });
}

export async function processAcceptedWebhookMessage(
  input: {
    deliveryId: string;
    envelope: VapiWebhookEnvelope;
    rawBody: string;
  },
  db: AppDatabase = getDb()
): Promise<void> {
  const message = input.envelope.message as SupportedVapiMessage;
  const messageType = message.type ?? input.envelope.message.type;
  const seed = resolveSnapshotSeed(message);
  const existingSession =
    (await findSessionById(db, seed.sessionId)) ??
    (seed.externalCallId
      ? await ensureSession(db, {
          id: seed.sessionId,
          externalCallId: seed.externalCallId,
          externalProviderCallId: readString(message.call?.phoneCallProviderId),
          mode: seed.mode,
          transport: seed.transport,
          status: seed.status,
          sourceNumber: seed.sourceNumber,
          label: seed.label,
          assistantId: readString(message.call?.assistantId),
          workflowId: readString(message.call?.workflowId),
          controlUrl: readString(message.call?.monitor?.controlUrl),
          listenUrl: readString(message.call?.monitor?.listenUrl),
          currentPhase: seed.phase,
          currentVoiceMode: seed.activeVoiceMode,
          currentVerdict: seed.verdictState,
          metadata: {},
        })
      : null);

  const session =
    existingSession ??
    (await ensureSession(db, {
      id: seed.sessionId,
      externalCallId: seed.externalCallId,
      externalProviderCallId: readString(message.call?.phoneCallProviderId),
      mode: seed.mode,
      transport: seed.transport,
      status: seed.status,
      sourceNumber: seed.sourceNumber,
      label: seed.label,
      assistantId: readString(message.call?.assistantId),
      workflowId: readString(message.call?.workflowId),
      controlUrl: readString(message.call?.monitor?.controlUrl),
      listenUrl: readString(message.call?.monitor?.listenUrl),
      currentPhase: seed.phase,
      currentVoiceMode: seed.activeVoiceMode,
      currentVerdict: seed.verdictState,
      metadata: {},
    }));

  let snapshot = (await getLiveSnapshot(session.id)) ?? snapshotFromSession(session);

  if (readString(message.call?.id)) {
    snapshot = {
      ...snapshot,
      externalCallId: readString(message.call?.id),
      controlUrl: readString(message.call?.monitor?.controlUrl) ?? snapshot.controlUrl,
      listenUrl: readString(message.call?.monitor?.listenUrl) ?? snapshot.listenUrl,
    };
  }

  await appendCallEvent(db, {
    id: createId("evt"),
    callSessionId: session.id,
    externalCallId: readString(message.call?.id),
    eventType: messageType,
    speaker: inferSpeaker(message),
    transcriptType:
      "transcriptType" in message ? readString(message.transcriptType) : null,
    transcript:
      "transcript" in message ? readString(message.transcript) : null,
    turn: "turn" in message && typeof message.turn === "number" ? message.turn : null,
    occurredAt: normalizeEventOccurredAt(message),
    payload: message as unknown as Record<string, unknown>,
  });

  if (message.type === "transcript") {
    const transcriptMessage = message as Vapi.ServerMessageTranscript;
    if (transcriptMessage.role === "assistant") {
      snapshot = applyTranscriptToSnapshot(
        snapshot,
        transcriptMessage.transcript,
        "assistant"
      ).snapshot;
    } else if (transcriptMessage.transcriptType === "final") {
      const scoring = applyTranscriptToSnapshot(
        snapshot,
        transcriptMessage.transcript,
        "user"
      );
      snapshot = scoring.snapshot;

      if (scoring.humanDelta !== 0 || scoring.aiDelta !== 0) {
        await createVerdictSnapshot(db, {
          id: createId("verdict"),
          callSessionId: session.id,
          humanScore: snapshot.humanScore,
          aiScore: snapshot.aiScore,
          state: snapshot.verdictState,
          rationale:
            scoring.rationale.length > 0
              ? scoring.rationale.join("; ")
              : "Transcript received without heuristic change.",
          source: "heuristic",
        });
      }
    }

    await publishLiveEvent(session.id, buildTranscriptEventPayload(transcriptMessage));
  }

  if (message.type === "tool-calls") {
    const latestAttempt = await getLatestTrapAttempt(db, session.id);
    const activeTrap = getTrapById(snapshot.currentTrapId);
    if (activeTrap && latestAttempt?.trapId !== activeTrap.id) {
      await persistTrapSelection(db, session.id, snapshot, activeTrap);
    }
  }

  if (message.type === "status-update") {
    const statusMessage = message as Vapi.ServerMessageStatusUpdate;
    snapshot = {
      ...snapshot,
      status: statusMessage.status,
      lastEventAt: new Date().toISOString(),
      endedAt:
        statusMessage.status === "ended"
          ? readString(statusMessage.call?.endedAt) ?? new Date().toISOString()
          : snapshot.endedAt,
      transferStatus:
        statusMessage.status === "forwarding"
          ? "queued"
          : snapshot.transferStatus,
    };
  }

  if (message.type === "speech-update") {
    const speechMessage = message as Vapi.ServerMessageSpeechUpdate;
    snapshot = {
      ...snapshot,
      lastEventAt: new Date().toISOString(),
      activeVoiceMode:
        speechMessage.role === "assistant"
          ? snapshot.activeVoiceMode
          : snapshot.activeVoiceMode,
    };
  }

  if (message.type === "end-of-call-report") {
    const reportMessage = message as Vapi.ServerMessageEndOfCallReport;
    snapshot = {
      ...snapshot,
      status: "ended",
      endedAt: readString(reportMessage.endedAt) ?? new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
    };

    await publishLiveEvent(session.id, {
      event: "call.ended",
      data: {
        sessionId: session.id,
        endedAt: snapshot.endedAt,
        endedReason: reportMessage.endedReason,
      },
    });
  }

  await setLiveSnapshot(snapshot);
  await publishLiveEvent(session.id, buildSnapshotEvent(snapshot));

  await updateSession(db, session.id, {
    externalCallId: snapshot.externalCallId,
    externalProviderCallId: readString(message.call?.phoneCallProviderId),
    status: snapshot.status,
    sourceNumber: snapshot.sourceNumber,
    label: snapshot.label,
    assistantId: readString(message.call?.assistantId),
    workflowId: readString(message.call?.workflowId),
    currentPhase: snapshot.phase,
    currentTrapId: snapshot.currentTrapId,
    currentVoiceMode: snapshot.activeVoiceMode,
    currentVerdict: snapshot.verdictState,
    operatorOverrideTarget: snapshot.operatorOverrideTarget,
    humanScore: snapshot.humanScore,
    aiScore: snapshot.aiScore,
    transferred: snapshot.transferStatus === "completed",
    transferFailed: snapshot.transferStatus === "failed",
    controlUrl: readString(message.call?.monitor?.controlUrl),
    listenUrl: readString(message.call?.monitor?.listenUrl),
    recordingUrl:
      "artifact" in message ? readString(message.artifact?.recordingUrl) : undefined,
    summary:
      "analysis" in message
        ? readString(readRecord(message.analysis)?.summary)
        : "summary" in message
          ? readString(message.summary)
          : undefined,
    endedAt: snapshot.endedAt ? new Date(snapshot.endedAt) : undefined,
    metadata: {
      usedTrapIds: snapshot.usedTrapIds,
      currentTrapPrompt: snapshot.currentTrapPrompt,
      lastEventAt: snapshot.lastEventAt,
      lastUserTranscript: snapshot.lastUserTranscript,
      lastAssistantTranscript: snapshot.lastAssistantTranscript,
      transferStatus: snapshot.transferStatus,
    },
  });

  await markWebhookDeliveryProcessed(db, input.deliveryId);
}

export function operatorOverrideActionToVerdict(
  action: OperatorActionName
): LiveSessionSnapshot["operatorOverrideTarget"] {
  switch (action) {
    case "force-human":
    case "transfer-now":
      return "likely_human";
    case "force-ai":
    case "end-call":
      return "likely_ai";
    default:
      return null;
  }
}
