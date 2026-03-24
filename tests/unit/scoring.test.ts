import { describe, expect, it } from "vitest";
import { createInitialSnapshot } from "@/lib/server/coordinator";
import {
  applyScoreDelta,
  resolveVerdictState,
  scoreTranscript,
} from "@/lib/server/scoring";
import { trapLibrary } from "@/lib/server/traps";

describe("scoring", () => {
  it("marks likely AI when the threshold is crossed", () => {
    expect(resolveVerdictState(20, 80, null)).toBe("likely_ai");
  });

  it("lets operator override win over heuristic verdicts", () => {
    expect(resolveVerdictState(95, 5, "likely_ai")).toBe("operator_override");
  });

  it("scores assistant-like verbose language toward AI", () => {
    const snapshot = createInitialSnapshot({
      sessionId: "session_1",
      mode: "demo",
      transport: "web",
    });

    const delta = scoreTranscript(
      snapshot,
      "As an AI assistant I can help streamline your sales platform today.",
      trapLibrary[0]
    );

    expect(delta.aiDelta).toBeGreaterThan(delta.humanDelta);
  });

  it("applies the delta and clamps the scores", () => {
    const snapshot = createInitialSnapshot({
      sessionId: "session_2",
      mode: "production",
      transport: "pstn",
    });

    const updated = applyScoreDelta(snapshot, {
      humanDelta: 150,
      aiDelta: 5,
      rationale: [],
    });

    expect(updated.humanScore).toBe(100);
    expect(updated.aiScore).toBe(5);
  });
});
