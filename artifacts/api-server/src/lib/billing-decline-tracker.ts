/**
 * Decline-velocity circuit breaker for billing endpoints.
 *
 * Counts FRESH gateway declines (not idempotency replays) per user-id and per IP
 * in a Redis sliding window. After the configured threshold is exceeded within
 * the window, the user/IP is blocked for a cooldown period and a circuit-breaker-
 * tripped alert is queued.
 *
 * Env vars (all optional, defaults shown):
 *   BILLING_DECLINE_MAX             — max declines before blocking (default 5)
 *   BILLING_DECLINE_WINDOW_SECONDS  — sliding window length in seconds (default 900 = 15 min)
 *   BILLING_DECLINE_COOLDOWN_SECONDS — block duration after trip (default 3600 = 1 hr)
 *
 * Fails open: when Redis is unavailable every check returns false / no recording.
 */

import crypto from "crypto";
import { getRedis } from "./redis.js";

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getMaxDeclines(): number {
  return parseEnvInt("BILLING_DECLINE_MAX", 5);
}

function getWindowSeconds(): number {
  return parseEnvInt("BILLING_DECLINE_WINDOW_SECONDS", 900);
}

function getCooldownSeconds(): number {
  return parseEnvInt("BILLING_DECLINE_COOLDOWN_SECONDS", 3600);
}

function ipDeclineKey(ip: string): string {
  const hash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
  return `billing:decline:ip:${hash}`;
}

function userDeclineKey(userId: number): string {
  return `billing:decline:user:${userId}`;
}

function ipBlockKey(ip: string): string {
  const hash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
  return `billing:cb-blocked:ip:${hash}`;
}

function userBlockKey(userId: number): string {
  return `billing:cb-blocked:user:${userId}`;
}

/**
 * Returns true when the user or IP is currently circuit-broken (blocked due to
 * excessive declines). Either dimension being blocked is sufficient to block
 * the request. Returns false when Redis is unavailable (fail-open).
 */
export async function isDeclineBlocked(userId: number | undefined, ip: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const checks: Promise<string | null>[] = [redis.get(ipBlockKey(ip))];
    if (userId !== undefined) checks.push(redis.get(userBlockKey(userId)));
    const results = await Promise.all(checks);
    return results.some((v) => v !== null);
  } catch {
    return false;
  }
}

/**
 * Record a FRESH gateway decline (never call for idempotency replays).
 *
 * Increments the sliding-window counters for the user and IP. If either
 * exceeds the threshold, trips the circuit breaker (sets a block key with
 * cooldown TTL) and returns which dimensions tripped.
 *
 * Callers must fire `onBreakerTripped` for each tripped dimension.
 */
export async function recordFreshDecline(
  userId: number | undefined,
  ip: string,
): Promise<{ trippedUser: boolean; trippedIp: boolean }> {
  const redis = getRedis();
  if (!redis) return { trippedUser: false, trippedIp: false };

  const maxDeclines = getMaxDeclines();
  const windowSeconds = getWindowSeconds();
  const cooldownSeconds = getCooldownSeconds();
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const capEntries = Math.max(maxDeclines * 4, 32);

  const r = redis;
  async function checkAndMaybeTrip(
    windowKey: string,
    blockKey: string,
  ): Promise<boolean> {
    try {
      const member = `${now}:${crypto.randomBytes(4).toString("hex")}`;
      const results = await r
        .multi()
        .zremrangebyscore(windowKey, 0, windowStart)
        .zadd(windowKey, now, member)
        .zcard(windowKey)
        .zremrangebyrank(windowKey, 0, -(capEntries + 1))
        .expire(windowKey, windowSeconds)
        .exec();
      if (!results) return false;
      const count = typeof results[2]?.[1] === "number" ? (results[2][1] as number) : 0;
      if (count >= maxDeclines) {
        await r.set(blockKey, "1", "EX", cooldownSeconds);
        return true;
      }
    } catch {
    }
    return false;
  }

  const [trippedIp, trippedUser] = await Promise.all([
    checkAndMaybeTrip(ipDeclineKey(ip), ipBlockKey(ip)),
    userId !== undefined
      ? checkAndMaybeTrip(userDeclineKey(userId), userBlockKey(userId))
      : Promise.resolve(false),
  ]);

  return { trippedUser, trippedIp };
}
