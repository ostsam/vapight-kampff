import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialSnapshot } from "@/lib/server/coordinator";

const baseSnapshot = {
  ...createInitialSnapshot({
    sessionId: "session_live",
    mode: "demo",
    transport: "web",
  }),
  controlUrl: "https://control.example.test",
};

vi.mock("@/lib/server/live/store", () => ({
  getLiveSnapshot: vi.fn(async () => baseSnapshot),
  subscribeToLiveEvents: vi.fn(() => ({
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    unsubscribe: vi.fn(async () => undefined),
  })),
  decodeRedisJson: vi.fn((value: unknown) => value),
}));

describe("live SSE route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams the initial snapshot", async () => {
    const { GET } = await import("@/app/api/live/[sessionId]/route");
    const request = new Request("http://localhost/api/live/session_live");
    const response = await GET(request, {
      params: Promise.resolve({ sessionId: "session_live" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);

    expect(text).toContain("event: session.snapshot");
    expect(text).toContain("session_live");
  });
});
