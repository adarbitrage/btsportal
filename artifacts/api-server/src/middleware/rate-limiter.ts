import { type Request, type Response, type NextFunction } from "express";
import { getRedis } from "../lib/redis";
import { sendError, ErrorCodes } from "../lib/api-errors";

export interface RateLimitTierConfig {
  maxRequests: number;
  windowSeconds: number;
}

const RATE_LIMIT_TIERS: Record<string, RateLimitTierConfig> = {
  standard: { maxRequests: 60, windowSeconds: 60 },
  elevated: { maxRequests: 300, windowSeconds: 60 },
  unlimited: { maxRequests: 999999, windowSeconds: 60 },
};

export function getRateLimitConfig(tier: string): RateLimitTierConfig {
  return RATE_LIMIT_TIERS[tier] || RATE_LIMIT_TIERS.standard;
}

export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  if (!req.isApiKeyAuth || !req.apiKeyContext) {
    next();
    return;
  }

  const redis = getRedis();
  if (!redis) {
    next();
    return;
  }

  const tier = req.apiKeyContext.rateLimitTier || "standard";
  const config = getRateLimitConfig(tier);

  if (tier === "unlimited") {
    res.setHeader("X-RateLimit-Tier", tier);
    res.setHeader("X-RateLimit-Limit", config.maxRequests);
    res.setHeader("X-RateLimit-Remaining", config.maxRequests);
    res.setHeader("X-RateLimit-Reset", Math.floor(Date.now() / 1000) + config.windowSeconds);
    next();
    return;
  }

  const identifier = req.apiKeyContext.prefix;
  const key = `ratelimit:${identifier}`;
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;

  redis
    .multi()
    .zremrangebyscore(key, 0, windowStart)
    .zrangebyscore(key, windowStart, now)
    .zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`)
    .expire(key, config.windowSeconds)
    .exec()
    .then((results) => {
      if (!results) {
        next();
        return;
      }

      const members = results[1]?.[1] as string[] | undefined;
      const currentCount = members ? members.length : 0;
      const remaining = Math.max(0, config.maxRequests - currentCount - 1);
      const resetTime = Math.floor(now / 1000) + config.windowSeconds;

      res.setHeader("X-RateLimit-Limit", config.maxRequests);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", resetTime);
      res.setHeader("X-RateLimit-Tier", tier);

      if (currentCount >= config.maxRequests) {
        const retryAfter = config.windowSeconds;
        res.setHeader("Retry-After", retryAfter);
        sendError(res, 429, ErrorCodes.RATE_LIMIT_EXCEEDED, "Rate limit exceeded. Please try again later.", {
          retryAfter,
          limit: config.maxRequests,
          windowSeconds: config.windowSeconds,
        });
        return;
      }

      next();
    })
    .catch((err) => {
      console.error("[RateLimiter] Redis error:", err);
      next();
    });
}
