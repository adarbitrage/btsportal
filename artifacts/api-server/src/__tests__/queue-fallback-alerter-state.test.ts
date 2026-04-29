import { describe, it, expect, beforeEach, vi } from "vitest";

interface FakeRedis {
  store: Map<string, { value: string; expiresAt?: number }>;
  evalCalls: Array<{ script: string; keys: string[]; args: string[] }>;
  setCalls: Array<{ key: string; value: string; opts: string[] }>;
  delCalls: string[];
  scanCalls: Array<{ cursor: string; opts: string[] }>;
  pttlCalls: string[];
  getCalls: string[];
  failNextEval?: boolean;
  failNextSet?: boolean;
  failNextDel?: boolean;
  failNextScan?: boolean;
  failNextGet?: boolean;
  set: (key: string, value: string, ...opts: string[]) => Promise<string | null>;
  del: (key: string) => Promise<number>;
  get: (key: string) => Promise<string | null>;
  scan: (cursor: string, ...opts: string[]) => Promise<[string, string[]]>;
  pttl: (key: string) => Promise<number>;
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
  getAlertingFlags,
  getActiveThrottleSlots,
  __resetQueueFallbackAlerterStateForTests,
} from "../lib/queue-fallback-alerter-state";

function makeFakeRedis(): FakeRedis {
  const store = new Map<string, { value: string; expiresAt?: number }>();
  const evalCalls: FakeRedis["evalCalls"] = [];
  const setCalls: FakeRedis["setCalls"] = [];
  const delCalls: string[] = [];
  const scanCalls: FakeRedis["scanCalls"] = [];
  const pttlCalls: string[] = [];
  const getCalls: string[] = [];

  const expired = (entry: { expiresAt?: number } | undefined, now: number) =>
    entry?.expiresAt !== undefined && entry.expiresAt <= now;

  const fake: FakeRedis = {
    store,
    evalCalls,
    setCalls,
    delCalls,
    scanCalls,
    pttlCalls,
    getCalls,
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
    get: async (key) => {
      getCalls.push(key);
      if (fake.failNextGet) {
        fake.failNextGet = false;
        throw new Error("redis get boom");
      }
      const now = Date.now();
      const entry = store.get(key);
      if (!entry) return null;
      if (expired(entry, now)) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    scan: async (cursor, ...opts) => {
      scanCalls.push({ cursor, opts: opts.map((o) => String(o)) });
      if (fake.failNextScan) {
        fake.failNextScan = false;
        throw new Error("redis scan boom");
      }
      // Naive: ignore COUNT and just return everything matching MATCH on the
      // first sweep, with cursor "0" (== done). Plenty for these tests.
      const upper = opts.map((o) => String(o).toUpperCase());
      const matchIdx = upper.indexOf("MATCH");
      const pattern = matchIdx >= 0 ? String(opts[matchIdx + 1]) : "*";
      // Translate the simple `prefix*` style we use into a regex.
      const regex = new RegExp(
        "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
      );
      const now = Date.now();
      const matches: string[] = [];
      for (const [key, entry] of store.entries()) {
        if (expired(entry, now)) continue;
        if (regex.test(key)) matches.push(key);
      }
      return ["0", matches];
    },
    pttl: async (key) => {
      pttlCalls.push(key);
      const now = Date.now();
      const entry = store.get(key);
      if (!entry) return -2;
      if (entry.expiresAt === undefined) return -1;
      const remaining = entry.expiresAt - now;
      return remaining > 0 ? remaining : -2;
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

describe("getAlertingFlags", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    redisInstance = null;
    __resetQueueFallbackAlerterStateForTests();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the in-memory flags with source=memory when Redis is not configured", async () => {
    await compareAndSetAlertingState("email", true);
    const snap = await getAlertingFlags();
    expect(snap.source).toBe("memory");
    const byChannel = Object.fromEntries(snap.flags.map((f) => [f.channel, f.alerting]));
    expect(byChannel).toEqual({ email: true, sms: false });
  });

  it("reads cluster-shared flags from Redis with source=redis", async () => {
    const fake = makeFakeRedis();
    redisInstance = fake;
    await compareAndSetAlertingState("sms", true);
    const snap = await getAlertingFlags();
    expect(snap.source).toBe("redis");
    const byChannel = Object.fromEntries(snap.flags.map((f) => [f.channel, f.alerting]));
    expect(byChannel).toEqual({ email: false, sms: true });
  });

  it("falls back to in-memory state when Redis GET throws", async () => {
    const fake = makeFakeRedis();
    redisInstance = fake;
    // Set an in-memory value first by routing through compareAndSet on a
    // disconnected redis (simulating a previous fallback).
    redisInstance = null;
    await compareAndSetAlertingState("email", true);
    redisInstance = fake;
    fake.failNextGet = true;
    const snap = await getAlertingFlags();
    expect(snap.source).toBe("memory");
    const byChannel = Object.fromEntries(snap.flags.map((f) => [f.channel, f.alerting]));
    expect(byChannel.email).toBe(true);
    expect(errSpy).toHaveBeenCalled();
  });
});

describe("getActiveThrottleSlots", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    redisInstance = null;
    __resetQueueFallbackAlerterStateForTests();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns memory slots with remaining TTL when Redis is not configured", async () => {
    const now = Date.now();
    await tryClaimThrottleSlot("email", "pagerduty", "fire", 60_000, now);
    await tryClaimThrottleSlot("sms", "slack", "clear", 30_000, now);
    const snap = await getActiveThrottleSlots(now);
    expect(snap.source).toBe("memory");
    expect(snap.slots).toHaveLength(2);
    // Sorted by remaining TTL ascending — sms/slack/clear (30s) first.
    expect(snap.slots[0].queueChannel).toBe("sms");
    expect(snap.slots[0].deliveryChannel).toBe("slack");
    expect(snap.slots[0].kind).toBe("clear");
    expect(snap.slots[0].ttlMs).toBeGreaterThan(0);
    expect(snap.slots[0].ttlMs).toBeLessThanOrEqual(30_000);
    expect(typeof snap.slots[0].expiresAt).toBe("string");
  });

  it("excludes already-expired in-memory slots", async () => {
    const now = Date.now();
    await tryClaimThrottleSlot("email", "pagerduty", "fire", 1_000, now);
    const snap = await getActiveThrottleSlots(now + 5_000);
    expect(snap.slots).toHaveLength(0);
  });

  it("returns Redis slots discovered via SCAN+PTTL", async () => {
    const fake = makeFakeRedis();
    redisInstance = fake;
    await tryClaimThrottleSlot("email", "pagerduty", "fire", 60_000);
    await tryClaimThrottleSlot("sms", "email", "clear", 120_000);
    const snap = await getActiveThrottleSlots();
    expect(snap.source).toBe("redis");
    expect(snap.slots).toHaveLength(2);
    expect(fake.scanCalls.length).toBeGreaterThan(0);
    // Sorted ascending by ttlMs
    expect(snap.slots[0].queueChannel).toBe("email");
    expect(snap.slots[1].queueChannel).toBe("sms");
    for (const slot of snap.slots) {
      expect(slot.ttlMs).toBeGreaterThan(0);
      expect(typeof slot.expiresAt).toBe("string");
    }
  });

  it("falls back to in-memory snapshot when Redis SCAN throws", async () => {
    const fake = makeFakeRedis();
    redisInstance = fake;
    redisInstance = null;
    await tryClaimThrottleSlot("email", "pagerduty", "fire", 60_000);
    redisInstance = fake;
    fake.failNextScan = true;
    const snap = await getActiveThrottleSlots();
    expect(snap.source).toBe("memory");
    expect(snap.slots.some((s) => s.queueChannel === "email")).toBe(true);
    expect(errSpy).toHaveBeenCalled();
  });

  it("ignores unknown/garbage throttle keys present in Redis", async () => {
    const fake = makeFakeRedis();
    redisInstance = fake;
    // Inject a bogus key directly into the fake store.
    fake.store.set("queue-fallback:throttle:bogus:nope:wat", {
      value: "1",
      expiresAt: Date.now() + 60_000,
    });
    await tryClaimThrottleSlot("email", "pagerduty", "fire", 60_000);
    const snap = await getActiveThrottleSlots();
    expect(snap.source).toBe("redis");
    expect(snap.slots).toHaveLength(1);
    expect(snap.slots[0].queueChannel).toBe("email");
  });
});
