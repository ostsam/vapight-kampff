import type { Vapi } from "@vapi-ai/server-sdk";
import type {
  LiveSessionSnapshot,
  OperatorActionName,
} from "@/lib/shared/types";
import {
  applyOperatorOverride,
  selectNextTrap,
  snapshotFromSession,
} from "@/lib/server/coordinator";
import { getDb, type AppDatabase } from "@/lib/server/db/client";
import {
  createTrapAttempt,
  createVerdictSnapshot,
  findSessionById,
  recordOperatorAction,
  updateSession,
} from "@/lib/server/db/repositories";
import { getEnv } from "@/lib/server/env";
import { createId } from "@/lib/server/ids";
import {
  getLiveSnapshot,
  publishLiveEvent,
  setLiveSnapshot,
} from "@/lib/server/live/store";
import { sendControlMessage } from "@/lib/server/vapi/client";
import { operatorOverrideActionToVerdict } from "@/lib/server/vapi/webhook";

export async function executeOperatorAction(
  sessionId: string,
  action: OperatorActionName,
  db: AppDatabase = getDb()
): Promise<{
  snapshot: LiveSessionSnapshot;
  status: "applied" | "queued" | "failed";
}> {
  const session = await findSessionById(db, sessionId);
  if (!session) {
    throw new Error("Session not found.");
  }

  if (session.status === "ended") {
    throw new Error("Cannot control a completed call.");
  }

  let snapshot = (await getLiveSnapshot(sessionId)) ?? snapshotFromSession(session);
  let status: "applied" | "queued" | "failed" = "applied";
  const env = getEnv();

  if (action === "next-trap") {
    const selection = selectNextTrap(snapshot);
    snapshot = selection.snapshot;

    if (selection.trap) {
      await createTrapAttempt(db, {
        id: createId("trap"),
        callSessionId: sessionId,
        trapId: selection.trap.id,
        phase: selection.trap.phase,
        voiceMode: selection.trap.voiceMode,
        prompt: selection.trap.prompt,
        outcome: "operator-triggered",
        metadata: {
          followUpPrompt: selection.trap.followUpPrompt,
        },
      });

      await publishLiveEvent(sessionId, {
        event: "trap.changed",
        data: {
          sessionId,
          trap: selection.trap,
        },
      });
    }
  } else {
    const overrideTarget = operatorOverrideActionToVerdict(action);
    snapshot = applyOperatorOverride(snapshot, overrideTarget);

    await createVerdictSnapshot(db, {
      id: createId("verdict"),
      callSessionId: sessionId,
      humanScore: snapshot.humanScore,
      aiScore: snapshot.aiScore,
      state: snapshot.verdictState,
      rationale: `Operator action applied: ${action}`,
      source: "operator",
    });

    if (action === "transfer-now") {
      if (snapshot.controlUrl) {
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

        try {
          await sendControlMessage(snapshot.controlUrl, message);
          snapshot = {
            ...snapshot,
            transferStatus: "completed",
          };
        } catch {
          status = "failed";
          snapshot = {
            ...snapshot,
            transferStatus: "failed",
          };
        }
      } else {
        status = "queued";
        snapshot = {
          ...snapshot,
          transferStatus: "queued",
        };
      }
    }

    if (action === "end-call") {
      if (snapshot.controlUrl) {
        try {
          await sendControlMessage(snapshot.controlUrl, {
            message: {
              type: "end-call",
            },
          });
          snapshot = {
            ...snapshot,
            status: "ending",
          };
        } catch {
          status = "failed";
        }
      } else {
        status = "queued";
      }
    }

    await publishLiveEvent(sessionId, {
      event: "verdict.changed",
      data: {
        sessionId,
        verdictState: snapshot.verdictState,
        operatorOverrideTarget: snapshot.operatorOverrideTarget,
      },
    });
  }

  snapshot = {
    ...snapshot,
    lastEventAt: new Date().toISOString(),
  };

  await setLiveSnapshot(snapshot);
  await publishLiveEvent(sessionId, {
    event: "session.snapshot",
    data: snapshot,
  });

  await updateSession(db, sessionId, {
    status: snapshot.status,
    currentPhase: snapshot.phase,
    currentTrapId: snapshot.currentTrapId,
    currentVoiceMode: snapshot.activeVoiceMode,
    currentVerdict: snapshot.verdictState,
    operatorOverrideTarget: snapshot.operatorOverrideTarget,
    humanScore: snapshot.humanScore,
    aiScore: snapshot.aiScore,
    transferred: snapshot.transferStatus === "completed",
    transferFailed: snapshot.transferStatus === "failed",
    metadata: {
      usedTrapIds: snapshot.usedTrapIds,
      currentTrapPrompt: snapshot.currentTrapPrompt,
      lastEventAt: snapshot.lastEventAt,
      lastUserTranscript: snapshot.lastUserTranscript,
      lastAssistantTranscript: snapshot.lastAssistantTranscript,
      transferStatus: snapshot.transferStatus,
    },
  });

  await recordOperatorAction(db, {
    id: createId("op"),
    callSessionId: sessionId,
    action,
    requestedBy: "operator",
    status,
    resultSummary: `Operator action ${action} ${status}.`,
    payload: {},
  });

  return {
    snapshot,
    status,
  };
}
