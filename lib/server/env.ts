import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

const envSchema = z.object({
  DATABASE_URL: nonEmptyString,
  REDIS_URL: nonEmptyString,
  REDIS_TOKEN: nonEmptyString.optional(),
  VAPI_API_KEY: nonEmptyString,
  VAPI_WEBHOOK_SECRET: nonEmptyString,
  NEXT_PUBLIC_VAPI_PUBLIC_KEY: nonEmptyString,
  VAPI_WORKFLOW_ID_PRODUCTION: nonEmptyString,
  VAPI_ASSISTANT_ID_DEMO_WEB: nonEmptyString,
  VAPI_PHONE_NUMBER_ID: nonEmptyString,
  SALES_TRANSFER_NUMBER: nonEmptyString,
  OPERATOR_TOKEN: nonEmptyString,
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (!cachedEnv || source !== process.env) {
    cachedEnv = envSchema.parse(source);
  }

  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
