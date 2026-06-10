import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  redisRetryStrategy,
  makeThrottledRedisErrorLogger,
} from "../lib/redis";

describe("redisRetryStrategy", () => {
  it("backs off exponentially from the first retry", () => {
    expect(redisRetryStrategy(1)).toBe(2000);
    expect(redisRetryStrategy(2)).toBe(4000);
    expect(redisRetryStrategy(3)).toBe(8000);
    expect(redisRetryStrategy(4)).toBe(16000);
  });

  it("caps the delay so reconnects never hammer the event loop", () => {
    // Without a cap, 2 ** 20 * 1000 would be ~17 minutes, but more importantly
    // the early attempts would never grow past ioredis' default ~2s. The cap
    // keeps every attempt well-spaced regardless of how long Redis is down.
    expect(redisRetryStrategy(100)).toBe(30000);
    expect(redisRetryStrategy(1000)).toBe(30000);
  });

  it("never returns a sub-second delay that would spin the loop", () => {
    for (let times = 1; times <= 50; times++) {
      expect(redisRetryStrategy(times)).toBeGreaterThanOrEqual(1000);
    }
  });
});

describe("makeThrottledRedisErrorLogger", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  it("logs the first error but suppresses a flood within the window", () => {
    const log = makeThrottledRedisErrorLogger("[Test]");
    for (let i = 0; i < 1000; i++) {
      log(new Error("connect ECONNREFUSED 127.0.0.1:6379"));
    }
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("[Test]");
    expect(errorSpy.mock.calls[0][0]).toContain("ECONNREFUSED");
  });

  it("logs again after the throttle window and reports suppressed count", () => {
    const log = makeThrottledRedisErrorLogger("[Test]");
    log(new Error("boom"));
    expect(errorSpy).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      log(new Error("boom"));
    }
    expect(errorSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    log(new Error("boom"));
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy.mock.calls[1][0]).toContain("5 similar errors suppressed");
  });
});
