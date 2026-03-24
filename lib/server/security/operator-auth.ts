import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/server/env";

function parseBearerToken(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isOperatorAuthorized(request: Request): boolean {
  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token) {
    return false;
  }

  return secureEquals(token, getEnv().OPERATOR_TOKEN);
}
