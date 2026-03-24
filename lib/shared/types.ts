export const CALL_MODES = ["production", "demo"] as const;
export type CallMode = (typeof CALL_MODES)[number];

export const CALL_TRANSPORTS = ["pstn", "web"] as const;
export type CallTransport = (typeof CALL_TRANSPORTS)[number];

export const CALL_PHASES = [
  "hook",
  "baseline",
  "shock",
  "compression",
  "resolution",
] as const;
export type CallPhase = (typeof CALL_PHASES)[number];

export const VOICE_MODES = [
  "calm_operator",
  "paranoid_whisper",
  "aggressive_breaker",
] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export const VERDICT_STATES = [
  "likely_human",
  "likely_ai",
  "unclear",
  "operator_override",
] as const;
export type VerdictState = (typeof VERDICT_STATES)[number];

export const OPERATOR_ACTIONS = [
  "force-human",
  "force-ai",
  "next-trap",
  "transfer-now",
  "end-call",
] as const;
export type OperatorActionName = (typeof OPERATOR_ACTIONS)[number];

export const LIVE_EVENT_NAMES = [
  "session.snapshot",
  "transcript.delta",
  "trap.changed",
  "verdict.changed",
  "call.ended",
] as const;
export type LiveEventName = (typeof LIVE_EVENT_NAMES)[number];

export interface TrapScoreWeights {
  human: number;
  ai: number;
  brevityBonus: number;
  verbosityPenalty: number;
}

export interface TrapDefinition {
  id: string;
  category: string;
  phase: CallPhase;
  voiceMode: VoiceMode;
  prompt: string;
  expectedHumanSignals: string[];
  expectedAISignals: string[];
  followUpPrompt: string;
  timeoutFallback: string;
  scoreWeights: TrapScoreWeights;
  cooldownMs: number;
}

export interface LiveSessionSnapshot {
  sessionId: string;
  externalCallId: string | null;
  mode: CallMode;
  transport: CallTransport;
  status: string;
  phase: CallPhase;
  verdictState: VerdictState;
  operatorOverrideTarget: Exclude<VerdictState, "operator_override"> | null;
  humanScore: number;
  aiScore: number;
  activeVoiceMode: VoiceMode;
  currentTrapId: string | null;
  currentTrapPrompt: string | null;
  usedTrapIds: string[];
  controlUrl: string | null;
  listenUrl: string | null;
  label: string | null;
  sourceNumber: string | null;
  transferStatus: "idle" | "queued" | "completed" | "failed";
  startedAt: string;
  endedAt: string | null;
  lastEventAt: string;
  lastUserTranscript: string | null;
  lastAssistantTranscript: string | null;
}

export interface OperatorActionCommand {
  action: OperatorActionName;
}

export interface LiveEvent<TData = unknown> {
  event: LiveEventName;
  data: TData;
}

export interface VapiWebhookEnvelope {
  message: {
    type: string;
    [key: string]: unknown;
  };
}
