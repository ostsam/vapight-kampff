import { createInitialSnapshot } from "@/lib/server/coordinator";
import { getDb, type AppDatabase } from "@/lib/server/db/client";
import { createSession, updateSession } from "@/lib/server/db/repositories";
import { getEnv } from "@/lib/server/env";
import { createId } from "@/lib/server/ids";
import { publishLiveEvent, setLiveSnapshot } from "@/lib/server/live/store";
import { createOutboundDemoCall } from "@/lib/server/vapi/client";

export async function startDemoSession(
  input: {
    transport: "web" | "pstn";
    targetNumber?: string;
    label?: string | null;
  },
  db: AppDatabase = getDb()
): Promise<
  | {
      sessionId: string;
      externalCallId: string;
    }
  | {
      sessionId: string;
      assistantId: string;
      publicKey: string;
      metadata: Record<string, unknown>;
    }
> {
  const env = getEnv();
  const sessionId = createId("session");
  const label = input.label?.trim() || null;

  await createSession(db, {
    id: sessionId,
    mode: "demo",
    transport: input.transport,
    status: input.transport === "pstn" ? "queued" : "created",
    label,
    assistantId: env.VAPI_ASSISTANT_ID_DEMO_WEB,
    workflowId: env.VAPI_WORKFLOW_ID_PRODUCTION,
    metadata: {},
  });

  let snapshot = createInitialSnapshot({
    sessionId,
    mode: "demo",
    transport: input.transport,
    label,
    status: input.transport === "pstn" ? "queued" : "created",
  });

  await setLiveSnapshot(snapshot);
  await publishLiveEvent(sessionId, {
    event: "session.snapshot",
    data: snapshot,
  });

  if (input.transport === "pstn") {
    if (!input.targetNumber) {
      throw new Error("targetNumber is required for PSTN demo calls.");
    }

    const call = await createOutboundDemoCall({
      sessionId,
      targetNumber: input.targetNumber,
      label,
    });

    snapshot = {
      ...snapshot,
      externalCallId: call.id,
      status: call.status ?? "queued",
      controlUrl: call.monitor?.controlUrl ?? null,
      listenUrl: call.monitor?.listenUrl ?? null,
      lastEventAt: new Date().toISOString(),
    };

    await updateSession(db, sessionId, {
      externalCallId: call.id,
      externalProviderCallId: call.phoneCallProviderId,
      status: call.status ?? "queued",
      controlUrl: call.monitor?.controlUrl,
      listenUrl: call.monitor?.listenUrl,
      metadata: {
        usedTrapIds: snapshot.usedTrapIds,
        currentTrapPrompt: snapshot.currentTrapPrompt,
        lastEventAt: snapshot.lastEventAt,
        lastUserTranscript: snapshot.lastUserTranscript,
        lastAssistantTranscript: snapshot.lastAssistantTranscript,
        transferStatus: snapshot.transferStatus,
      },
    });

    await setLiveSnapshot(snapshot);
    await publishLiveEvent(sessionId, {
      event: "session.snapshot",
      data: snapshot,
    });

    return {
      sessionId,
      externalCallId: call.id,
    };
  }

  return {
    sessionId,
    assistantId: env.VAPI_ASSISTANT_ID_DEMO_WEB,
    publicKey: env.NEXT_PUBLIC_VAPI_PUBLIC_KEY,
    metadata: {
      sessionId,
      label,
      mode: "demo",
      transport: "web",
      assistantOverrides: {
        variableValues: {
          sessionId,
          label,
          mode: "demo",
          transport: "web",
        },
      },
    },
  };
}
