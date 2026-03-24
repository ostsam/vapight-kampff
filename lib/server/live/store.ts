import { Redis } from "@upstash/redis";
import type { LiveEvent, LiveSessionSnapshot } from "@/lib/shared/types";
import { getEnv } from "@/lib/server/env";

const SNAPSHOT_KEY_PREFIX = "vk:live:session:";
const CHANNEL_KEY_PREFIX = "vk:live:channel:";

let cachedRedis: Redis | null = null;

function parseRedisConfig(): { url: string; token: string } {
  const env = getEnv();
  const parsedUrl = new URL(env.REDIS_URL);

  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw new Error(
      "REDIS_URL must be an Upstash REST URL when using @upstash/redis."
    );
  }

  const token =
    env.REDIS_TOKEN ??
    (parsedUrl.password || parsedUrl.username || undefined);

  if (!token) {
    throw new Error(
      "REDIS_TOKEN is required unless REDIS_URL embeds an Upstash REST token."
    );
  }

  if (parsedUrl.username || parsedUrl.password) {
    parsedUrl.username = "";
    parsedUrl.password = "";
  }

  return {
    url: parsedUrl.toString(),
    token,
  };
}

export function getRedis(): Redis {
  if (!cachedRedis) {
    const config = parseRedisConfig();
    cachedRedis = new Redis({
      url: config.url,
      token: config.token,
    });
  }

  return cachedRedis;
}

export function setRedisForTesting(redis: Redis | null): void {
  cachedRedis = redis;
}

function snapshotKey(sessionId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${sessionId}`;
}

function channelKey(sessionId: string): string {
  return `${CHANNEL_KEY_PREFIX}${sessionId}`;
}

export function decodeRedisJson<T>(value: unknown): T | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value as T;
}

export async function getLiveSnapshot(
  sessionId: string
): Promise<LiveSessionSnapshot | null> {
  const value = await getRedis().get(snapshotKey(sessionId));
  return decodeRedisJson<LiveSessionSnapshot>(value);
}

export async function setLiveSnapshot(snapshot: LiveSessionSnapshot): Promise<void> {
  await getRedis().set(snapshotKey(snapshot.sessionId), JSON.stringify(snapshot));
}

export async function publishLiveEvent(
  sessionId: string,
  event: LiveEvent
): Promise<void> {
  await getRedis().publish(channelKey(sessionId), JSON.stringify(event));
}

export function subscribeToLiveEvents(sessionId: string): ReturnType<Redis["subscribe"]> {
  return getRedis().subscribe<LiveEvent | string>(channelKey(sessionId));
}
