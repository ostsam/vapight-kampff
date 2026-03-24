import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webhookDeliveries } from "@/lib/server/db/schema";
import { buildSignedHeaders, createTestDb, applyTestEnv } from "@/tests/helpers";

const snapshotMap = new Map<string, unknown>();
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

describe("Vapi webhook integration", () => {
  beforeEach(() => {
    snapshotMap.clear();
    publishedEvents.length = 0;
    applyTestEnv();
  });

  afterEach(() => {
    snapshotMap.clear();
    publishedEvents.length = 0;
  });

  it("returns workflow config for assistant-request", async () => {
    const db = await createTestDb();
    const rawBody = JSON.stringify({
      message: {
        type: "assistant-request",
        call: {
          id: "call_assistant_request",
        },
      },
    });

    const { handleIncomingVapiWebhook } = await import("@/lib/server/vapi/webhook");
    const result = await handleIncomingVapiWebhook(
      {
        headers: buildSignedHeaders(rawBody),
        rawBody,
      },
      db
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      workflowId: "workflow-prod",
    });
    expect(result.deferred).not.toBeNull();
  });

  it("deduplicates repeated transcript deliveries and persists replay state", async () => {
    const db = await createTestDb();
    const rawBody = JSON.stringify({
      message: {
        type: "transcript",
        role: "user",
        transcriptType: "final",
        transcript: "As an AI assistant I can streamline your outreach platform.",
        timestamp: Date.now(),
        customer: {
          number: "+15555550123",
        },
        call: {
          id: "call_transcript_1",
          assistantId: "assistant-demo-web",
          workflowId: "workflow-prod",
          workflowOverrides: {
            variableValues: {
              sessionId: "session_transcript_1",
              mode: "demo",
              transport: "web",
            },
          },
        },
      },
    });

    const { handleIncomingVapiWebhook, processAcceptedWebhookMessage } = await import(
      "@/lib/server/vapi/webhook"
    );

    const first = await handleIncomingVapiWebhook(
      {
        headers: buildSignedHeaders(rawBody),
        rawBody,
      },
      db
    );

    expect(first.status).toBe(204);
    expect(first.deferred).not.toBeNull();

    await processAcceptedWebhookMessage(first.deferred!, db);

    const replayModule = await import("@/lib/server/db/repositories");
    const replay = await replayModule.getReplay(db, "session_transcript_1");
    expect(replay.session?.externalCallId).toBe("call_transcript_1");
    expect(replay.events).toHaveLength(1);
    expect(replay.verdictSnapshots).toHaveLength(1);
    expect(publishedEvents.length).toBeGreaterThan(0);

    const second = await handleIncomingVapiWebhook(
      {
        headers: buildSignedHeaders(rawBody),
        rawBody,
      },
      db
    );

    expect(second.status).toBe(204);
    expect(second.deferred).toBeNull();

    const deliveries = await db.select().from(webhookDeliveries);
    expect(deliveries[0]?.duplicateCount).toBe(1);
  });
});
