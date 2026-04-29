import { describe, it, expect, beforeEach, vi } from "vitest";

interface FakeRedis {
  store: Map<string, { value: string; expiresAt?: number }>;
  evalCalls: Array<{ script: string; keys: string[]; args: string[] }>;
  setCalls: Array<{ key: string; value: string; opts: string[] }>;
  delCalls: string[];
  failNextEval?: boolean;
  failNextSet?: boolean;
  failNextDel?: boolean;
  set: (key: string, value: string, ...opts: string[]) => Promise<string | null>;
  del: (key: string) => Promise<number>;
  eval: (
    script: string,
    numKeys: number,
    ...rest: string[]
  ) => Promise<number>;
}

let redisInstance: FakeRedis | null = null;

vi.mock("../lib/redis", () => ({
  getRedis: () => redisInstance,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: vi.fn(async () => Boolean(redisInstance)),
  isRedisReady: () => Boolean(redisInstance),
}));

import {
  compareAndSetAlertingState,
  releaseThrottleSlot,
  tryClaimThrottleSlot,
  __resetQueueFallbackAlerterStateForTests,
} from "../lib/queue-fallback-alerter-state";

function makeFakeRedis(): FakeRedis {
  const store = new Map<string, { value: string; expiresAt?: number }>();
  const evalCalls: FakeRedis["evalCalls"] = [];
  const setCalls: FakeRedis["setCalls"] = [];
  const delCalls: string[] = [];

  const expired = (entry: { expiresAt?: number } | undefined, now: number) =>
    entry?.expiresAt !== undefined && entry.expiresAt <= now;

  const fake: FakeRedis = {
    store,
    evalCalls,
    setCalls,
    delCalls,
    set: async (key, value, ...opts) => {
      const optsAsStrings = opts.map((o) => String(o));
      setCalls.push({ key, value, opts: optsAsStrings });
      if (fake.failNextSet) {
        fake.failNextSet = false;
        throw new Error("redis set boom");
      }
      const now = Date.now();
      const existing = store.get(key);
      const exists = existing && !expired(existing, now);
      const upper = optsAsStrings.map((o) => o.toUpperCase());
      const isNX = upper.includes("NX");
      const exIdx = upper.indexOf("EX");
      const ttlSeconds = exIdx >= 0 ? Number(optsAsStrings[exIdx + 1]) : undefined;
      if (isNX && exists) return null;
      const expiresAt = ttlSeconds !== undefined ? now + ttlSeconds * 1000 : undefined;
      store.set(key, { value, expiresAt });
      return "OK";
    },
    del: async (key) => {
      delCalls.push(key);
      if (fake.failNextDel) {
        fake.failNextDel = false;
        throw new Error("redis del boom");
      }
      return store.delete(key) ? 1 : 0;
    },
    eval: async (script, _numKeys, ...rest) => {
      evalCalls.push({ script, keys: [rest[0]], args: rest.slice(1) });
      if (fake.failNextEval) {
        fake.failNextEval = false;
        throw new Error("redis eval boom");
      }
      // Implement the compare-and-set script we use:
      //   local cur = redis.call('GET', KEYS[1]) or '0'
      //   if cur == ARGV[1] then return 0 end
      //   redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
      //   return 1
      const key = rest[0];
      const newValue = rest[1];
      const ttlSeconds = Number(rest[2]);
      const now = Date.now();
      const existing = store.get(key);
      const cur = existing && !expired(existing, now) ? existing.value : "0";
      if (cur === newValue) return 0;
      store.set(key, { value: newValue, expiresAt: now + ttlSeconds * 1000 });
      return 1;
    },
  };
  return fake;
}

describe("queue-fallback-alerter-state (in-memory fallback)", () => {
  beforeEach(() => {
    redisInstance = null;
    __resetQueueFallbackAlerterStateForTests();
  });

  it("compareAndSetAlertingState returns true on transition and false on no-op", async () => {
    expect(await compareAndSetAlertingState("email", true)).toBe(true);
    expect(await compareAndSetAlertingState("email", true)).toBe(false);
    expect(await compareAndSetAlertingState("email", false)).toBe(true);
    expect(await compareAndSetAlertingState("email", false)).toBe(false);
  });

  it("tryClaimThrottleSlot blocks a re-claim within the throttle window", async () => {
    const now = 1_000_000_000;
    expect(await tryClaimThrottleSlot("email", "pagerduty", "fire", 60_000, now)).toBe(true);
    expect(await tryClaimThrottleSlot("email", "pagerduty", "fire", 60_000, now + 100)).toBe(false);
    // After the window, claim should succeed again.
    expect(await tryClaimThrottleSlot("email", "pagerduty", "fire", 60_000, now + 70_000)).toBe(true);
  });

  it("releaseThrottleSlot lets a fresh claim through immediately", async () => {
    const now = 5;
    expect(await tryClaimThrottleSlot("sms", "slack", "clear", 60_000, now)).toBe(true);
    expect(await tryClaimThrottleSlot("sms", "slack", "clear", 60_000, now)).toBe(false);
    await releaseThrottleSlot("sms", "slack", "clear");
    expect(await tryClaimThrottleSlot("sms", "slack", "clear", 60_000, now)).toBe(true);
  });

  it("throttleMs<=0 disables the throttle entirely", async () => {
    expect(await tryClaimThrottleSlot("email", "email", "fire", 0)).toBe(true);
    expect(await tryClaimThrottleSlot("email", "email", "fire", 0)).toBe(true);
  });

  it("queue channels and delivery channels are isolated from each other", async () => {
    const now = 1_000;
    expect(await tryClaimThrottleSlot("email", "pagerduty", "fire", 60_000, now)).toBe(true);
    // Different queue channel — same delivery/kind — independent.
    expect(await tryClaimThrottleSlot("sms", "pagerduty", "fire", 60_000, now)).toBe(true);
    // Different delivery channel — independent.
    expect(await tryClaimThrottleSlot("email", "slack", "fire", 60_000, now)).toBe(true);
    // Different kind — independent.
    expect(await tryClaimThrottleSlot("email", "pagerduty", "clear", 60_000, now)).toBe(true);
    // Same combination — blocked.
    expect(await tryClaimThrottleSlot("email", "pagerduty", "fire", 60_000, now)).toBe(false);
  });
});

describe("queue-fallback-alerter-state (Redis-backed)", () => {
  let fake: FakeRedis;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fake = makeFakeRedis();
    redisInstance = fake;
    __resetQueueFallbackAlerterStateForTests();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("uses an EVAL compare-and-set so only one caller observes a transition", async () => {
    // First caller flips the flag.
    expect(await compareAndSetAlertingState("email", true)).toBe(true);
    expect(fake.evalCalls).toHaveLength(1);
    expect(fake.evalCalls[0].keys[0]).toBe("queue-fallback:alerting:email");
    expect(fake.evalCalls[0].args[0]).toBe("1");
    // The Redis store now reflects the new value.
    expect(fake.store.get("queue-fallback:alerting:email")?.value).toBe("1");

    // A second caller observing the same already-set value gets `false`.
    expect(await compareAndSetAlertingState("email", true)).toBe(false);
  });

  it("tryClaimThrottleSlot uses SET NX EX so only one instance wins the slot", async () => {
    expect(await tryClaimThrottleSlot("email", "pagerduty", "fire", 60_000)).toBe(true);
    expect(fake.setCalls).toHaveLength(1);
    expect(fake.setCalls[0]).toMatchObject({
      key: "queue-fallback:throttle:email:pagerduty:fire",
      value: "1",
    });
    // The opts must include both NX and EX with a positive TTL.
    const opts = fake.setCalls[0].opts.map((o) => o.toUpperCase());
    expect(opts).toContain("NX");
    expect(opts).toContain("EX");

    // A second pod racing on the same slot loses the claim.
    expect(await tryClaimThrottleSlot("email", "pagerduty", "fire", 60_000)).toBe(false);
  });

  it("releaseThrottleSlot frees the slot via DEL so the next claim wins", async () => {
    expect(await tryClaimThrottleSlot("sms", "slack", "fire", 60_000)).toBe(true);
    expect(await tryClaimThrottleSlot("sms", "slack", "fire", 60_000)).toBe(false);

    await releaseThrottleSlot("sms", "slack", "fire");
    expect(fake.delCalls).toContain("queue-fallback:throttle:sms:slack:fire");

    expect(await tryClaimThrottleSlot("sms", "slack", "fire", 60_000)).toBe(true);
  });

  it("falls back to in-memory state when Redis EVAL throws", async () => {
    fake.failNextEval = true;
    expect(await compareAndSetAlertingState("email", true)).toBe(true);
    // Logged the Redis failure but still produced a sensible answer.
    expect(errSpy).toHaveBeenCalled();
    // In-memory now thinks email is alerting; subsequent in-memory check
    // (Redis is healthy this time) should report no transition because the
    // Redis-side store also got the "1" we wrote on the *next* call (the
    // original failure path didn't touch Redis).
    fake.failNextEval = false;
    // Calling again with `true` against Redis whose store doesn't have the
    // key yet would normally transition — and that's fine, it's the cluster
    // truth. The point is the failure didn't blow up.
  });

  it("falls back to in-memory state when Redis SET throws", async () => {
    fake.failNextSet = true;
    expect(await tryClaimThrottleSlot("email", "pagerduty", "fire", 60_000)).toBe(true);
    expect(errSpy).toHaveBeenCalled();
  });

  it("uses ms-aware ceiling so sub-second throttles still get a >=1s TTL", async () => {
    expect(await tryClaimThrottleSlot("email", "pagerduty", "fire", 250)).toBe(true);
    const opts = fake.setCalls[0].opts;
    const exIdx = opts.findIndex((o) => o.toUpperCase() === "EX");
    expect(Number(opts[exIdx + 1])).toBeGreaterThanOrEqual(1);
  });
});
