/**
 * Covers the pod-silence watchdog in `failure-alerter.ts`: page on-call when
 * a previously-reporting moderation pod goes silent for longer than the
 * staleness threshold (2× the rolling window), and clear when the pod
 * resumes reporting or its per-pod key TTLs out of Redis.
 *
 * Uses the same fake-Redis hash store as
 * `moderation-failure-alerter-multi-instance.test.ts` so we can seed pods
 * whose last report is far in the past (no in-window failures) and prove the
 * full fire/clear/throttle flow against the cluster-wide aggregate.
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
            h.set(field, String(cur + by));
            sharedStore.hashes.set(key, h);
            results.push([null, cur + by]);
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
            if (h) for (const f of fields) if (h.delete(f)) removed++;
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
  __resetModerationFailureTrackerForTests,
  __podKeyForTests,
} from "../lib/moderation/failure-tracker";
import {
  evaluateModerationPodSilentAlert,
  getModerationPodSilentAlertingState,
  __resetModerationPodSilentAlerterForTests,
  __setModerationPodSilentAlerterDeliveriesForTests,
  type ModerationPodSilentAlertPayload,
  type DeliveryResult,
} from "../lib/moderation/failure-alerter";

const WINDOW_MS = 15 * 60 * 1000;
const STALE_THRESHOLD_MS = WINDOW_MS * 2; // 30m

/** Seed a remote pod that reported once at `lastAtMs` with no in-window failures. */
function seedSilentPod(instanceId: string, lastAtMs: number): void {
  const key = __podKeyForTests(instanceId);
  const h = new Map<string, string>();
  h.set("__instanceId", instanceId);
  h.set("__lastAt", String(lastAtMs));
  h.set("__lastError", "(old failure)");
  h.set("__lastKind", "engine");
  sharedStore.hashes.set(key, h);
}

/** Seed a remote pod with a fresh in-window failure so it is NOT silent. */
function seedBusyPod(instanceId: string, atMs: number): void {
  const key = __podKeyForTests(instanceId);
  const h = new Map<string, string>();
  h.set("__instanceId", instanceId);
  h.set("__lastAt", String(atMs));
  h.set("__lastError", "boom");
  h.set("__lastKind", "engine");
  const bucket = Math.floor(atMs / 60000);
  h.set(`b:${bucket}:engine`, "1");
  sharedStore.hashes.set(key, h);
}

interface StubDelivery {
  fn: (p: ModerationPodSilentAlertPayload) => Promise<DeliveryResult>;
  calls: ModerationPodSilentAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: ModerationPodSilentAlertPayload[] = [];
  const fn = vi.fn(async (p: ModerationPodSilentAlertPayload): Promise<DeliveryResult> => {
    calls.push(p);
    return { channel, ok: true };
  });
  return { fn, calls };
}

describe("moderation pod-silent alerter", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sharedStore.hashes.clear();
    sharedStore.ttls.clear();
    __resetModerationFailureTrackerForTests();
    __resetModerationPodSilentAlerterForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setModerationPodSilentAlerterDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __setModerationPodSilentAlerterDeliveriesForTests(null);
    errSpy.mockRestore();
  });

  it("stays quiet when there are no reporting pods", async () => {
    const results = await evaluateModerationPodSilentAlert();
    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(getModerationPodSilentAlertingState().alertingPodIds).toEqual([]);
  });

  it("does not fire for a pod that reported recently (quiet but healthy)", async () => {
    const now = Date.now();
    // Reported 1m ago — well inside the 30m staleness threshold.
    seedSilentPod("pod-fresh:1:aaaa", now - 60_000);
    const results = await evaluateModerationPodSilentAlert(now);
    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(getModerationPodSilentAlertingState().alertingPodIds).toEqual([]);
  });

  it("does not fire for a pod with in-window failures, even if older than threshold", async () => {
    const now = Date.now();
    // Busy pod whose last failure is recent — has in-window failures so it is
    // not considered silent regardless of staleness math.
    seedBusyPod("pod-busy:1:bbbb", now - 30_000);
    const results = await evaluateModerationPodSilentAlert(now);
    expect(results).toEqual([]);
    expect(pd.calls).toHaveLength(0);
  });

  it("fires on every channel when a previously-reporting pod goes silent", async () => {
    const now = Date.now();
    seedSilentPod("pod-ghost:1:cccc", now - (STALE_THRESHOLD_MS + 60_000));
    const results = await evaluateModerationPodSilentAlert(now);

    expect(pd.calls).toHaveLength(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
    expect(results.every((r) => r.ok && !r.skipped)).toBe(true);

    const fired = pd.calls[0];
    expect(fired.kind).toBe("fire");
    expect(fired.instanceId).toBe("pod-ghost:1:cccc");
    expect(fired.staleThresholdMs).toBe(STALE_THRESHOLD_MS);
    expect(fired.present).toBe(true);
    expect(getModerationPodSilentAlertingState().alertingPodIds).toEqual([
      "pod-ghost:1:cccc",
    ]);
  });

  it("does not re-page on a second evaluation while the pod is still silent", async () => {
    const now = Date.now();
    seedSilentPod("pod-ghost:1:cccc", now - (STALE_THRESHOLD_MS + 60_000));
    await evaluateModerationPodSilentAlert(now);
    expect(pd.calls).toHaveLength(1);

    // Still silent a minute later — the incident stays open, no new page.
    const second = await evaluateModerationPodSilentAlert(now + 60_000);
    expect(second).toEqual([]);
    expect(pd.calls).toHaveLength(1);
    expect(getModerationPodSilentAlertingState().alertingPodIds).toEqual([
      "pod-ghost:1:cccc",
    ]);
  });

  it("clears when the pod resumes reporting", async () => {
    const now = Date.now();
    seedSilentPod("pod-ghost:1:cccc", now - (STALE_THRESHOLD_MS + 60_000));
    await evaluateModerationPodSilentAlert(now);
    expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

    // The pod reports again (fresh lastAt) — no longer silent.
    const later = now + 5 * 60_000;
    seedSilentPod("pod-ghost:1:cccc", later - 30_000);
    const results = await evaluateModerationPodSilentAlert(later);

    const clears = pd.calls.filter((c) => c.kind === "clear");
    expect(clears).toHaveLength(1);
    expect(clears[0].present).toBe(true);
    expect(results.some((r) => r.channel === "pagerduty" && r.ok)).toBe(true);
    expect(getModerationPodSilentAlertingState().alertingPodIds).toEqual([]);
  });

  it("clears when the pod's key TTLs out of Redis (instance gone)", async () => {
    const now = Date.now();
    const key = __podKeyForTests("pod-ghost:1:cccc");
    seedSilentPod("pod-ghost:1:cccc", now - (STALE_THRESHOLD_MS + 60_000));
    await evaluateModerationPodSilentAlert(now);
    expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

    // The pod disappears entirely (TTL expiry).
    sharedStore.hashes.delete(key);
    const later = now + 5 * 60_000;
    const results = await evaluateModerationPodSilentAlert(later);

    const clears = pd.calls.filter((c) => c.kind === "clear");
    expect(clears).toHaveLength(1);
    expect(clears[0].present).toBe(false);
    expect(results.some((r) => r.channel === "pagerduty" && r.ok)).toBe(true);
    expect(getModerationPodSilentAlertingState().alertingPodIds).toEqual([]);
  });

  it("throttles a flapping pod so it does not spam on-call", async () => {
    const now = Date.now();
    // 1. Pod goes silent → fire.
    seedSilentPod("pod-flap:1:dddd", now - (STALE_THRESHOLD_MS + 60_000));
    await evaluateModerationPodSilentAlert(now);
    expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

    // 2. Pod resumes → clear.
    seedSilentPod("pod-flap:1:dddd", now + 60_000 - 30_000);
    await evaluateModerationPodSilentAlert(now + 60_000);
    expect(pd.calls.filter((c) => c.kind === "clear")).toHaveLength(1);

    // 3. Pod goes silent again shortly after, inside the throttle window —
    // the re-fire is throttled, so on-call is not spammed.
    seedSilentPod("pod-flap:1:dddd", now + 120_000 - (STALE_THRESHOLD_MS + 60_000));
    const third = await evaluateModerationPodSilentAlert(now + 120_000);
    expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
    expect(
      third.some(
        (r) => r.channel === "pagerduty" && r.skipped && r.reason === "throttled",
      ),
    ).toBe(true);
    // It is still considered alerting (transition occurred) even though the
    // page was throttled.
    expect(getModerationPodSilentAlertingState().alertingPodIds).toEqual([
      "pod-flap:1:dddd",
    ]);
  });

  it("tracks multiple silent pods as independent incidents", async () => {
    const now = Date.now();
    seedSilentPod("pod-a:1:aaaa", now - (STALE_THRESHOLD_MS + 60_000));
    seedSilentPod("pod-b:1:bbbb", now - (STALE_THRESHOLD_MS + 120_000));
    seedBusyPod("pod-c:1:cccc", now - 30_000);

    await evaluateModerationPodSilentAlert(now);

    const firedIds = pd.calls
      .filter((c) => c.kind === "fire")
      .map((c) => c.instanceId)
      .sort();
    expect(firedIds).toEqual(["pod-a:1:aaaa", "pod-b:1:bbbb"]);
    expect(getModerationPodSilentAlertingState().alertingPodIds.sort()).toEqual([
      "pod-a:1:aaaa",
      "pod-b:1:bbbb",
    ]);
  });
});
