import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { AppDatabase } from "@/lib/server/db/client";
import * as schema from "@/lib/server/db/schema";
import { resetEnvCache } from "@/lib/server/env";

export function applyTestEnv(
  overrides: Partial<NodeJS.ProcessEnv> = {}
): NodeJS.ProcessEnv {
  const defaults: Record<string, string> = {
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/vapight_kampff",
    REDIS_URL: "https://example.upstash.io",
    REDIS_TOKEN: "test-token",
    VAPI_API_KEY: "vapi-server-key",
    VAPI_WEBHOOK_SECRET: "vapi-webhook-secret",
    NEXT_PUBLIC_VAPI_PUBLIC_KEY: "vapi-public-key",
    VAPI_WORKFLOW_ID_PRODUCTION: "workflow-prod",
    VAPI_ASSISTANT_ID_DEMO_WEB: "assistant-demo-web",
    VAPI_PHONE_NUMBER_ID: "phone-number-id",
    SALES_TRANSFER_NUMBER: "+15555550100",
    OPERATOR_TOKEN: "operator-secret",
  };

  Object.assign(process.env, defaults, overrides);
  resetEnvCache();

  return process.env;
}

export async function createTestDb(): Promise<AppDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder: `${process.cwd()}/drizzle`,
  });

  return db as unknown as AppDatabase;
}

export function buildSignedHeaders(rawBody: string, secret = "vapi-webhook-secret"): Headers {
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");

  return new Headers({
    "content-type": "application/json",
    "x-vapi-signature": signature,
  });
}
