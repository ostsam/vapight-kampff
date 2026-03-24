import { describe, expect, it } from "vitest";
import { createInitialSnapshot, selectNextTrap } from "@/lib/server/coordinator";

describe("trap selection", () => {
  it("returns the next unused trap in library order", () => {
    const initial = createInitialSnapshot({
      sessionId: "session_1",
      mode: "demo",
      transport: "web",
    });

    const first = selectNextTrap(initial);
    const second = selectNextTrap(first.snapshot);

    expect(first.trap?.id).toBeTruthy();
    expect(second.trap?.id).toBeTruthy();
    expect(second.trap?.id).not.toBe(first.trap?.id);
  });
});
