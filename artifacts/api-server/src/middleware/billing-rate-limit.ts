/**
 * Rate-limit middleware for public member-facing billing endpoints.
 *
 * Two layers of protection:
 *
 * 1. Abuse rate limiters (per-user AND per-IP) — cap the raw request volume
 *    hitting the billing endpoints. Both run as middleware BEFORE the route
 *    handler so blocked requests never touch money paths or consume idempotency
 *    keys. Either dimension can independently block the request.
 *
 *    CRITICAL — money endpoints must NEVER be left unthrottled. The shared
 *    abuseRateLimit middleware fails OPEN twice: it no-ops when getRedis()
 *    returns null (REDIS_URL unset) AND it swallows Redis operation errors and
 *    calls next() (see its `.catch` — so a Redis that is configured but DOWN
 *    also strips throttling). Either failure means an attacker who can knock
 *    Redis over also removes all rate limiting from checkout. That is
 *    unacceptable here, so these billing limiters are self-contained:
 *      - Redis reachable  → distributed sliding-window (shared `abuse-rate:*`
 *        keys, identical to abuseRateLimit so ops tooling/keys are consistent).
 *      - Redis null OR the Redis op throws → BOUNDED in-memory per-process
 *        sliding window + a loud (throttled) log. Never a no-op.
 *    The in-memory fallback is per-process (each replica limits independently)
 *    and LRU-evicts past a hard key cap so it can never grow without bound.
 *
 * 2. Decline circuit-breaker check — separate from the above; this middleware
 *    checks whether the user/IP has already been circuit-broken due to excessive
 *    fresh gateway declines (recorded in the route handler AFTER processing).
 *    Tripped → immediate 429. (Secondary defense; layer 1 is the money-path guard.)
 *
 * Env vars (all optional, defaults shown):
 *   BILLING_RATE_LIMIT_USER_MAX          — per-user request limit (default 10)
 *   BILLING_RATE_LIMIT_USER_WINDOW_SEC   — per-user window in seconds (default 600 = 10 min)
 *   BILLING_RATE_LIMIT_IP_MAX            — per-IP request limit (default 20)
 *   BILLING_RATE_LIMIT_IP_WINDOW_SEC     — per-IP window in seconds (default 600 = 10 min)
 *
 * Applied to: POST /billing/checkout, POST /billing/subscribe,
 *             POST /billing/payment-methods
 * NOT applied to: /api/ops routes, webhooks, or GET endpoints.
 */

import crypto from "crypto";
import { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { ipKey, userIdKey } from "./abuse-rate-limit.js";
import { isDeclineBlocked } from "../lib/billing-decline-tracker.js";
import { sendError, ErrorCodes } from "../lib/api-errors.js";
import { getRedis } from "../lib/redis.js";

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getUserMax(): number { return parseEnvInt("BILLING_RATE_LIMIT_USER_MAX", 10); }
function getUserWindowSec(): number { return parseEnvInt("BILLING_RATE_LIMIT_USER_WINDOW_SEC", 600); }
function getIpMax(): number { return parseEnvInt("BILLING_RATE_LIMIT_IP_MAX", 20); }
function getIpWindowSec(): number { return parseEnvInt("BILLING_RATE_LIMIT_IP_WINDOW_SEC", 600); }

// ── Bounded in-memory sliding-window fallback (Redis null or down) ──────────
// Only used when Redis cannot enforce the limit. Money endpoints must keep
// being throttled with no Redis, so this NEVER no-ops.

interface MemBucket { hits: number[]; }
const memStore = new Map<string, MemBucket>();
// Hard cap on distinct keys tracked in-process. Past this we evict the
// least-recently-used key so a spray of unique IPs/users can't grow the map
// without bound. A small multiple of realistic concurrency is plenty.
const MEM_MAX_KEYS = 10_000;
let lastFallbackLogAt = 0;

function logFallbackLoudly(name: string, err?: unknown): void {
  const now = Date.now();
  // Throttle to at most once per minute per process so a Redis outage doesn't
  // flood the logs, while still being impossible to miss.
  if (now - lastFallbackLogAt > 60_000) {
    lastFallbackLogAt = now;
    const why = err
      ? `Redis operation FAILED (${err instanceof Error ? err.message : String(err)})`
      : "Redis UNAVAILABLE";
    console.error(
      `[BillingRateLimit] ${why} — billing limiter "${name}" is running on the ` +
      `BOUNDED IN-MEMORY per-process fallback. Money endpoints remain ` +
      `rate-limited, but limits are per-process and reset on restart. ` +
      `Restore Redis ASAP.`,
    );
  }
}

// Returns true if the request is allowed, false if it should be blocked (429).
function inMemoryAllow(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;

  let bucket = memStore.get(key);
  if (bucket) {
    // Refresh LRU position (Map preserves insertion order; re-inserting moves
    // this key to the "most recently used" end).
    memStore.delete(key);
  } else {
    // Evict the least-recently-used key if we're at the cap.
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

/**
 * Distributed sliding-window check via Redis sorted set — mirrors
 * abuseRateLimit's algorithm and key namespace exactly. Throws on any Redis
 * error so the caller can fall back to in-memory instead of failing open.
 * Returns true if allowed, false if the limit is exceeded.
 */
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

  // A discarded transaction (null) is treated as allow, matching abuseRateLimit.
  if (!results) return true;

  const countResult = results[1]?.[1];
  const currentCount = typeof countResult === "number" ? countResult : 0;
  if (currentCount >= maxRequests) {
    // Remove the entry we just added so a blocked attempt doesn't count against
    // the window after the 429.
    redis.zrem(key, member).catch(() => {});
    return false;
  }
  return true;
}

interface BillingLimiterConfig {
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

function makeBillingLimiter(cfg: BillingLimiterConfig): RequestHandler {
  return function billingLimiterMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
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
        // Redis configured but the operation FAILED (Redis down). Do NOT fail
        // open — fall back to the bounded in-memory limiter.
        runInMemory(err);
      });
  };
}

export const billingUserLimiter: RequestHandler = makeBillingLimiter({
  name: "billing",
  keyResolver: userIdKey("billing"),
  getMax: getUserMax,
  getWindowSec: getUserWindowSec,
  message: "Too many billing requests. Please try again later.",
});

export const billingIpLimiter: RequestHandler = makeBillingLimiter({
  name: "billing-ip",
  keyResolver: ipKey("billing"),
  getMax: getIpMax,
  getWindowSec: getIpWindowSec,
  message: "Too many billing requests from your network. Please try again later.",
});

export function billingDeclineBreakerCheck(): RequestHandler {
  return function billingDeclineBreakerCheckMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    isDeclineBlocked(req.userId, ip)
      .then((blocked) => {
        if (blocked) {
          sendError(
            res,
            429,
            ErrorCodes.RATE_LIMIT_EXCEEDED,
            "Too many declined payments. Please try again later or contact support.",
            { retryAfter: Number(process.env.BILLING_DECLINE_COOLDOWN_SECONDS ?? 3600) },
          );
          return;
        }
        next();
      })
      .catch(() => next());
  };
}
