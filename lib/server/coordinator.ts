import type {
  CallMode,
  CallTransport,
  LiveSessionSnapshot,
  TrapDefinition,
  VoiceMode,
} from "@/lib/shared/types";
import type { CallSessionRecord } from "@/lib/server/db/repositories";
import { applyScoreDelta, scoreTranscript } from "@/lib/server/scoring";
import { getNextTrap } from "@/lib/server/traps";

export interface SnapshotSeed {
  sessionId: string;
  externalCallId?: string | null;
  mode: CallMode;
  transport: CallTransport;
  label?: string | null;
  sourceNumber?: string | null;
  startedAt?: string;
  status?: string;
}

export function createInitialSnapshot(seed: SnapshotSeed): LiveSessionSnapshot {
  const startedAt = seed.startedAt ?? new Date().toISOString();

  return {
    sessionId: seed.sessionId,
    externalCallId: seed.externalCallId ?? null,
    mode: seed.mode,
    transport: seed.transport,
    status: seed.status ?? "created",
    phase: "hook",
    verdictState: "unclear",
    operatorOverrideTarget: null,
    humanScore: 0,
    aiScore: 0,
    activeVoiceMode: "calm_operator",
    currentTrapId: null,
    currentTrapPrompt: null,
    usedTrapIds: [],
    controlUrl: null,
    listenUrl: null,
    label: seed.label ?? null,
    sourceNumber: seed.sourceNumber ?? null,
    transferStatus: "idle",
    startedAt,
    endedAt: null,
    lastEventAt: startedAt,
    lastUserTranscript: null,
    lastAssistantTranscript: null,
  };
}

export function snapshotFromSession(session: CallSessionRecord): LiveSessionSnapshot {
  return {
    sessionId: session.id,
    externalCallId: session.externalCallId ?? null,
    mode: session.mode,
    transport: session.transport,
    status: session.status,
    phase: session.currentPhase,
    verdictState: session.currentVerdict,
    operatorOverrideTarget:
      (session.operatorOverrideTarget as LiveSessionSnapshot["operatorOverrideTarget"]) ??
      null,
    humanScore: session.humanScore,
    aiScore: session.aiScore,
    activeVoiceMode: session.currentVoiceMode,
    currentTrapId: session.currentTrapId ?? null,
    currentTrapPrompt:
      typeof session.metadata.currentTrapPrompt === "string"
        ? session.metadata.currentTrapPrompt
        : null,
    usedTrapIds: Array.isArray(session.metadata.usedTrapIds)
      ? (session.metadata.usedTrapIds as string[])
      : [],
    controlUrl: session.controlUrl ?? null,
    listenUrl: session.listenUrl ?? null,
    label: session.label ?? null,
    sourceNumber: session.sourceNumber ?? null,
    transferStatus:
      typeof session.metadata.transferStatus === "string"
        ? (session.metadata.transferStatus as LiveSessionSnapshot["transferStatus"])
        : session.transferFailed
          ? "failed"
          : session.transferred
            ? "completed"
            : "idle",
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    lastEventAt:
      typeof session.metadata.lastEventAt === "string"
        ? session.metadata.lastEventAt
        : session.updatedAt.toISOString(),
    lastUserTranscript:
      typeof session.metadata.lastUserTranscript === "string"
        ? session.metadata.lastUserTranscript
        : null,
    lastAssistantTranscript:
      typeof session.metadata.lastAssistantTranscript === "string"
        ? session.metadata.lastAssistantTranscript
        : null,
  };
}

export function selectNextTrap(
  snapshot: LiveSessionSnapshot
): { snapshot: LiveSessionSnapshot; trap: TrapDefinition | null } {
  const trap = getNextTrap(snapshot);

  if (!trap) {
    return {
      snapshot: {
        ...snapshot,
        phase: "resolution",
        currentTrapId: null,
        currentTrapPrompt: null,
        activeVoiceMode: "calm_operator",
      },
      trap: null,
    };
  }

  return {
    trap,
    snapshot: {
      ...snapshot,
      phase: trap.phase,
      currentTrapId: trap.id,
      currentTrapPrompt: trap.prompt,
      activeVoiceMode: trap.voiceMode,
      usedTrapIds: [...snapshot.usedTrapIds, trap.id],
      lastEventAt: new Date().toISOString(),
    },
  };
}

export function applyTranscriptToSnapshot(
  snapshot: LiveSessionSnapshot,
  transcript: string,
  speaker: "user" | "assistant"
): {
  snapshot: LiveSessionSnapshot;
  humanDelta: number;
  aiDelta: number;
  rationale: string[];
} {
  if (speaker === "assistant") {
    return {
      snapshot: {
        ...snapshot,
        lastAssistantTranscript: transcript.trim().toLowerCase(),
        lastEventAt: new Date().toISOString(),
      },
      humanDelta: 0,
      aiDelta: 0,
      rationale: [],
    };
  }

  const activeTrap = snapshot.currentTrapPrompt
    ? ({
        id: snapshot.currentTrapId ?? "unknown",
        category: "active",
        phase: snapshot.phase,
        voiceMode: snapshot.activeVoiceMode as VoiceMode,
        prompt: snapshot.currentTrapPrompt,
        expectedHumanSignals: [],
        expectedAISignals: [],
        followUpPrompt: "",
        timeoutFallback: "",
        scoreWeights: {
          human: 0,
          ai: 0,
          brevityBonus: 0,
          verbosityPenalty: 0,
        },
        cooldownMs: 0,
      } satisfies TrapDefinition)
    : null;

  const delta = scoreTranscript(snapshot, transcript, activeTrap);

  return {
    snapshot: {
      ...applyScoreDelta(snapshot, delta),
      lastUserTranscript: transcript.trim().toLowerCase(),
      lastEventAt: new Date().toISOString(),
    },
    humanDelta: delta.humanDelta,
    aiDelta: delta.aiDelta,
    rationale: delta.rationale,
  };
}

export function applyOperatorOverride(
  snapshot: LiveSessionSnapshot,
  target: LiveSessionSnapshot["operatorOverrideTarget"]
): LiveSessionSnapshot {
  return {
    ...snapshot,
    operatorOverrideTarget: target,
    verdictState: target ? "operator_override" : snapshot.verdictState,
    lastEventAt: new Date().toISOString(),
  };
}
