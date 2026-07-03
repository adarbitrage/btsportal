/**
 * Rate-limit middleware for the service-to-service Customer Ops API
 * (`/api/ops`).
 *
 * Two dimensions, both applied to every ops route:
 *   - per-key-fingerprint (a hash of the presented OPS_API_KEY bearer token —
 *     never the raw key itself, so nothing sensitive ends up in Redis keys
 *     or logs)
 *   - per-IP
 *
 * Two named buckets:
 *   - "ops-write" — refund + access grant/revoke (mutating, money-adjacent)
 *   - "ops-read"  — customer/order lookups
 *
 * Env vars (all optional, defaults shown):
 *   BTS_OPS_RATE_LIMIT_WRITE_MAX          — per-write-bucket request limit (default 20)
 *   BTS_OPS_RATE_LIMIT_WRITE_WINDOW_SEC   — write window in seconds (default 600 = 10 min)
 *   BTS_OPS_RATE_LIMIT_READ_MAX           — per-read-bucket request limit (default 120)
 *   BTS_OPS_RATE_LIMIT_READ_WINDOW_SEC    — read window in seconds (default 600 = 10 min)
 *
 * Fail-closed-soft: this deliberately does NOT reuse abuseRateLimit's
 * fail-open behavior (silent next() when Redis is null/down). Ops routes
 * move money, so an attacker knocking Redis over must never also strip
 * throttling — Redis reachable uses a distributed sliding window; Redis
 * null OR the operation throwing falls back to a bounded, per-process
 * in-memory sliding window with a loud (throttled) log line. Mirrors the
 * pattern in `billing-rate-limit.ts` (money endpoints get the same
 * guarantee), reimplemented standalone here so ops-specific naming/keys
 * don't get entangled with the member-facing billing limiter.
 */

import crypto from "crypto";
import { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { sendError, ErrorCodes } from "../lib/api-errors.js";
import { getRedis } from "../lib/redis.js";
import { ipKey } from "./abuse-rate-limit.js";

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getWriteMax(): number { return parseEnvInt("BTS_OPS_RATE_LIMIT_WRITE_MAX", 20); }
function getWriteWindowSec(): number { return parseEnvInt("BTS_OPS_RATE_LIMIT_WRITE_WINDOW_SEC", 600); }
function getReadMax(): number { return parseEnvInt("BTS_OPS_RATE_LIMIT_READ_MAX", 120); }
function getReadWindowSec(): number { return parseEnvInt("BTS_OPS_RATE_LIMIT_READ_WINDOW_SEC", 600); }

/**
 * Resolves the ops caller's key-fingerprint dimension: a truncated SHA-256
 * hash of the presented bearer token. Never returns/logs the raw key. This
 * middleware is mounted AFTER `requireOpsServiceAuth`, so by the time it
 * runs the token is already known-valid, but we still hash defensively
 * (never store the literal secret anywhere, even in a Redis key or an
 * in-memory Map key).
 */
export function opsKeyFingerprint(req: Request): string | null {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  const hash = crypto.createHash("sha256").update(token).digest("hex").slice(0, 24);
  return `ops:key:${hash}`;
}

// ── Bounded in-memory sliding-window fallback (Redis null or down) ──────────

interface MemBucket { hits: number[]; }
const memStore = new Map<string, MemBucket>();
// Hard cap on distinct keys tracked in-process so a spray of unique
// IPs/key-fingerprints can't grow the map without bound.
const MEM_MAX_KEYS = 10_000;
let lastFallbackLogAt = 0;

function logFallbackLoudly(name: string, err?: unknown): void {
  const now = Date.now();
  // Throttle to at most once per minute per process so a Redis outage
  // doesn't flood the logs, while still being impossible to miss.
  if (now - lastFallbackLogAt > 60_000) {
    lastFallbackLogAt = now;
    const why = err
      ? `Redis operation FAILED (${err instanceof Error ? err.message : String(err)})`
      : "Redis UNAVAILABLE";
    console.error(
      `[OpsRateLimit] ${why} — ops limiter "${name}" is running on the ` +
      `BOUNDED IN-MEMORY per-process fallback. /api/ops remains ` +
      `rate-limited, but limits are per-process and reset on restart. ` +
      `Restore Redis ASAP.`,
    );
  }
}

function inMemoryAllow(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;

  let bucket = memStore.get(key);
  if (bucket) {
    memStore.delete(key);
  } else {
    if (memStore.size >= MEM_MAX_KEYS) {
      const oldest = memStore.keys().next().value;
      if (oldest !== undefined) memStore.delete(oldest);
    }
    bucket = { hits: [] };
  }

  bucket.hits = bucket.hits.filter((t) => t > cutoff);
  const allowed = bucket.hits.length < maxRequests;
  if (allowed) bucket.hits.push(now);
  memStore.set(key, bucket);
  return allowed;
}

async function redisAllow(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  name: string,
  resolvedKey: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<boolean> {
  const key = `abuse-rate:${name}:${resolvedKey}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const member = `${now}:${crypto.randomBytes(6).toString("hex")}`;
  const entryCap = Math.max(maxRequests * 4, 32);

  const results = await redis
    .multi()
    .zremrangebyscore(key, 0, windowStart)
    .zcard(key)
    .zadd(key, now, member)
    .zremrangebyrank(key, 0, -(entryCap + 1))
    .expire(key, windowSeconds)
    .exec();

  // A discarded/aborted transaction (null) means Redis didn't actually
  // enforce the limit for this request. Never fail open here — throw so
  // the caller's `.catch()` routes to the bounded in-memory fallback,
  // exactly like a hard Redis error would.
  if (!results) {
    throw new Error(`ops rate limiter "${name}": Redis transaction returned null (discarded)`);
  }

  const countResult = results[1]?.[1];
  const currentCount = typeof countResult === "number" ? countResult : 0;
  if (currentCount >= maxRequests) {
    redis.zrem(key, member).catch(() => {});
    return false;
  }
  return true;
}

interface OpsLimiterConfig {
  name: string;
  keyResolver: (req: Request) => string | null;
  getMax: () => number;
  getWindowSec: () => number;
  message: string;
}

function block(res: Response, windowSec: number, message: string): void {
  res.setHeader("Retry-After", windowSec);
  sendError(res, 429, ErrorCodes.RATE_LIMIT_EXCEEDED, message, {
    retryAfter: windowSec,
  });
}

function makeOpsLimiter(cfg: OpsLimiterConfig): RequestHandler {
  return function opsLimiterMiddleware(req: Request, res: Response, next: NextFunction): void {
    const resolved = cfg.keyResolver(req);
    if (!resolved) {
      next();
      return;
    }
    const maxRequests = cfg.getMax();
    const windowSec = cfg.getWindowSec();
    const redis = getRedis();

    const runInMemory = (why?: unknown) => {
      logFallbackLoudly(cfg.name, why);
      const allowed = inMemoryAllow(
        `${cfg.name}:${resolved}`,
        maxRequests,
        windowSec * 1000,
      );
      if (!allowed) {
        block(res, windowSec, cfg.message);
        return;
      }
      next();
    };

    if (!redis) {
      // Redis not configured at all → bounded in-memory (never no-op).
      runInMemory();
      return;
    }

    redisAllow(redis, cfg.name, resolved, maxRequests, windowSec)
      .then((allowed) => {
        if (!allowed) {
          block(res, windowSec, cfg.message);
          return;
        }
        next();
      })
      .catch((err) => {
        // Redis configured but the operation FAILED (Redis down). Do NOT
        // fail open — fall back to the bounded in-memory limiter.
        runInMemory(err);
      });
  };
}

export const opsWriteKeyLimiter: RequestHandler = makeOpsLimiter({
  name: "ops-write-key",
  keyResolver: opsKeyFingerprint,
  getMax: getWriteMax,
  getWindowSec: getWriteWindowSec,
  message: "Too many ops write requests. Please try again later.",
});

export const opsWriteIpLimiter: RequestHandler = makeOpsLimiter({
  name: "ops-write-ip",
  keyResolver: ipKey("ops-write"),
  getMax: getWriteMax,
  getWindowSec: getWriteWindowSec,
  message: "Too many ops write requests from your network. Please try again later.",
});

export const opsReadKeyLimiter: RequestHandler = makeOpsLimiter({
  name: "ops-read-key",
  keyResolver: opsKeyFingerprint,
  getMax: getReadMax,
  getWindowSec: getReadWindowSec,
  message: "Too many ops read requests. Please try again later.",
});

export const opsReadIpLimiter: RequestHandler = makeOpsLimiter({
  name: "ops-read-ip",
  keyResolver: ipKey("ops-read"),
  getMax: getReadMax,
  getWindowSec: getReadWindowSec,
  message: "Too many ops read requests from your network. Please try again later.",
});

/** Mount on write routes (refund, access grant/revoke). */
export const opsWriteRateLimit: RequestHandler[] = [opsWriteKeyLimiter, opsWriteIpLimiter];

/** Mount on read routes (customer/order lookups). */
export const opsReadRateLimit: RequestHandler[] = [opsReadKeyLimiter, opsReadIpLimiter];

/**
 * Test-only escape hatch: clears the bounded in-memory fallback store. The
 * store is a module-level singleton keyed by key-fingerprint/IP, so without
 * this, tests that assert on exact request counts would leak state across
 * `it()` blocks (and across files sharing a worker). Never called from
 * production code paths.
 */
export function __resetOpsRateLimitStateForTests(): void {
  memStore.clear();
}
