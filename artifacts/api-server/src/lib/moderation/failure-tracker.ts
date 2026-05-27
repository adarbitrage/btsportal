/**
 * Tracks failures of the background moderation queue (`enqueueModerationJob`).
 *
 * Two distinct failure kinds matter to on-call:
 *   - `engine` — the AI/wordlist evaluator threw. The post is now public and
 *     was never inspected: a flag-worthy post may have slipped through.
 *   - `persist` — the evaluator flagged the content but the DB update that
 *     would set status=shadow_hidden or insert into the moderation queue
 *     threw. The content is *known to be flag-worthy* and still publicly
 *     `active`. This is the more serious of the two.
 *
 * Each kind is tracked independently so the alert body can call out which
 * pathway is failing (a database flap vs. an OpenAI / classifier outage).
 *
 * Storage strategy
 * ----------------
 * Each api-server process keeps an in-memory event log for fast, in-process
 * reads, and (when Redis is configured) ALSO mirrors a per-pod, per-minute
 * bucketed snapshot to Redis. The alerter reads the cluster-wide aggregate
 * so a slow-burn outage that distributes failures across multiple pods
 * still crosses threshold — without aggregation, each pod only ever sees
 * its own slice and may stay just under the limit forever.
 *
 * Why per-pod hashes (not a single shared counter): operators want to know
 * which pods are dropping moderation work — a single cluster-wide HINCRBY
 * hides the fact that one rogue pod might be responsible for all the
 * failures. Per-pod hashes keep that breakdown trivial to surface and let
 * stale pods disappear naturally via the per-key TTL.
 *
 * Why per-minute buckets (not individual event timestamps): the alerter
 * evaluates a rolling-window count, not per-event detail. One-minute
 * resolution is enough for a 15-minute window and keeps the hash bounded
 * (24h × 2 kinds = 2880 fields per pod max).
 *
 * The local in-memory event log remains authoritative for the local pod
 * and is also used as the fast-path / fallback when Redis is unavailable.
 * Timestamps are retained for up to 24h so the alerter's rolling-window
 * check can look back N minutes without a separate ring buffer.
 */

import os from "os";
import crypto from "crypto";
import { getRedis } from "../redis";

export type ModerationFailureKind = "engine" | "persist";

export interface ModerationFailureEvent {
  kind: ModerationFailureKind;
  /** Wall-clock time when the failure was recorded. */
  at: number;
  /** Short, human-readable description of the error. */
  message: string;
  /** "post" or "comment" — surfaced in the alert body. */
  targetType: "post" | "comment";
  /** The DB id of the target so on-call can grep audit logs. */
  targetId: number;
}

export interface ModerationFailurePodStats {
  /** Stable identifier for the pod that reported these counts. */
  instanceId: string;
  /** Sum of failures from this pod inside the window. */
  totalCount: number;
  /** Breakdown by kind for this pod inside the window. */
  byKind: Record<ModerationFailureKind, number>;
  /** ISO timestamp of the most recent failure on this pod (may be outside the window). */
  lastAt: string | null;
}

export interface ModerationFailureWindowStats {
  /** Total failures in the window across both kinds and every reporting pod. */
  totalCount: number;
  /** Failures broken down by kind. */
  byKind: Record<ModerationFailureKind, number>;
  /** ISO timestamp of the most recent failure in the window, or null. */
  lastAt: string | null;
  /** Short error string from the most recent failure in the window. */
  lastError: string | null;
  /** Kind of the most recent failure in the window. */
  lastKind: ModerationFailureKind | null;
  /** Window length in milliseconds the stats were computed over. */
  windowMs: number;
  /**
   * Where the snapshot was sourced from. `redis` means the count reflects
   * every pod that reported in the last 24h; `memory` means Redis was
   * unavailable so only this single pod's tally is included.
   */
  source: "redis" | "memory";
  /**
   * Per-pod breakdown so operators can see which pods are dropping
   * moderation jobs. Always includes the current pod (when source=memory)
   * or every pod that's reported in the last 24h (when source=redis).
   */
  pods: ModerationFailurePodStats[];
}

export interface ModerationFailureCumulativeStats {
  /** Sum of every failure recorded since process start. */
  totalCount: number;
  /** Cumulative breakdown by kind. */
  byKind: Record<ModerationFailureKind, number>;
  /** ISO timestamp of the most recent failure, or null. */
  lastAt: string | null;
}

// Hard cap on retained events. Failures large enough to hit this cap would
// already have paged on-call; the cap exists to keep memory bounded if the
// alerter is somehow not draining the buffer (e.g. evaluation disabled in a
// test). 5000 covers ~3.5 failures/sec for 24h, far beyond what a real
// outage produces before someone responds.
const MAX_EVENTS = 5000;
// Hard retention ceiling — any event older than this is dropped on the next
// access, matching the 24h TTL the rate-limit tracker uses for its Redis
// snapshot. Keeps the rolling-window query bounded.
const RETENTION_MS = 24 * 60 * 60 * 1000;
/** Bucket size for the Redis-mirrored per-minute counters. */
const BUCKET_MS = 60 * 1000;
/** Redis key prefix for per-pod failure hashes. */
const POD_KEY_PREFIX = "moderation-failures:pod:";
/** Per-pod hash TTL in seconds. Refreshed on every failure. */
const POD_KEY_TTL_SECONDS = 24 * 60 * 60;

const events: ModerationFailureEvent[] = [];
const cumulative: Record<ModerationFailureKind, number> = {
  engine: 0,
  persist: 0,
};
let cumulativeLastAt: number | null = null;
/**
 * Set of bucket-minute epochs we've written to Redis. Used to opportunistically
 * HDEL stale fields on each write so a long-lived pod doesn't accumulate
 * 24h worth of empty buckets indefinitely.
 */
const writtenBuckets = new Set<number>();

/**
 * Stable per-process identifier. `os.hostname()` alone collides when two
 * replicas share a host (common in dev clusters and during blue/green
 * rollouts), and `process.pid` collides on different hosts that happen to
 * pick the same PID, so we combine both with a short random suffix to make
 * accidental collisions effectively impossible. Mirrors the convention used
 * by `rate-limit-audit-failure-tracker.ts` so the per-pod breakdown reads
 * the same in both panels.
 */
const INSTANCE_ID = (() => {
  const host = (() => {
    try {
      return os.hostname();
    } catch {
      return "unknown-host";
    }
  })();
  const pid = process.pid;
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${host}:${pid}:${suffix}`;
})();

function podKey(instanceId: string): string {
  return `${POD_KEY_PREFIX}${instanceId}`;
}

/** Exposed for tests so they can construct keys without copying the prefix. */
export function __podKeyForTests(instanceId: string): string {
  return podKey(instanceId);
}

/** Exposed for tests so they can identify the current pod. */
export function __getInstanceIdForTests(): string {
  return INSTANCE_ID;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const maybe = (err as { message?: unknown }).message;
    if (typeof maybe === "string") return maybe;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function pruneOlderThan(thresholdMs: number): void {
  // Events are appended in chronological order, so we only need to drop
  // from the head until the first survivor.
  while (events.length > 0 && events[0].at < thresholdMs) {
    events.shift();
  }
}

function bucketFor(at: number): number {
  return Math.floor(at / BUCKET_MS);
}

/**
 * Mirror the in-memory increment to Redis so other pods can include this
 * pod's failure counts in their aggregate. Best-effort: a Redis hiccup
 * must never block moderation processing or escalate a partial outage
 * into an all-pods failure. The in-memory event log remains authoritative
 * for this pod regardless of whether the Redis write lands.
 */
function persistFailureToRedis(
  kind: ModerationFailureKind,
  at: number,
  message: string,
): void {
  const redis = getRedis();
  if (!redis) return;
  const bucket = bucketFor(at);
  const key = podKey(INSTANCE_ID);
  // Identify stale buckets we wrote previously that have now aged out of
  // the retention window so the same multi() can prune them in one round
  // trip. Bounded by `writtenBuckets`, which is itself bounded by the
  // number of distinct minutes this pod has failed in over the last 24h.
  const cutoffBucket = bucketFor(at - RETENTION_MS);
  const staleBuckets: number[] = [];
  for (const b of writtenBuckets) {
    if (b < cutoffBucket) staleBuckets.push(b);
  }
  try {
    const pipeline = redis.multi();
    pipeline.hincrby(key, `b:${bucket}:${kind}`, 1);
    pipeline.hset(
      key,
      "__instanceId",
      INSTANCE_ID,
      "__lastAt",
      String(at),
      "__lastError",
      message,
      "__lastKind",
      kind,
    );
    if (staleBuckets.length > 0) {
      const fields: string[] = [];
      for (const b of staleBuckets) {
        fields.push(`b:${b}:engine`, `b:${b}:persist`);
      }
      pipeline.hdel(key, ...fields);
    }
    pipeline.expire(key, POD_KEY_TTL_SECONDS);
    const result = pipeline.exec();
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      (result as Promise<unknown>).catch((err) => {
        console.error(
          "[Moderation][Failure] Failed to mirror pod snapshot to Redis:",
          err,
        );
      });
    }
    writtenBuckets.add(bucket);
    for (const b of staleBuckets) writtenBuckets.delete(b);
  } catch (err) {
    console.error(
      "[Moderation][Failure] Failed to dispatch pod snapshot to Redis:",
      err,
    );
  }
}

/**
 * Record a single failure and emit a structured warning line. Safe to
 * call from any hot path — pure in-memory bookkeeping plus a `console.warn`
 * and a fire-and-forget Redis write.
 *
 * The `[Moderation][Failure]` prefix is distinct from the existing
 * `[Moderation]` log lines in `queue.ts` so log-based alerting can count
 * this signal independently from generic moderation logs.
 */
export function recordModerationFailure(
  kind: ModerationFailureKind,
  err: unknown,
  context: { targetType: "post" | "comment"; targetId: number },
): void {
  const now = Date.now();
  const message = describeError(err);
  events.push({
    kind,
    at: now,
    message,
    targetType: context.targetType,
    targetId: context.targetId,
  });
  cumulative[kind]++;
  cumulativeLastAt = now;

  // Drop the oldest record if we've blown past the cap. We do this AFTER
  // appending so the most-recent failure is always retained even at the
  // boundary.
  if (events.length > MAX_EVENTS) {
    events.shift();
  }
  // Also evict anything older than the retention ceiling so a long-quiet
  // process doesn't keep stale events around forever.
  pruneOlderThan(now - RETENTION_MS);

  console.warn(
    `[Moderation][Failure] kind=${kind} ${context.targetType}=${context.targetId} error=${message} at=${new Date(now).toISOString()} pod=${INSTANCE_ID}`,
  );

  persistFailureToRedis(kind, now, message);
}

interface LocalWindowSummary {
  byKind: Record<ModerationFailureKind, number>;
  lastAtMs: number;
  lastError: string | null;
  lastKind: ModerationFailureKind | null;
  podLastAtMs: number;
}

function computeLocalWindowSummary(
  windowMs: number,
  now: number,
): LocalWindowSummary {
  const cutoff = now - Math.max(0, windowMs);
  pruneOlderThan(now - RETENTION_MS);
  const byKind: Record<ModerationFailureKind, number> = { engine: 0, persist: 0 };
  let lastAtMs = 0;
  let lastError: string | null = null;
  let lastKind: ModerationFailureKind | null = null;
  let podLastAtMs = 0;
  for (const ev of events) {
    if (ev.at > podLastAtMs) podLastAtMs = ev.at;
    if (ev.at < cutoff) continue;
    byKind[ev.kind]++;
    if (ev.at >= lastAtMs) {
      lastAtMs = ev.at;
      lastError = ev.message;
      lastKind = ev.kind;
    }
  }
  return { byKind, lastAtMs, lastError, lastKind, podLastAtMs };
}

function buildLocalPodStats(
  windowMs: number,
  now: number,
): {
  pod: ModerationFailurePodStats;
  lastAtMs: number;
  lastError: string | null;
  lastKind: ModerationFailureKind | null;
} {
  const summary = computeLocalWindowSummary(windowMs, now);
  const totalCount = summary.byKind.engine + summary.byKind.persist;
  return {
    pod: {
      instanceId: INSTANCE_ID,
      totalCount,
      byKind: { ...summary.byKind },
      lastAt: summary.podLastAtMs
        ? new Date(summary.podLastAtMs).toISOString()
        : null,
    },
    lastAtMs: summary.lastAtMs,
    lastError: summary.lastError,
    lastKind: summary.lastKind,
  };
}

/**
 * Snapshot of the failures inside the last `windowMs` milliseconds, drawn
 * from this pod's in-memory event log only. Used as the synchronous fast
 * path and the fallback when Redis is unavailable. Production callers
 * should prefer `getModerationFailuresInWindowAggregated()` so the number
 * is cluster-wide instead of per-pod.
 */
export function getModerationFailuresInWindow(
  windowMs: number,
  now: number = Date.now(),
): ModerationFailureWindowStats {
  const local = buildLocalPodStats(windowMs, now);
  return {
    totalCount: local.pod.totalCount,
    byKind: { ...local.pod.byKind },
    lastAt: local.lastAtMs ? new Date(local.lastAtMs).toISOString() : null,
    lastError: local.lastError,
    lastKind: local.lastKind,
    windowMs,
    source: "memory",
    pods: local.pod.totalCount > 0 ? [local.pod] : [],
  };
}

interface ParsedPod {
  pod: ModerationFailurePodStats;
  windowLastAtMs: number;
  windowLastError: string | null;
  windowLastKind: ModerationFailureKind | null;
}

function parsePodHash(
  fields: Record<string, string>,
  fallbackId: string,
  windowMs: number,
  now: number,
): ParsedPod | null {
  const instanceId = fields.__instanceId || fallbackId;
  const cutoff = now - Math.max(0, windowMs);
  const cutoffBucket = Math.floor(cutoff / BUCKET_MS);
  const byKind: Record<ModerationFailureKind, number> = { engine: 0, persist: 0 };
  let podLastAtMs = 0;
  for (const [field, value] of Object.entries(fields)) {
    if (field.startsWith("__")) {
      if (field === "__lastAt") {
        const ts = Number.parseInt(value, 10);
        if (Number.isFinite(ts) && ts > podLastAtMs) podLastAtMs = ts;
      }
      continue;
    }
    // Field convention from persistFailureToRedis:
    //   b:<bucketMinute>:<kind> -> count
    if (!field.startsWith("b:")) continue;
    const rest = field.slice(2);
    const colon = rest.indexOf(":");
    if (colon <= 0) continue;
    const bucketStr = rest.slice(0, colon);
    const kindStr = rest.slice(colon + 1);
    if (kindStr !== "engine" && kindStr !== "persist") continue;
    const bucket = Number.parseInt(bucketStr, 10);
    if (!Number.isFinite(bucket)) continue;
    // Include buckets whose minute is at or after the cutoff bucket. The
    // floor of `cutoff/BUCKET_MS` means we include a partial leading
    // bucket — acceptable since over-inclusion errs on the side of
    // firing the alert slightly early rather than missing it.
    if (bucket < cutoffBucket) continue;
    const count = Number.parseInt(value, 10);
    if (!Number.isFinite(count) || count <= 0) continue;
    byKind[kindStr as ModerationFailureKind] += count;
  }
  const totalCount = byKind.engine + byKind.persist;
  // Pull last-error metadata only when the pod's __lastAt falls inside
  // the window. Otherwise we'd attribute a 3-day-old error to a fresh
  // alert payload and confuse on-call.
  let windowLastAtMs = 0;
  let windowLastError: string | null = null;
  let windowLastKind: ModerationFailureKind | null = null;
  if (podLastAtMs >= cutoff && totalCount > 0) {
    windowLastAtMs = podLastAtMs;
    windowLastError = fields.__lastError || null;
    const lk = fields.__lastKind;
    windowLastKind = lk === "engine" || lk === "persist" ? lk : null;
  }
  if (totalCount === 0 && podLastAtMs === 0) return null;
  return {
    pod: {
      instanceId,
      totalCount,
      byKind,
      lastAt: podLastAtMs ? new Date(podLastAtMs).toISOString() : null,
    },
    windowLastAtMs,
    windowLastError,
    windowLastKind,
  };
}

/**
 * Cluster-wide snapshot of the per-pod failure counters. SCANs the
 * `moderation-failures:pod:*` keyspace, parses each pod's hash, and sums
 * into a single view. Always reconciles the local pod's contribution from
 * the in-memory event log (rather than the pod's own Redis hash) so a
 * freshly-ticked failure shows up immediately even if the mirroring
 * pipeline hasn't committed yet. Falls back to the in-memory snapshot if
 * Redis is unavailable or the SCAN fails — the same defensive posture
 * used by the rate-limit audit-failure aggregator.
 */
export async function getModerationFailuresInWindowAggregated(
  windowMs: number,
  now: number = Date.now(),
): Promise<ModerationFailureWindowStats> {
  const redis = getRedis();
  const local = buildLocalPodStats(windowMs, now);
  if (!redis) {
    return getModerationFailuresInWindow(windowMs, now);
  }
  try {
    const matchedKeys = new Set<string>();
    let cursor = "0";
    do {
      const reply = await redis.scan(
        cursor,
        "MATCH",
        `${POD_KEY_PREFIX}*`,
        "COUNT",
        100,
      );
      cursor = reply[0];
      for (const key of reply[1]) matchedKeys.add(key);
    } while (cursor !== "0");

    const pods: ModerationFailurePodStats[] = [];
    let lastAtMs = local.lastAtMs;
    let lastError: string | null = local.lastError;
    let lastKind: ModerationFailureKind | null = local.lastKind;
    const byKind: Record<ModerationFailureKind, number> = {
      engine: local.pod.byKind.engine,
      persist: local.pod.byKind.persist,
    };
    if (local.pod.totalCount > 0 || events.length > 0) {
      // Always include the local pod's view, sourced from in-memory, so a
      // pod that just recorded a failure doesn't have to wait for its own
      // HSET to land before the aggregate sees the bump.
      pods.push(local.pod);
    }

    const keys = Array.from(matchedKeys);
    if (keys.length > 0) {
      const hashes = await Promise.all(keys.map((k) => redis.hgetall(k)));
      for (let i = 0; i < keys.length; i++) {
        const fields = hashes[i] || {};
        const fallbackId = keys[i].slice(POD_KEY_PREFIX.length) || keys[i];
        const parsed = parsePodHash(fields, fallbackId, windowMs, now);
        if (!parsed) continue;
        // Skip the local pod's Redis hash — we already included it from
        // the in-memory snapshot which is the authoritative view for this
        // process. Avoids double-counting when our HSET has landed.
        if (parsed.pod.instanceId === INSTANCE_ID) continue;
        pods.push(parsed.pod);
        byKind.engine += parsed.pod.byKind.engine;
        byKind.persist += parsed.pod.byKind.persist;
        if (parsed.windowLastAtMs > lastAtMs) {
          lastAtMs = parsed.windowLastAtMs;
          lastError = parsed.windowLastError;
          lastKind = parsed.windowLastKind;
        }
      }
    }

    pods.sort((a, b) => b.totalCount - a.totalCount);
    return {
      totalCount: byKind.engine + byKind.persist,
      byKind,
      lastAt: lastAtMs ? new Date(lastAtMs).toISOString() : null,
      lastError,
      lastKind,
      windowMs,
      source: "redis",
      pods,
    };
  } catch (err) {
    console.error(
      "[Moderation][Failure] Failed to aggregate pod snapshots from Redis, falling back to in-memory:",
      err,
    );
    return getModerationFailuresInWindow(windowMs, now);
  }
}

/**
 * Cumulative counters since process start. Not used for alerting (the
 * rolling window is what gates fire/clear) but surfaced on System Health
 * as a "lifetime" view and echoed into alert bodies so on-call can tell
 * a fresh outage apart from a sustained one.
 */
export function getModerationFailureCumulativeStats(): ModerationFailureCumulativeStats {
  return {
    totalCount: cumulative.engine + cumulative.persist,
    byKind: { ...cumulative },
    lastAt: cumulativeLastAt ? new Date(cumulativeLastAt).toISOString() : null,
  };
}

/** Test-only: clear all retained events and counters. */
export function __resetModerationFailureTrackerForTests(): void {
  events.length = 0;
  cumulative.engine = 0;
  cumulative.persist = 0;
  cumulativeLastAt = null;
  writtenBuckets.clear();
}
