import { describe, expect, it } from "vitest";

describe("operator action route", () => {
  it("rejects unauthorized requests", async () => {
    const { POST } = await import("@/app/api/calls/[id]/actions/route");

    const request = new Request("http://localhost/api/calls/session_1/actions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "force-human",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "session_1" }),
    });

    expect(response.status).toBe(401);
  });
});
