import { createHmac, timingSafeEqual } from "node:crypto";
import { sha256Hex } from "@/lib/server/ids";

function normalizeSignature(signatureHeader: string): string[] {
  return signatureHeader
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.includes("=")) {
        return part.split("=")[1] ?? "";
      }

      return part;
    })
    .filter(Boolean);
}

export function deriveWebhookPayloadHash(rawBody: string): string {
  return sha256Hex(rawBody);
}

export function deriveWebhookDedupeKey(rawBody: string): string {
  return sha256Hex(rawBody);
}

export function verifyVapiSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected);

  return normalizeSignature(signatureHeader).some((candidate) => {
    const candidateBuffer = Buffer.from(candidate);
    if (candidateBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(candidateBuffer, expectedBuffer);
  });
}
