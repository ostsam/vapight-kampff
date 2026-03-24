import { describe, expect, it } from "vitest";
import { getEnv } from "@/lib/server/env";
import { applyTestEnv } from "@/tests/helpers";

describe("env parsing", () => {
  it("parses the required backend environment", () => {
    applyTestEnv();
    const env = getEnv();

    expect(env.VAPI_API_KEY).toBe("vapi-server-key");
    expect(env.SALES_TRANSFER_NUMBER).toBe("+15555550100");
  });

  it("throws when a required variable is missing", () => {
    applyTestEnv({
      OPERATOR_TOKEN: "",
    });

    expect(() => getEnv(process.env)).toThrow();
  });
});
