/**
 * Verifies the cluster-wide aggregation for the moderation failure tracker
 * (task #552). Two simulated api-server pods share the same fake Redis;
 * each pod records a few failures and we assert that the aggregator
 * returns the SUM across both pods, not just whatever the request-handling
 * pod happened to see in its own memory.
 *
 * The test exercises the public surface
 * (`getModerationFailuresInWindowAggregated`) and seeds a "second pod"'s
 * contribution by writing directly into the shared fake-Redis hashes the
 * way a different process would have. Mirrors the multi-instance test
 * pattern used by the rate-limit audit-failure tracker.
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
        hincrby(key: string, field: string, by: number) {
          ops.push(() => {
            const h = sharedStore.hashes.get(key) ?? new Map<string, string>();
            const cur = Number.parseInt(h.get(field) ?? "0", 10) || 0;
            const next = cur + by;
            h.set(field, String(next));
            sharedStore.hashes.set(key, h);
            results.push([null, next]);
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
        hdel(key: string, ...fields: string[]) {
          ops.push(() => {
            const h = sharedStore.hashes.get(key);
            let removed = 0;
            if (h) {
              for (const f of fields) {
                if (h.delete(f)) removed++;
              }
            }
            results.push([null, removed]);
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
  recordModerationFailure,
  getModerationFailuresInWindowAggregated,
  __resetModerationFailureTrackerForTests,
  __getInstanceIdForTests,
  __podKeyForTests,
  type ModerationFailureKind,
} from "../lib/moderation/failure-tracker";

const BUCKET_MS = 60 * 1000;

function bucketFor(at: number): number {
  return Math.floor(at / BUCKET_MS);
}

/**
 * Seed a "different pod"'s per-pod hash directly. This is exactly the
 * shape the tracker would have written had that pod's recordModeration
 * Failure() actually fired in a separate process — we just bypass the
 * "different process" requirement by writing it ourselves.
 */
function seedOtherPodFailures(
  instanceId: string,
  buckets: Array<{ at: number; kind: ModerationFailureKind; count: number }>,
  lastError: string,
): void {
  const key = __podKeyForTests(instanceId);
  const h = new Map<string, string>();
  h.set("__instanceId", instanceId);
  let podLastAt = 0;
  let lastKind: ModerationFailureKind = "engine";
  for (const b of buckets) {
    const field = `b:${bucketFor(b.at)}:${b.kind}`;
    const cur = Number.parseInt(h.get(field) ?? "0", 10) || 0;
    h.set(field, String(cur + b.count));
    if (b.at > podLastAt) {
      podLastAt = b.at;
      lastKind = b.kind;
    }
  }
  h.set("__lastAt", String(podLastAt));
  h.set("__lastError", lastError);
  h.set("__lastKind", lastKind);
  sharedStore.hashes.set(key, h);
}

beforeEach(() => {
  sharedStore.hashes.clear();
  sharedStore.ttls.clear();
  __resetModerationFailureTrackerForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("moderation failure tracker multi-instance aggregation", () => {
  it("sums the cluster-wide total across every reporting pod inside the window", async () => {
    const now = Date.now();
    // Pod A (this process) records two engine failures.
    recordModerationFailure("engine", new Error("local boom 1"), {
      targetType: "post",
      targetId: 1,
    });
    recordModerationFailure("persist", new Error("local boom 2"), {
      targetType: "post",
      targetId: 2,
    });
    // Pod B (simulated) reports four failures inside the window plus
    // one stale one (40m ago) that must be excluded from a 15m window.
    seedOtherPodFailures(
      "pod-b:1234:abcdef",
      [
        { at: now - 60_000, kind: "engine", count: 2 },
        { at: now - 120_000, kind: "persist", count: 2 },
        { at: now - 40 * 60_000, kind: "engine", count: 99 },
      ],
      "remote db down",
    );

    const stats = await getModerationFailuresInWindowAggregated(
      15 * 60 * 1000,
      now,
    );

    expect(stats.source).toBe("redis");
    // 2 from this pod + 4 from the other pod (the 99 stale failures
    // sit outside the 15-minute window and must be excluded).
    expect(stats.totalCount).toBe(6);
    expect(stats.byKind.engine).toBe(1 + 2);
    expect(stats.byKind.persist).toBe(1 + 2);

    const podIds = stats.pods.map((p) => p.instanceId);
    expect(podIds).toContain(__getInstanceIdForTests());
    expect(podIds).toContain("pod-b:1234:abcdef");
    expect(stats.pods).toHaveLength(2);
  });

  it("includes pods that have stopped failing as long as their hash is still alive in Redis", async () => {
    const now = Date.now();
    // Pod A reports nothing this run. Pod B is the only pod with recent
    // failures — its hash hasn't expired yet, so the aggregate must
    // still surface them even though the local in-memory tally is empty.
    seedOtherPodFailures(
      "pod-c:99:cafe",
      [{ at: now - 30_000, kind: "engine", count: 4 }],
      "remote engine threw",
    );

    const stats = await getModerationFailuresInWindowAggregated(
      15 * 60 * 1000,
      now,
    );
    expect(stats.totalCount).toBe(4);
    expect(stats.byKind.engine).toBe(4);
    expect(stats.pods.map((p) => p.instanceId)).toEqual(["pod-c:99:cafe"]);
    expect(stats.lastError).toBe("remote engine threw");
    expect(stats.lastKind).toBe("engine");
  });

  it("survives a Redis SCAN error by falling back to the in-memory snapshot", async () => {
    recordModerationFailure("engine", new Error("local boom"), {
      targetType: "comment",
      targetId: 7,
    });
    const redisModule = await import("../lib/redis");
    const original = (redisModule.getRedis() as any).scan;
    (redisModule.getRedis() as any).scan = async () => {
      throw new Error("redis exploded");
    };
    try {
      const stats = await getModerationFailuresInWindowAggregated(
        15 * 60 * 1000,
      );
      expect(stats.source).toBe("memory");
      expect(stats.totalCount).toBe(1);
      expect(stats.byKind.engine).toBe(1);
    } finally {
      (redisModule.getRedis() as any).scan = original;
    }
  });

  it("does not double-count this pod when its Redis hash is also present", async () => {
    // Trigger a real failure so the pod writes its own hash to Redis AND
    // increments the in-memory counter. The aggregator must reconcile the
    // two views into a single per-pod total — not 2x.
    recordModerationFailure("persist", new Error("only one"), {
      targetType: "post",
      targetId: 42,
    });

    const stats = await getModerationFailuresInWindowAggregated(
      15 * 60 * 1000,
    );
    expect(stats.totalCount).toBe(1);
    expect(stats.pods).toHaveLength(1);
    expect(stats.pods[0].instanceId).toBe(__getInstanceIdForTests());
    expect(stats.pods[0].totalCount).toBe(1);
  });

  it("crosses threshold cluster-wide even when no single pod would on its own", async () => {
    const now = Date.now();
    // Three pods each at 2 failures — below a single-pod threshold of 5,
    // but a cluster-wide aggregate of 6 must clear it. This is exactly
    // the slow-burn scenario the task was filed to address.
    recordModerationFailure("engine", new Error("a"), {
      targetType: "post",
      targetId: 1,
    });
    recordModerationFailure("engine", new Error("a"), {
      targetType: "post",
      targetId: 2,
    });
    seedOtherPodFailures(
      "pod-b:1:bbb",
      [{ at: now - 30_000, kind: "engine", count: 2 }],
      "b",
    );
    seedOtherPodFailures(
      "pod-c:1:ccc",
      [{ at: now - 30_000, kind: "persist", count: 2 }],
      "c",
    );

    const stats = await getModerationFailuresInWindowAggregated(
      15 * 60 * 1000,
      now,
    );
    expect(stats.totalCount).toBe(6);
    expect(stats.totalCount).toBeGreaterThanOrEqual(5);
    expect(stats.pods).toHaveLength(3);
  });
});
