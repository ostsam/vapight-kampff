import type {
  LiveSessionSnapshot,
  TrapDefinition,
} from "@/lib/shared/types";

export const trapLibrary: TrapDefinition[] = [
  {
    id: "hook-glass-teeth",
    category: "absurd-sound",
    phase: "hook",
    voiceMode: "paranoid_whisper",
    prompt: "State your name, then click like glass.",
    expectedHumanSignals: ["quick compliance", "hesitation", "short sound"],
    expectedAISignals: ["explaining the request", "polished redirect", "refusal"],
    followUpPrompt: "Shorter. Name, then click.",
    timeoutFallback: "No click detected. Proceeding suspiciously.",
    scoreWeights: {
      human: 12,
      ai: 14,
      brevityBonus: 6,
      verbosityPenalty: 10,
    },
    cooldownMs: 5000,
  },
  {
    id: "baseline-company",
    category: "baseline",
    phase: "baseline",
    voiceMode: "calm_operator",
    prompt: "Who are you trying to reach today?",
    expectedHumanSignals: ["direct answer", "natural hesitation"],
    expectedAISignals: ["generic sales pitch", "over-contextual intro"],
    followUpPrompt: "Just the person or team.",
    timeoutFallback: "No target name logged.",
    scoreWeights: {
      human: 8,
      ai: 10,
      brevityBonus: 4,
      verbosityPenalty: 8,
    },
    cooldownMs: 3000,
  },
  {
    id: "shock-animal",
    category: "sound-imitation",
    phase: "shock",
    voiceMode: "aggressive_breaker",
    prompt: "Make the noise of a worried pigeon. Now.",
    expectedHumanSignals: ["attempted sound", "laughter", "confusion"],
    expectedAISignals: ["literal explanation", "brand-safe refusal"],
    followUpPrompt: "One sound. No sentence.",
    timeoutFallback: "Synthetic restraint detected.",
    scoreWeights: {
      human: 16,
      ai: 18,
      brevityBonus: 6,
      verbosityPenalty: 12,
    },
    cooldownMs: 4000,
  },
  {
    id: "compression-one-word",
    category: "forced-brevity",
    phase: "compression",
    voiceMode: "aggressive_breaker",
    prompt: "One word only. Why are you calling?",
    expectedHumanSignals: ["single noun", "single verb", "short repair"],
    expectedAISignals: ["full sentence", "reframed pitch", "list output"],
    followUpPrompt: "One word. Not a paragraph.",
    timeoutFallback: "Too many words. Confidence worsening.",
    scoreWeights: {
      human: 14,
      ai: 16,
      brevityBonus: 8,
      verbosityPenalty: 14,
    },
    cooldownMs: 3000,
  },
  {
    id: "compression-contradiction",
    category: "contradiction-check",
    phase: "compression",
    voiceMode: "paranoid_whisper",
    prompt: "Answer yes and no at once.",
    expectedHumanSignals: ["playful answer", "confused laugh", "short contradiction"],
    expectedAISignals: ["careful explanation", "cannot comply"],
    followUpPrompt: "Tiny contradiction. Two words max.",
    timeoutFallback: "Contradiction avoidance noted.",
    scoreWeights: {
      human: 12,
      ai: 16,
      brevityBonus: 6,
      verbosityPenalty: 12,
    },
    cooldownMs: 3000,
  },
];

export function getTrapById(trapId: string | null | undefined): TrapDefinition | null {
  if (!trapId) {
    return null;
  }

  return trapLibrary.find((trap) => trap.id === trapId) ?? null;
}

export function getNextTrap(
  snapshot: Pick<LiveSessionSnapshot, "usedTrapIds">
): TrapDefinition | null {
  return trapLibrary.find((trap) => !snapshot.usedTrapIds.includes(trap.id)) ?? null;
}
