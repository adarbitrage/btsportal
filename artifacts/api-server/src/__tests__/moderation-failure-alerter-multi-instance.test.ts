/**
 * End-to-end check for the cluster-wide moderation failure alerter
 * (task #557, locks in #552). Combines the fake-Redis fixture from
 * `moderation-failure-multi-instance.test.ts` with the delivery-stub
 * pattern from `moderation-failure-alerter.test.ts` so we can prove the
 * full alerter flow — read aggregated cluster stats from Redis, evaluate
 * the threshold, dispatch on every channel — actually fires when failures
 * are spread across multiple simulated pods, none of which individually
 * sits above threshold.
 *
 * Without this regression check, a future refactor that quietly reverts
 * the alerter to a single-pod read would still pass the per-module unit
 * tests but would silently re-open the slow-burn outage gap that #552
 * was filed to close.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

vi.mock("../lib/moderation/failure-alert-settings", () => {
  let threshold = 5;
  let windowMinutes = 15;
  return {
    MODERATION_FAILURE_ALERT_DEFAULTS: { threshold: 5, windowMinutes: 15 },
    getModerationFailureAlertConfig: vi.fn(async () => ({ threshold, windowMinutes })),
    __setForTests: (t: number, w: number) => {
      threshold = t;
      windowMinutes = w;
    },
  };
});

import {
  recordModerationFailure,
  __resetModerationFailureTrackerForTests,
  __podKeyForTests,
  type ModerationFailureKind,
} from "../lib/moderation/failure-tracker";
import {
  evaluateModerationFailureAlert,
  getModerationFailureAlertingState,
  __resetModerationFailureAlerterForTests,
  __setModerationFailureAlerterDeliveriesForTests,
  type DeliveryResult,
  type ModerationFailureAlertPayload,
} from "../lib/moderation/failure-alerter";

const BUCKET_MS = 60 * 1000;

function bucketFor(at: number): number {
  return Math.floor(at / BUCKET_MS);
}

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

interface StubDelivery {
  fn: (p: ModerationFailureAlertPayload) => Promise<DeliveryResult>;
  calls: ModerationFailureAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: ModerationFailureAlertPayload[] = [];
  const fn = vi.fn(async (p: ModerationFailureAlertPayload): Promise<DeliveryResult> => {
    calls.push(p);
    return { channel, ok: true };
  });
  return { fn, calls };
}

describe("moderation-failure-alerter multi-instance end-to-end", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sharedStore.hashes.clear();
    sharedStore.ttls.clear();
    __resetModerationFailureTrackerForTests();
    __resetModerationFailureAlerterForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setModerationFailureAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __setModerationFailureAlerterDeliveriesForTests(null);
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("fires on every channel when cluster-wide failures cross threshold even though no single pod does", async () => {
    const now = Date.now();
    // Local pod (pod A) records 2 failures — well below the default
    // threshold of 5.
    recordModerationFailure("engine", new Error("local a1"), {
      targetType: "post",
      targetId: 1,
    });
    recordModerationFailure("engine", new Error("local a2"), {
      targetType: "post",
      targetId: 2,
    });
    // Two other simulated pods each report 2 in-window failures. None of
    // the three pods is at threshold on its own (2 < 5), but the cluster
    // total is 6, which must trigger the alert.
    seedOtherPodFailures(
      "pod-b:111:bbbb",
      [{ at: now - 30_000, kind: "engine", count: 2 }],
      "remote b failure",
    );
    seedOtherPodFailures(
      "pod-c:222:cccc",
      [{ at: now - 45_000, kind: "persist", count: 2 }],
      "remote c failure",
    );

    const results = await evaluateModerationFailureAlert(now);

    // Every channel got the fire.
    expect(pd.calls).toHaveLength(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
    expect(results.every((r) => r.ok && !r.skipped)).toBe(true);
    expect(getModerationFailureAlertingState().alerting).toBe(true);

    // The fire payload reflects the cluster-wide sum, not just the local
    // pod's 2 failures. This is the core regression check for #552.
    const fired = pd.calls[0];
    expect(fired.kind).toBe("fire");
    expect(fired.threshold).toBe(5);
    expect(fired.window.totalCount).toBe(6);
    expect(fired.window.byKind.engine).toBe(2 + 2);
    expect(fired.window.byKind.persist).toBe(2);
    // Every reporting pod is represented in the window snapshot.
    expect(fired.window.pods).toHaveLength(3);
    const ids = fired.window.pods.map((p) => p.instanceId);
    expect(ids).toContain("pod-b:111:bbbb");
    expect(ids).toContain("pod-c:222:cccc");

    // All three delivery channels got the same cluster-wide totals, not
    // divergent local-only views.
    for (const stub of [pd, email, slack]) {
      expect(stub.calls[0].window.totalCount).toBe(6);
    }
  });

  it("stays quiet when the cluster-wide sum is still under threshold", async () => {
    const now = Date.now();
    // 2 (local) + 2 (pod B) = 4, still below threshold of 5.
    recordModerationFailure("engine", new Error("local"), {
      targetType: "post",
      targetId: 1,
    });
    recordModerationFailure("engine", new Error("local"), {
      targetType: "post",
      targetId: 2,
    });
    seedOtherPodFailures(
      "pod-b:111:bbbb",
      [{ at: now - 30_000, kind: "engine", count: 2 }],
      "remote",
    );

    const results = await evaluateModerationFailureAlert(now);
    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(email.calls).toHaveLength(0);
    expect(slack.calls).toHaveLength(0);
    expect(getModerationFailureAlertingState().alerting).toBe(false);
  });
});
