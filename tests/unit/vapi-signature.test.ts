import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deriveWebhookDedupeKey,
  deriveWebhookPayloadHash,
  verifyVapiSignature,
} from "@/lib/server/vapi/signature";

describe("Vapi signature utilities", () => {
  it("verifies a valid Vapi signature", () => {
    const rawBody = JSON.stringify({ message: { type: "transcript" } });
    const secret = "top-secret";
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");

    expect(verifyVapiSignature(rawBody, signature, secret)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const rawBody = JSON.stringify({ message: { type: "transcript" } });

    expect(verifyVapiSignature(rawBody, "bad-signature", "top-secret")).toBe(false);
  });

  it("derives stable payload hashes and dedupe keys", () => {
    const rawBody = JSON.stringify({ message: { type: "status-update" } });

    expect(deriveWebhookPayloadHash(rawBody)).toBe(deriveWebhookPayloadHash(rawBody));
    expect(deriveWebhookDedupeKey(rawBody)).toBe(deriveWebhookDedupeKey(rawBody));
  });
});
