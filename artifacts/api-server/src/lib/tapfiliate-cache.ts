import { getRedis } from "./redis";

const CACHE_TTL_SECONDS = 86400;

interface MemoryEntry {
  url: string;
  expiresAt: number;
}

const memCache = new Map<string, MemoryEntry>();

function cacheKey(userId: number, programId: string): string {
  return `tapfiliate:ref:${userId}:${programId}`;
}

export async function getCachedReferralUrl(
  userId: number,
  programId: string,
): Promise<string | null> {
  const key = cacheKey(userId, programId);

  const redis = getRedis();
  if (redis) {
    try {
      const val = await redis.get(key);
      return val ?? null;
    } catch {
      /* fall through to memory cache */
    }
  }

  const entry = memCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.url;
  }
  memCache.delete(key);
  return null;
}

export async function setCachedReferralUrl(
  userId: number,
  programId: string,
  url: string,
): Promise<void> {
  const key = cacheKey(userId, programId);

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, url, "EX", CACHE_TTL_SECONDS);
      return;
    } catch {
      /* fall through to memory cache */
    }
  }

  memCache.set(key, {
    url,
    expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
  });
}

export async function invalidateCachedReferralUrlsByProgram(
  programId: string,
): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      const pattern = `tapfiliate:ref:*:${programId}`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch {
      /* best effort */
    }
  }

  for (const key of memCache.keys()) {
    if (key.endsWith(`:${programId}`)) {
      memCache.delete(key);
    }
  }
}
