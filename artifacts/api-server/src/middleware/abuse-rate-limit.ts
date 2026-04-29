import { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import crypto from "crypto";
import { getRedis } from "../lib/redis";
import { sendError, ErrorCodes } from "../lib/api-errors";
import { recordRateLimitAuditFailure } from "../lib/rate-limit-audit-failure-tracker";

export interface AbuseRateLimitOptions {
  name: string;
  maxRequests: number;
  windowSeconds: number;
  keyResolver: (req: Request) => string | null;
  message?: string;
  // Optional fire-and-forget hook invoked when a request is blocked with a 429.
  // Lets callers record the event (e.g. write an audit log entry) without
  // coupling the middleware to any specific logger. Errors are swallowed so
  // the response timing is unaffected.
  onLimitExceeded?: (req: Request) => void | Promise<void>;
}

function clientIp(req: Request): string {
  // Use Express's resolved `req.ip`. It only honors X-Forwarded-For when the
  // app has been configured with `trust proxy`, so callers can't spoof their
  // identity by sending a forged header.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function ipKey(prefix: string) {
  return (req: Request) => `${prefix}:ip:${clientIp(req)}`;
}

export function emailKey(prefix: string, fieldName: string = "email") {
  return (req: Request) => {
    const raw = req.body?.[fieldName];
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return null;
    const hash = crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 24);
    return `${prefix}:email:${hash}`;
  };
}

// Hard upper bound on how many entries we'll keep in any single rate-limit
// sorted set. The middleware decides allow/deny based on the count *before*
// the new entry is added, but during a sustained spam wave many writers can
// race past the count check and pile entries into the same set faster than
// the per-window TTL can clean them up. This cap (applied via
// ZREMRANGEBYRANK on every request) bounds the per-key memory footprint to
// a small multiple of the configured limit so a single attacker can't grow
// one key without bound inside the window.
function entryCapFor(maxRequests: number): number {
  return Math.max(maxRequests * 4, 32);
}

export function abuseRateLimit(opts: AbuseRateLimitOptions): RequestHandler {
  const { name, maxRequests, windowSeconds, keyResolver, message, onLimitExceeded } = opts;
  const entryCap = entryCapFor(maxRequests);
  return function abuseRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const redis = getRedis();
    if (!redis) {
      next();
      return;
    }

    const resolved = keyResolver(req);
    if (!resolved) {
      next();
      return;
    }

    const key = `abuse-rate:${name}:${resolved}`;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;
    const member = `${now}:${crypto.randomBytes(6).toString("hex")}`;

    redis
      .multi()
      .zremrangebyscore(key, 0, windowStart)
      .zcard(key)
      .zadd(key, now, member)
      .zremrangebyrank(key, 0, -(entryCap + 1))
      .expire(key, windowSeconds)
      .exec()
      .then(async (results) => {
        if (!results) {
          next();
          return;
        }

        const countResult = results[1]?.[1];
        const currentCount = typeof countResult === "number" ? countResult : 0;

        if (currentCount >= maxRequests) {
          // We pushed one extra entry above; remove it so it doesn't count toward
          // the user's window after they get a 429 back.
          redis.zrem(key, member).catch(() => {});
          const retryAfter = windowSeconds;
          res.setHeader("Retry-After", retryAfter);
          if (onLimitExceeded) {
            // Await the audit hook so the 429 response is only sent once the
            // record of the blocked attempt has been written. Without this,
            // each 429 fires off an unawaited insert and bursts of blocked
            // requests can finish responding before the audit rows commit —
            // downstream alerting and the tests both rely on "one 429 means
            // one audit row, observable as soon as the response returns".
            // Errors are swallowed so a flaky audit log can never turn a
            // legitimate 429 into a 500. We DO bump a process-wide counter
            // so the System Health page can flag "audit writes are silently
            // failing" — without it, a database outage during a
            // credential-stuffing wave would drop the audit trail while
            // 429s kept flowing, leaving on-call with no visible signal.
            try {
              await onLimitExceeded(req);
            } catch (err: any) {
              console.error(
                `[AbuseRateLimit:${name}] onLimitExceeded error:`,
                err?.message || err,
              );
              recordRateLimitAuditFailure(name, err);
            }
          }
          sendError(
            res,
            429,
            ErrorCodes.RATE_LIMIT_EXCEEDED,
            message || "Too many requests. Please try again later.",
            { retryAfter },
          );
          return;
        }

        next();
      })
      .catch((err) => {
        console.error(`[AbuseRateLimit:${name}] Redis error:`, err?.message || err);
        next();
      });
  };
}
