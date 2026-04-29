/**
 * Verifies the cluster-wide aggregation for the rate-limit audit-failure
 * tracker (task #233). Two simulated api-server pods share the same fake
 * Redis; each pod records a few failures and we assert that the System
 * Health aggregator returns the SUM across both pods, not just whatever
 * the request-handling pod happened to see in its own memory.
 *
 * The test exercises the public surface (`getRateLimitAuditFailureStatsAggregated`)
 * and seeds a "second pod"'s contribution by writing directly into the
 * shared fake-Redis hashes the way a different process would have. This
 * keeps the test fully in-process while still proving the SCAN+HGETALL
 * aggregator merges per-pod hashes correctly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

interface FakeHashStore {
  hashes: Map<string, Map<string, string>>;
  ttls: Map<string, number>;
}

const sharedStore: FakeHashStore = { hashes: new Map(), ttls: new Map() };

vi.mock("../lib/redis", () => {
  const fakeRedis: any = {
    multi() {
      const ops: Array<() => void> = [];
      const results: Array<[Error | null, unknown]> = [];
      const m: any = {
        del(key: string) {
          ops.push(() => {
            const existed = sharedStore.hashes.delete(key);
            sharedStore.ttls.delete(key);
            results.push([null, existed ? 1 : 0]);
          });
          return m;
        },
        hset(key: string, ...fieldsAndValues: Array<string | number>) {
          ops.push(() => {
            const h = sharedStore.hashes.get(key) ?? new Map<string, string>();
            for (let i = 0; i < fieldsAndValues.length; i += 2) {
              h.set(String(fieldsAndValues[i]), String(fieldsAndValues[i + 1]));
            }
            sharedStore.hashes.set(key, h);
            results.push([null, 1]);
          });
          return m;
        },
        expire(key: string, seconds: number) {
          ops.push(() => {
            sharedStore.ttls.set(key, Date.now() + seconds * 1000);
            results.push([null, 1]);
          });
          return m;
        },
        async exec() {
          for (const op of ops) op();
          return results;
        },
      };
      return m;
    },
    async scan(cursor: string, _match: string, pattern: string, _count: string, _n: number) {
      const re = new RegExp(
        "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
      );
      const keys = Array.from(sharedStore.hashes.keys()).filter((k) => re.test(k));
      // Return cursor "0" to indicate the SCAN is complete in one round.
      return [cursor === "0" ? "0" : "0", keys];
    },
    async hgetall(key: string) {
      const h = sharedStore.hashes.get(key);
      if (!h) return {};
      return Object.fromEntries(h.entries());
    },
  };
  return {
    getRedis: () => fakeRedis,
    getRedisConnection: vi.fn(),
    createRedisConnection: vi.fn(),
    isRedisConnected: vi.fn(async () => true),
    isRedisReady: () => true,
  };
});

import {
  recordRateLimitAuditFailure,
  getRateLimitAuditFailureStatsAggregated,
  __resetRateLimitAuditFailureTrackerForTests,
  __getInstanceIdForTests,
  __podKeyForTests,
} from "../lib/rate-limit-audit-failure-tracker";

beforeEach(() => {
  sharedStore.hashes.clear();
  sharedStore.ttls.clear();
  __resetRateLimitAuditFailureTrackerForTests();
});

/**
 * Seed a "different pod"'s per-pod hash directly. This is exactly the
 * shape the tracker would have written had that pod's recordRateLimit
 * AuditFailure() actually fired in a separate process — we just bypass
 * the "different process" requirement by writing it ourselves.
 */
function seedOtherPodFailures(
  instanceId: string,
  perLimiter: Record<string, { count: number; lastAt: number; lastError: string }>,
): void {
  const key = __podKeyForTests(instanceId);
  const h = new Map<string, string>();
  h.set("__instanceId", instanceId);
  let podLastAt = 0;
  for (const [name, info] of Object.entries(perLimiter)) {
    h.set(`c:${name}`, String(info.count));
    h.set(`t:${name}`, String(info.lastAt));
    h.set(`e:${name}`, info.lastError);
    if (info.lastAt > podLastAt) podLastAt = info.lastAt;
  }
  h.set("__lastAt", String(podLastAt));
  sharedStore.hashes.set(key, h);
}

describe("rate-limit audit-failure tracker multi-instance aggregation", () => {
  it("sums the cluster-wide total across every reporting pod", async () => {
    // Pod A (this process) records two failures.
    recordRateLimitAuditFailure("login", new Error("db down"));
    recordRateLimitAuditFailure("login", new Error("db still down"));
    // Pod B (simulated) reports five failures across two limiters.
    seedOtherPodFailures("pod-b:1234:abcdef", {
      login: { count: 3, lastAt: Date.now() - 1000, lastError: "timeout" },
      "forgot-password": {
        count: 2,
        lastAt: Date.now() - 5000,
        lastError: "connection refused",
      },
    });

    const stats = await getRateLimitAuditFailureStatsAggregated();

    expect(stats.source).toBe("redis");
    // 2 from this pod + 5 from the other pod
    expect(stats.totalCount).toBe(7);
    // login: 2 (this pod) + 3 (other pod) = 5
    expect(stats.byName["login"]?.count).toBe(5);
    // forgot-password is only on the other pod
    expect(stats.byName["forgot-password"]?.count).toBe(2);

    const podIds = stats.pods.map((p) => p.instanceId);
    expect(podIds).toContain(__getInstanceIdForTests());
    expect(podIds).toContain("pod-b:1234:abcdef");
    expect(stats.pods).toHaveLength(2);
  });

  it("includes pods that have stopped failing as long as their hash is still alive in Redis", async () => {
    // Pod A reports nothing this time. Pod B is the only pod with failures
    // that have happened in the recent past (and whose hash hasn't expired
    // yet). Aggregator must surface the failure even though the request-
    // handling pod's in-memory tally is empty.
    seedOtherPodFailures("pod-c:99:cafe", {
      login: { count: 4, lastAt: Date.now() - 60_000, lastError: "boom" },
    });

    const stats = await getRateLimitAuditFailureStatsAggregated();
    expect(stats.totalCount).toBe(4);
    expect(stats.byName["login"]?.count).toBe(4);
    expect(stats.pods.map((p) => p.instanceId)).toEqual(["pod-c:99:cafe"]);
  });

  it("survives a Redis SCAN error by falling back to the in-memory snapshot", async () => {
    recordRateLimitAuditFailure("login", new Error("local boom"));
    const redisModule = await import("../lib/redis");
    const original = (redisModule.getRedis() as any).scan;
    (redisModule.getRedis() as any).scan = async () => {
      throw new Error("redis exploded");
    };
    try {
      const stats = await getRateLimitAuditFailureStatsAggregated();
      expect(stats.source).toBe("memory");
      expect(stats.totalCount).toBe(1);
      expect(stats.byName["login"]?.count).toBe(1);
    } finally {
      (redisModule.getRedis() as any).scan = original;
    }
  });

  it("does not double-count this pod when its Redis hash is also present", async () => {
    // Trigger a real failure so the pod writes its own hash to Redis AND
    // increments the in-memory counter. The aggregator must reconcile the
    // two views into a single per-pod total — not 2x.
    recordRateLimitAuditFailure("login", new Error("only one"));

    const stats = await getRateLimitAuditFailureStatsAggregated();
    expect(stats.totalCount).toBe(1);
    expect(stats.pods).toHaveLength(1);
    expect(stats.pods[0].instanceId).toBe(__getInstanceIdForTests());
    expect(stats.pods[0].totalCount).toBe(1);
  });

  it("trusts the in-memory tally when it has caught up faster than Redis", async () => {
    // Two failures recorded in-process. Then we stomp the Redis hash to a
    // stale state to simulate a write that hasn't landed yet.
    recordRateLimitAuditFailure("login", new Error("first"));
    recordRateLimitAuditFailure("login", new Error("second"));
    // Replace the pod's Redis hash with a stale snapshot (count=1).
    const key = __podKeyForTests(__getInstanceIdForTests());
    sharedStore.hashes.set(
      key,
      new Map<string, string>([
        ["__instanceId", __getInstanceIdForTests()],
        ["c:login", "1"],
        ["t:login", String(Date.now() - 1000)],
        ["e:login", "first"],
        ["__lastAt", String(Date.now() - 1000)],
      ]),
    );

    const stats = await getRateLimitAuditFailureStatsAggregated();
    // The pod's in-memory tally (2) wins over the stale Redis copy (1).
    expect(stats.totalCount).toBe(2);
    expect(stats.pods).toHaveLength(1);
    expect(stats.pods[0].totalCount).toBe(2);
  });
});
