import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialSnapshot } from "@/lib/server/coordinator";
import { createSession } from "@/lib/server/db/repositories";
import { createTestDb, applyTestEnv } from "@/tests/helpers";

const snapshotMap = new Map<string, unknown>();
const sendControlMessage = vi.fn(async () => undefined);
const publishedEvents: Array<{ sessionId: string; event: unknown }> = [];

vi.mock("@/lib/server/live/store", () => ({
  getLiveSnapshot: vi.fn(async (sessionId: string) => snapshotMap.get(sessionId) ?? null),
  setLiveSnapshot: vi.fn(async (snapshot: { sessionId: string }) => {
    snapshotMap.set(snapshot.sessionId, snapshot);
  }),
  publishLiveEvent: vi.fn(async (sessionId: string, event: unknown) => {
    publishedEvents.push({ sessionId, event });
  }),
}));

vi.mock("@/lib/server/vapi/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/vapi/client")>(
    "@/lib/server/vapi/client"
  );

  return {
    ...actual,
    sendControlMessage,
  };
});

describe("operator action integration", () => {
  beforeEach(() => {
    snapshotMap.clear();
    publishedEvents.length = 0;
    sendControlMessage.mockClear();
    applyTestEnv();
  });

  it("executes transfer-now with a control url", async () => {
    const db = await createTestDb();

    await createSession(db, {
      id: "session_controlled",
      mode: "demo",
      transport: "web",
      status: "in-progress",
      controlUrl: "https://control.example.test",
      metadata: {},
    });

    snapshotMap.set(
      "session_controlled",
      {
        ...createInitialSnapshot({
          sessionId: "session_controlled",
          mode: "demo",
          transport: "web",
          status: "in-progress",
        }),
        controlUrl: "https://control.example.test",
      }
    );

    const { executeOperatorAction } = await import("@/lib/server/actions");
    const result = await executeOperatorAction("session_controlled", "transfer-now", db);

    expect(result.status).toBe("applied");
    expect(result.snapshot.transferStatus).toBe("completed");
    expect(sendControlMessage).toHaveBeenCalledOnce();
  });

  it("fails on stale sessions", async () => {
    const db = await createTestDb();
    const { executeOperatorAction } = await import("@/lib/server/actions");

    await expect(
      executeOperatorAction("missing-session", "force-human", db)
    ).rejects.toThrow("Session not found.");
  });

  it("rejects control on already-ended calls", async () => {
    const db = await createTestDb();

    await createSession(db, {
      id: "session_ended",
      mode: "production",
      transport: "pstn",
      status: "ended",
      metadata: {},
    });

    const { executeOperatorAction } = await import("@/lib/server/actions");

    await expect(
      executeOperatorAction("session_ended", "end-call", db)
    ).rejects.toThrow("Cannot control a completed call.");
  });
});
