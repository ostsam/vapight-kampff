import { describe, expect, it } from "vitest";
import {
  appendCallEvent,
  createSession,
  createTrapAttempt,
  createVerdictSnapshot,
  getReplay,
  recordOperatorAction,
} from "@/lib/server/db/repositories";
import { createTestDb } from "@/tests/helpers";

describe("repository integration", () => {
  it("creates a session and reconstructs replay state", async () => {
    const db = await createTestDb();

    await createSession(db, {
      id: "session_replay",
      mode: "demo",
      transport: "web",
      status: "in-progress",
      label: "Replay Test",
      metadata: {},
    });

    await appendCallEvent(db, {
      id: "evt_1",
      callSessionId: "session_replay",
      externalCallId: "call_1",
      eventType: "transcript",
      speaker: "user",
      transcriptType: "final",
      transcript: "hello there",
      payload: { transcript: "hello there" },
    });

    await createTrapAttempt(db, {
      id: "trap_1",
      callSessionId: "session_replay",
      trapId: "hook-glass-teeth",
      phase: "hook",
      voiceMode: "paranoid_whisper",
      prompt: "State your name, then click like glass.",
      metadata: {},
    });

    await createVerdictSnapshot(db, {
      id: "verdict_1",
      callSessionId: "session_replay",
      humanScore: 12,
      aiScore: 4,
      state: "unclear",
      rationale: "Initial scoring",
      source: "heuristic",
    });

    await recordOperatorAction(db, {
      id: "op_1",
      callSessionId: "session_replay",
      action: "next-trap",
      requestedBy: "operator",
      status: "applied",
      resultSummary: "Moved to next trap.",
      payload: {},
    });

    const replay = await getReplay(db, "session_replay");

    expect(replay.session?.label).toBe("Replay Test");
    expect(replay.events).toHaveLength(1);
    expect(replay.trapAttempts).toHaveLength(1);
    expect(replay.verdictSnapshots).toHaveLength(1);
    expect(replay.operatorActions).toHaveLength(1);
  });
});
