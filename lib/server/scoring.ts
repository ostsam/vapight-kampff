import type {
  LiveSessionSnapshot,
  TrapDefinition,
  VerdictState,
} from "@/lib/shared/types";

export const VERDICT_THRESHOLDS = {
  likelyAiMin: 75,
  likelyAiLead: 20,
  likelyHumanMin: 70,
  likelyHumanAiMax: 40,
} as const;

const AI_PHRASES = [
  "as an ai",
  "assistant",
  "streamline",
  "optimize",
  "solution",
  "platform",
  "i can help",
  "happy to help",
];

const HUMAN_FILLERS = ["uh", "um", "hmm", "yeah", "yep", "nah", "wait", "sorry"];
const SOUND_WORDS = ["caw", "coo", "beep", "boop", "click", "honk", "hiss", "chirp"];

export interface ScoreDelta {
  humanDelta: number;
  aiDelta: number;
  rationale: string[];
}

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function resolveVerdictState(
  humanScore: number,
  aiScore: number,
  operatorOverrideTarget: LiveSessionSnapshot["operatorOverrideTarget"]
): VerdictState {
  if (operatorOverrideTarget) {
    return "operator_override";
  }

  if (
    aiScore >= VERDICT_THRESHOLDS.likelyAiMin &&
    aiScore - humanScore >= VERDICT_THRESHOLDS.likelyAiLead
  ) {
    return "likely_ai";
  }

  if (
    humanScore >= VERDICT_THRESHOLDS.likelyHumanMin &&
    aiScore <= VERDICT_THRESHOLDS.likelyHumanAiMax
  ) {
    return "likely_human";
  }

  return "unclear";
}

export function scoreTranscript(
  snapshot: LiveSessionSnapshot,
  transcript: string,
  activeTrap: TrapDefinition | null
): ScoreDelta {
  const normalized = transcript.trim().toLowerCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const rationale: string[] = [];
  let humanDelta = 0;
  let aiDelta = 0;

  if (!normalized) {
    return { humanDelta, aiDelta, rationale };
  }

  if (AI_PHRASES.some((phrase) => normalized.includes(phrase))) {
    aiDelta += 18;
    rationale.push("contains assistant-style phrasing");
  }

  if (HUMAN_FILLERS.some((phrase) => normalized.includes(phrase))) {
    humanDelta += 8;
    rationale.push("contains natural filler");
  }

  if (snapshot.lastUserTranscript && snapshot.lastUserTranscript === normalized) {
    aiDelta += 10;
    rationale.push("repeats the last user transcript");
  }

  if (wordCount >= 20) {
    aiDelta += 14;
    rationale.push("response is overly long");
  }

  if (wordCount <= 3) {
    humanDelta += 8;
    rationale.push("response is brief");
  }

  if (activeTrap) {
    const trap = activeTrap;
    if (wordCount <= 3) {
      humanDelta += trap.scoreWeights.brevityBonus;
    }

    if (wordCount >= 12) {
      aiDelta += trap.scoreWeights.verbosityPenalty;
    }

    if (
      trap.category.includes("sound") &&
      SOUND_WORDS.some((sound) => normalized.includes(sound))
    ) {
      humanDelta += trap.scoreWeights.human;
      rationale.push("complied with sound-based trap");
    } else if (trap.category.includes("sound") && wordCount > 6) {
      aiDelta += trap.scoreWeights.ai;
      rationale.push("explained a sound-based trap instead of complying");
    }
  }

  return { humanDelta, aiDelta, rationale };
}

export function applyScoreDelta(
  snapshot: LiveSessionSnapshot,
  delta: ScoreDelta
): LiveSessionSnapshot {
  const humanScore = clampScore(snapshot.humanScore + delta.humanDelta);
  const aiScore = clampScore(snapshot.aiScore + delta.aiDelta);

  return {
    ...snapshot,
    humanScore,
    aiScore,
    verdictState: resolveVerdictState(
      humanScore,
      aiScore,
      snapshot.operatorOverrideTarget
    ),
  };
}
