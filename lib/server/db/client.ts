import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { getEnv } from "@/lib/server/env";
import * as schema from "@/lib/server/db/schema";

export type AppDatabase =
  | NeonHttpDatabase<typeof schema>
  | PgliteDatabase<typeof schema>;

let cachedDb: AppDatabase | null = null;

export function createDb(databaseUrl = getEnv().DATABASE_URL): AppDatabase {
  const client = neon(databaseUrl);
  return drizzleNeon(client, { schema });
}

export function getDb(): AppDatabase {
  if (!cachedDb) {
    cachedDb = createDb();
  }

  return cachedDb;
}

export function setDbForTesting(db: AppDatabase | null): void {
  cachedDb = db;
}
