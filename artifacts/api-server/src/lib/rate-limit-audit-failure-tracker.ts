/**
 * Tracks failures of the audit-write hook (`onLimitExceeded`) inside the
 * abuse-rate-limit middleware. When the audit insert throws (e.g. a database
 * outage during a credential-stuffing wave), the middleware still serves a
 * 429 to the client — but the audit trail security on-callers rely on to
 * notice the attack silently disappears. This tracker increments a counter
 * for each such failure and exposes the totals so the System Health page
 * can surface "audit writes are dropping" instead of leaving operators to
 * assume "no audit rows means no attack".
 *
 * Storage strategy
 * ----------------
 * Each api-server process keeps an in-memory tally for fast in-process
 * reads, and (when Redis is configured) ALSO writes a per-pod hash to
 * Redis. The System Health endpoint reads the Redis side and aggregates
 * across every pod that's reported in the last 24h, so the "Failed writes"
 * counter on the admin UI is process-wide instead of "whichever pod served
 * this request happened to see".
 *
 * Why Redis and not the audit table itself: the failure mode this counter
 * is built to surface is "the audit table can't be written to right now",
 * so persisting through the same audit pathway would be self-defeating.
 * Redis is already shared across pods for queue-fallback alerter state and
 * abuse-rate-limit windows, so reusing it here keeps the operational
 * surface small.
 *
 * Why per-pod hashes (not a single shared counter): operators reading the
 * card during an incident want to know how many pods are currently
 * dropping audit rows and which ones — a single cluster-wide HINCRBY hides
 * the fact that one rogue pod might be responsible for all the failures.
 * Per-pod hashes keep that breakdown trivial to surface and let stale pods
 * disappear naturally via the per-key TTL.
 *
 * Each per-pod hash is rewritten with a fresh 24h TTL on every failure, so
 * pods that recover and stop failing eventually fall out of the aggregate.
 */

import os from "os";
import crypto from "crypto";
import { getRedis } from "./redis";

export interface RateLimitAuditFailureChannelStats {
  /** Number of failures observed for this limiter. */
  count: number;
  /** ISO timestamp of the most recent failure for this limiter. */
  lastAt: string | null;
  /** Short, human-readable description of the most recent error. */
  lastError: string | null;
}

export interface RateLimitAuditFailurePodStats {
  /** Stable identifier for the pod that reported these counts. */
  instanceId: string;
  /** Sum of `count` across every limiter on this pod. */
  totalCount: number;
  /** ISO timestamp of the most recent failure on this pod. */
  lastAt: string | null;
  /** Per-limiter breakdown for this pod, keyed by limiter name. */
  byName: Record<string, RateLimitAuditFailureChannelStats>;
}

export interface RateLimitAuditFailureStats {
  /** Sum of `count` across every tracked limiter and every reporting pod. */
  totalCount: number;
  /** ISO timestamp of the most recent failure across every limiter / pod. */
  lastAt: string | null;
  /** Aggregated per-limiter breakdown summed across every reporting pod. */
  byName: Record<string, RateLimitAuditFailureChannelStats>;
  /**
   * Where the snapshot was sourced from. `redis` means the count reflects
   * every pod that reported a failure in the last 24h; `memory` means
   * Redis was unavailable so only this single pod's tally is included and
   * operators should know the number is per-pod, not cluster-wide.
   */
  source: "redis" | "memory";
  /**
   * Per-pod breakdown so operators can see which pods are dropping audit
   * rows. Always includes at least the current pod (when source=memory) or
   * every pod that's reported in the last 24h (when source=redis).
   */
  pods: RateLimitAuditFailurePodStats[];
}

interface PerNameState {
  count: number;
  lastAt: number;
  lastError: string | null;
}

const state = new Map<string, PerNameState>();

/**
 * Stable per-process identifier. `os.hostname()` alone collides when two
 * replicas share a host (common in dev clusters and during blue/green
 * rollouts), and `process.pid` collides on different hosts that happen to
 * pick the same PID, so we combine both with a short random suffix to make
 * accidental collisions effectively impossible. The id is intentionally
 * human-readable so the per-pod breakdown on System Health is grep-able
 * against pod logs.
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

/** Redis key prefix for per-pod failure hashes. */
const POD_KEY_PREFIX = "rate-limit-audit-failures:pod:";
/** Per-pod hash TTL in seconds. Refreshed on every failure. */
const POD_KEY_TTL_SECONDS = 24 * 60 * 60;

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

/**
 * Mirror the in-memory increment to Redis so other pods can include this
 * pod's failure counts in their System Health snapshot. Best-effort:
 * a Redis hiccup must never block the 429 response or escalate a
 * single-database outage into an all-pods outage. In-memory tally remains
 * authoritative for this pod regardless of whether the Redis write lands.
 */
function persistPodSnapshotToRedis(): void {
  const redis = getRedis();
  if (!redis) return;
  // Build the field set from the current in-memory state. We rewrite the
  // whole hash on every failure rather than HINCRBY-ing individual fields
  // because (a) the state map is tiny (one entry per limiter, ~5 limiters
  // total in the codebase today), and (b) this guarantees the hash always
  // mirrors the in-memory snapshot exactly even if a previous write failed
  // — no risk of drift between Redis and the pod's view of itself.
  const fields: string[] = [];
  fields.push("__instanceId", INSTANCE_ID);
  let podLastAt = 0;
  for (const [name, s] of state.entries()) {
    if (s.lastAt > podLastAt) podLastAt = s.lastAt;
    fields.push(`c:${name}`, String(s.count));
    fields.push(`t:${name}`, String(s.lastAt));
    fields.push(`e:${name}`, s.lastError ?? "");
  }
  fields.push("__lastAt", String(podLastAt));
  const key = podKey(INSTANCE_ID);
  // Pipeline DEL + HSET + EXPIRE so an old hash never leaks limiter
  // entries that have since stopped failing, and so the TTL refresh
  // always rides along with the write. Errors are swallowed at every
  // layer: this is observability bookkeeping, not a correctness-critical
  // write, and a Redis hiccup must never escalate into a hot-path
  // exception that would mask the 429 path's audit-failure logging.
  try {
    const result = redis
      .multi()
      .del(key)
      .hset(key, ...fields)
      .expire(key, POD_KEY_TTL_SECONDS)
      .exec();
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      (result as Promise<unknown>).catch((err) => {
        console.error(
          "[AbuseRateLimit][AuditFailure] Failed to mirror pod snapshot to Redis:",
          err,
        );
      });
    }
  } catch (err) {
    console.error(
      "[AbuseRateLimit][AuditFailure] Failed to dispatch pod snapshot to Redis:",
      err,
    );
  }
}

/**
 * Increment the failure counter for `name` and emit a structured warning
 * line. Safe to call from any hot path — pure in-memory bookkeeping plus a
 * single `console.warn` and a fire-and-forget Redis write.
 */
export function recordRateLimitAuditFailure(
  name: string,
  err: unknown,
): void {
  const now = Date.now();
  const message = describeError(err);
  const cur = state.get(name);
  if (cur) {
    cur.count++;
    cur.lastAt = now;
    cur.lastError = message;
  } else {
    state.set(name, { count: 1, lastAt: now, lastError: message });
  }
  // Distinct prefix from the generic `[AbuseRateLimit:*] onLimitExceeded
  // error:` line so log-based alerting can count this signal independently
  // — operators want a separate "audit writes are silently failing" alert
  // from the noisier per-error line.
  console.warn(
    `[AbuseRateLimit][AuditFailure] limiter=${name} error=${message} at=${new Date(now).toISOString()} pod=${INSTANCE_ID}`,
  );
  // Mirror to Redis so other pods' System Health snapshot can include
  // this failure. Synchronously fires the multi() chain; we don't await
  // because the caller (the rate-limit middleware) needs to send the 429
  // back to the client immediately.
  persistPodSnapshotToRedis();
}

function emptyPodStats(instanceId: string): RateLimitAuditFailurePodStats {
  return { instanceId, totalCount: 0, lastAt: null, byName: {} };
}

function buildLocalPodSnapshot(): RateLimitAuditFailurePodStats {
  const pod = emptyPodStats(INSTANCE_ID);
  let lastAtMs = 0;
  for (const [name, s] of state.entries()) {
    pod.totalCount += s.count;
    if (s.lastAt > lastAtMs) lastAtMs = s.lastAt;
    pod.byName[name] = {
      count: s.count,
      lastAt: s.lastAt ? new Date(s.lastAt).toISOString() : null,
      lastError: s.lastError,
    };
  }
  pod.lastAt = lastAtMs ? new Date(lastAtMs).toISOString() : null;
  return pod;
}

function aggregatePods(
  pods: RateLimitAuditFailurePodStats[],
  source: "redis" | "memory",
): RateLimitAuditFailureStats {
  let totalCount = 0;
  let lastAtMs = 0;
  const byName: Record<string, RateLimitAuditFailureChannelStats> = {};
  for (const pod of pods) {
    totalCount += pod.totalCount;
    if (pod.lastAt) {
      const ts = new Date(pod.lastAt).getTime();
      if (Number.isFinite(ts) && ts > lastAtMs) lastAtMs = ts;
    }
    for (const [name, ch] of Object.entries(pod.byName)) {
      const existing = byName[name];
      const chLastAtMs = ch.lastAt ? new Date(ch.lastAt).getTime() : 0;
      if (!existing) {
        byName[name] = {
          count: ch.count,
          lastAt: ch.lastAt,
          lastError: ch.lastError,
        };
      } else {
        existing.count += ch.count;
        const existingLastAtMs = existing.lastAt
          ? new Date(existing.lastAt).getTime()
          : 0;
        if (chLastAtMs > existingLastAtMs) {
          existing.lastAt = ch.lastAt;
          existing.lastError = ch.lastError;
        }
      }
    }
  }
  // Sort pods by total desc so the noisiest one shows first in the UI.
  pods.sort((a, b) => b.totalCount - a.totalCount);
  return {
    totalCount,
    lastAt: lastAtMs ? new Date(lastAtMs).toISOString() : null,
    byName,
    source,
    pods,
  };
}

function parsePodHash(
  fields: Record<string, string>,
  fallbackKey: string,
): RateLimitAuditFailurePodStats | null {
  const instanceId = fields.__instanceId || fallbackKey;
  const pod = emptyPodStats(instanceId);
  // Field convention from persistPodSnapshotToRedis:
  //   c:<name> -> count
  //   t:<name> -> lastAt (ms)
  //   e:<name> -> lastError
  // Plus __lastAt and __instanceId. Group by limiter name first so we can
  // reject limiter entries that are missing the count (the only required
  // field) instead of inserting a zeroed-out half-row.
  const byNameRaw = new Map<
    string,
    { count?: number; lastAt?: number; lastError?: string }
  >();
  let podLastAt = 0;
  for (const [field, value] of Object.entries(fields)) {
    if (field.startsWith("__")) {
      if (field === "__lastAt") {
        const ts = Number.parseInt(value, 10);
        if (Number.isFinite(ts) && ts > podLastAt) podLastAt = ts;
      }
      continue;
    }
    const colon = field.indexOf(":");
    if (colon <= 0) continue;
    const kind = field.slice(0, colon);
    const name = field.slice(colon + 1);
    if (!name) continue;
    const entry = byNameRaw.get(name) ?? {};
    if (kind === "c") {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n) && n > 0) entry.count = n;
    } else if (kind === "t") {
      const ts = Number.parseInt(value, 10);
      if (Number.isFinite(ts) && ts > 0) entry.lastAt = ts;
    } else if (kind === "e") {
      entry.lastError = value === "" ? undefined : value;
    }
    byNameRaw.set(name, entry);
  }
  for (const [name, raw] of byNameRaw.entries()) {
    if (typeof raw.count !== "number") continue;
    pod.totalCount += raw.count;
    const lastAtMs = raw.lastAt ?? 0;
    if (lastAtMs > podLastAt) podLastAt = lastAtMs;
    pod.byName[name] = {
      count: raw.count,
      lastAt: lastAtMs ? new Date(lastAtMs).toISOString() : null,
      lastError: raw.lastError ?? null,
    };
  }
  if (pod.totalCount === 0 && Object.keys(pod.byName).length === 0) {
    return null;
  }
  pod.lastAt = podLastAt ? new Date(podLastAt).toISOString() : null;
  return pod;
}

/**
 * Synchronous, in-process snapshot for callers that can't await — used as
 * the fallback when Redis is not configured or unreachable, and kept on
 * the public API so existing tests that exercise just one pod's view can
 * keep using it. Production callers (the System Health endpoint) should
 * prefer `getRateLimitAuditFailureStatsAggregated()` so the number is
 * cluster-wide instead of per-pod.
 */
export function getRateLimitAuditFailureStats(): RateLimitAuditFailureStats {
  const pod = buildLocalPodSnapshot();
  return aggregatePods([pod], "memory");
}

/**
 * Cluster-wide snapshot of the per-pod failure counters. SCANs the
 * `rate-limit-audit-failures:pod:*` keyspace, parses each pod's hash, and
 * sums into a single view. Falls back to the in-memory snapshot if Redis
 * is unavailable or the SCAN fails — the same defensive posture used by
 * the queue-fallback alerter state module.
 *
 * Always includes the current pod's own latest snapshot in the result, so
 * a freshly-ticked failure shows up immediately on the pod that handled
 * the request even if the Redis write hasn't propagated yet.
 */
export async function getRateLimitAuditFailureStatsAggregated(): Promise<RateLimitAuditFailureStats> {
  const redis = getRedis();
  if (!redis) {
    return getRateLimitAuditFailureStats();
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

    const keys = Array.from(matchedKeys);
    const pods: RateLimitAuditFailurePodStats[] = [];
    const seenInstances = new Set<string>();
    if (keys.length > 0) {
      const hashes = await Promise.all(keys.map((k) => redis.hgetall(k)));
      for (let i = 0; i < keys.length; i++) {
        const fields = hashes[i] || {};
        const fallbackId = keys[i].slice(POD_KEY_PREFIX.length) || keys[i];
        const pod = parsePodHash(fields, fallbackId);
        if (!pod) continue;
        seenInstances.add(pod.instanceId);
        pods.push(pod);
      }
    }
    // Make sure this pod's own latest snapshot is represented — Redis
    // pipelines from the most recent failure may not have committed yet
    // when the System Health endpoint races to read.
    if (!seenInstances.has(INSTANCE_ID)) {
      const local = buildLocalPodSnapshot();
      if (local.totalCount > 0) pods.push(local);
    } else {
      // If the Redis copy of OUR pod is stale (e.g. an older HSET landed
      // before the most recent in-memory increment), trust the in-memory
      // tally — it is the source of truth for this pod and the Redis copy
      // will catch up on the next failure.
      const local = buildLocalPodSnapshot();
      const idx = pods.findIndex((p) => p.instanceId === INSTANCE_ID);
      if (idx >= 0 && local.totalCount > pods[idx].totalCount) {
        pods[idx] = local;
      }
    }
    return aggregatePods(pods, "redis");
  } catch (err) {
    console.error(
      "[AbuseRateLimit][AuditFailure] Failed to aggregate pod snapshots from Redis, falling back to in-memory:",
      err,
    );
    return getRateLimitAuditFailureStats();
  }
}

/** Test-only helper to reset internal counters between tests. */
export function __resetRateLimitAuditFailureTrackerForTests(): void {
  state.clear();
}
