/**
 * Shared bookkeeping for the queue-fallback alerter so that running more than
 * one api-server instance does not produce duplicate PagerDuty pages and
 * "all clear" notifications.
 *
 * Two pieces of state need to be cluster-shared:
 *   1. The per-queue-channel "are we currently alerting?" flag. Without it,
 *      every pod that observes the same outage independently fires its own
 *      "fire" alert and later its own "clear".
 *   2. The per-(queue-channel, delivery-channel, kind) throttle slot. Without
 *      it the "one page per N minutes" guarantee becomes "one page per N
 *      minutes per pod".
 *
 * When a Redis URL is configured we use Redis primitives:
 *   - Atomic compare-and-set for the alerting flag, via a tiny Lua script,
 *     so exactly one instance observes a given transition.
 *   - SET … NX EX for throttle slots, so exactly one instance wins the slot
 *     within the throttle window.
 *
 * When Redis is not configured (single-instance dev or test) we fall back to
 * a process-local in-memory map. Behavior on a single-instance deployment is
 * unchanged: in-memory state matches the (single) shared state by definition.
 *
 * On Redis errors we log and fall back to in-memory so a transient Redis
 * blip never silences an outage page.
 */

import { getRedis } from "./redis";
import type { QueueChannel } from "./queue-fallback-tracker";

export type DeliveryChannel = "pagerduty" | "email" | "slack";
export type AlertKind = "fire" | "clear";

const ALERTING_KEY_PREFIX = "queue-fallback:alerting:";
const THROTTLE_KEY_PREFIX = "queue-fallback:throttle:";

/**
 * Cap on how long the alerting flag is allowed to live in Redis without any
 * activity. Acts as a safety net so a missed "clear" event (e.g. all pods
 * crashed mid-recovery) doesn't leave the channel in alerting state forever
 * — after this much idle time it self-clears and the next outage will fire
 * a fresh page.
 */
const ALERTING_TTL_SECONDS = 24 * 60 * 60;

interface InMemoryState {
  alerting: Record<QueueChannel, boolean>;
  /** map of throttle key -> expiry epoch ms */
  throttle: Map<string, number>;
}

const memory: InMemoryState = {
  alerting: { email: false, sms: false },
  throttle: new Map(),
};

function alertingKey(ch: QueueChannel): string {
  return `${ALERTING_KEY_PREFIX}${ch}`;
}

function throttleKey(
  ch: QueueChannel,
  dc: DeliveryChannel,
  kind: AlertKind,
): string {
  return `${THROTTLE_KEY_PREFIX}${ch}:${dc}:${kind}`;
}

/**
 * Atomically set the channel's alerting flag to `newValue`. Returns true if
 * the value transitioned (i.e. was different from what we just set).
 *
 * Across multiple api-server instances, only one instance will observe a
 * given transition (the one that wins the compare-and-set). All other
 * instances see the new value already in place and get `false` back, so they
 * do not re-fire the same alert.
 */
export async function compareAndSetAlertingState(
  channel: QueueChannel,
  newValue: boolean,
): Promise<boolean> {
  const newStr = newValue ? "1" : "0";
  const redis = getRedis();
  if (!redis) {
    const prev = memory.alerting[channel];
    if (prev === newValue) return false;
    memory.alerting[channel] = newValue;
    return true;
  }
  try {
    // KEYS[1] = alerting key
    // ARGV[1] = "1" or "0" (the new value)
    // ARGV[2] = TTL in seconds
    // Returns 1 when the value changed, 0 when it was already the requested
    // value. Using EVAL keeps the read-then-write atomic across pods.
    //
    // The `or '0'` defaults a missing key to "not alerting" so a fresh pod's
    // first evaluation that observes "no outage" doesn't record a phantom
    // clear→clear transition (which would dispatch a spurious "all clear").
    const script =
      "local cur = redis.call('GET', KEYS[1]) or '0' " +
      "if cur == ARGV[1] then return 0 end " +
      "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]) " +
      "return 1";
    const result = (await redis.eval(
      script,
      1,
      alertingKey(channel),
      newStr,
      String(ALERTING_TTL_SECONDS),
    )) as number;
    return result === 1;
  } catch (err) {
    console.error(
      "[QueueFallbackAlerterState] Redis compareAndSetAlertingState failed, falling back to in-memory:",
      err,
    );
    const prev = memory.alerting[channel];
    if (prev === newValue) return false;
    memory.alerting[channel] = newValue;
    return true;
  }
}

/**
 * Try to atomically claim a throttle slot for (channel, deliveryChannel, kind).
 * Returns true if the slot was claimed (so the caller should send the alert).
 * Returns false if the slot is currently held — caller should report
 * "throttled" and skip the actual delivery.
 *
 * The slot expires after `throttleMs` so subsequent transitions can re-claim
 * it once the throttle window has passed.
 */
export async function tryClaimThrottleSlot(
  channel: QueueChannel,
  deliveryChannel: DeliveryChannel,
  kind: AlertKind,
  throttleMs: number,
  now: number = Date.now(),
): Promise<boolean> {
  if (throttleMs <= 0) return true;
  const key = throttleKey(channel, deliveryChannel, kind);
  const redis = getRedis();
  if (!redis) {
    const expiry = memory.throttle.get(key);
    if (expiry && expiry > now) return false;
    memory.throttle.set(key, now + throttleMs);
    return true;
  }
  try {
    const ttlSeconds = Math.max(1, Math.ceil(throttleMs / 1000));
    const res = await redis.set(key, "1", "EX", ttlSeconds, "NX");
    return res === "OK";
  } catch (err) {
    console.error(
      "[QueueFallbackAlerterState] Redis tryClaimThrottleSlot failed, falling back to in-memory:",
      err,
    );
    const expiry = memory.throttle.get(key);
    if (expiry && expiry > now) return false;
    memory.throttle.set(key, now + throttleMs);
    return true;
  }
}

/**
 * Release a throttle slot, e.g. after a delivery fails so the next attempt
 * can immediately re-send instead of being blocked by the slot we just
 * claimed pre-emptively.
 */
export async function releaseThrottleSlot(
  channel: QueueChannel,
  deliveryChannel: DeliveryChannel,
  kind: AlertKind,
): Promise<void> {
  const key = throttleKey(channel, deliveryChannel, kind);
  const redis = getRedis();
  if (!redis) {
    memory.throttle.delete(key);
    return;
  }
  try {
    await redis.del(key);
  } catch (err) {
    console.error(
      "[QueueFallbackAlerterState] Redis releaseThrottleSlot failed:",
      err,
    );
    memory.throttle.delete(key);
  }
}

/**
 * Where the snapshot returned by `getAlertingFlags` /
 * `getActiveThrottleSlots` was sourced from. Surfaced to the admin UI so
 * "no active throttle slots" can be distinguished from "Redis is down so
 * we're showing the per-pod in-memory fallback view, which only reflects
 * this one instance".
 */
export type AlerterStateSource = "redis" | "memory";

export interface AlerterChannelFlag {
  channel: QueueChannel;
  alerting: boolean;
}

export interface AlertingFlagsSnapshot {
  source: AlerterStateSource;
  flags: AlerterChannelFlag[];
}

export interface ThrottleSlot {
  queueChannel: QueueChannel;
  deliveryChannel: DeliveryChannel;
  kind: AlertKind;
  /** Remaining TTL in milliseconds (>=0). */
  ttlMs: number;
  /** ISO timestamp at which the slot is expected to expire. */
  expiresAt: string;
}

export interface ThrottleSlotsSnapshot {
  source: AlerterStateSource;
  slots: ThrottleSlot[];
}

const QUEUE_CHANNELS: readonly QueueChannel[] = ["email", "sms"];
const DELIVERY_CHANNELS: ReadonlySet<DeliveryChannel> = new Set([
  "pagerduty",
  "email",
  "slack",
]);
const ALERT_KINDS: ReadonlySet<AlertKind> = new Set(["fire", "clear"]);

function parseThrottleKey(key: string): {
  queueChannel: QueueChannel;
  deliveryChannel: DeliveryChannel;
  kind: AlertKind;
} | null {
  if (!key.startsWith(THROTTLE_KEY_PREFIX)) return null;
  const parts = key.slice(THROTTLE_KEY_PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  const [qc, dc, k] = parts;
  if (qc !== "email" && qc !== "sms") return null;
  if (!DELIVERY_CHANNELS.has(dc as DeliveryChannel)) return null;
  if (!ALERT_KINDS.has(k as AlertKind)) return null;
  return {
    queueChannel: qc,
    deliveryChannel: dc as DeliveryChannel,
    kind: k as AlertKind,
  };
}

/**
 * Read the current per-channel "is the queue currently alerting?" flag.
 * Used by the admin System Health page so operators can confirm at a
 * glance whether the alerter believes there's an active outage right now,
 * without waiting for the next state transition to flip a UI banner.
 *
 * Sourced from Redis when configured (so the answer matches the cluster-wide
 * truth), falling back to per-pod in-memory state otherwise. Redis errors
 * downgrade to the in-memory view rather than throwing — same defensive
 * posture the rest of this module takes.
 */
export async function getAlertingFlags(): Promise<AlertingFlagsSnapshot> {
  const redis = getRedis();
  if (!redis) {
    return {
      source: "memory",
      flags: QUEUE_CHANNELS.map((channel) => ({
        channel,
        alerting: memory.alerting[channel],
      })),
    };
  }
  try {
    const values = await Promise.all(
      QUEUE_CHANNELS.map((channel) => redis.get(alertingKey(channel))),
    );
    return {
      source: "redis",
      flags: QUEUE_CHANNELS.map((channel, idx) => ({
        channel,
        alerting: values[idx] === "1",
      })),
    };
  } catch (err) {
    console.error(
      "[QueueFallbackAlerterState] Redis getAlertingFlags failed, falling back to in-memory:",
      err,
    );
    return {
      source: "memory",
      flags: QUEUE_CHANNELS.map((channel) => ({
        channel,
        alerting: memory.alerting[channel],
      })),
    };
  }
}

/**
 * Enumerate the currently held throttle slots and how much longer each one
 * is in force. Used by the admin System Health page so operators can see
 * which (queue, delivery, kind) combinations are currently suppressing
 * additional pages and roughly when those suppressions will lift.
 *
 * Sourced from Redis via SCAN+PTTL when configured, with the per-pod
 * in-memory throttle map as the fallback. Slots whose TTL has already
 * elapsed (Redis returns 0/-2, or the in-memory map's expiry has passed)
 * are filtered out so the UI only shows live suppressions.
 */
export async function getActiveThrottleSlots(
  now: number = Date.now(),
): Promise<ThrottleSlotsSnapshot> {
  const redis = getRedis();
  if (!redis) {
    return readMemoryThrottleSlots(now);
  }
  try {
    const matchedKeys = new Set<string>();
    let cursor = "0";
    do {
      // SCAN is non-blocking and the throttle keyspace is small (at most
      // ~12 entries: 2 queue channels × 3 delivery channels × 2 kinds), so
      // a single sweep is plenty without paginating beyond the first batch.
      const reply = await redis.scan(
        cursor,
        "MATCH",
        `${THROTTLE_KEY_PREFIX}*`,
        "COUNT",
        100,
      );
      cursor = reply[0];
      for (const key of reply[1]) matchedKeys.add(key);
    } while (cursor !== "0");

    const keys = Array.from(matchedKeys);
    if (keys.length === 0) return { source: "redis", slots: [] };
    const ttls = await Promise.all(keys.map((k) => redis.pttl(k)));

    const slots: ThrottleSlot[] = [];
    for (let i = 0; i < keys.length; i++) {
      const parsed = parseThrottleKey(keys[i]);
      if (!parsed) continue;
      const ttlMs = ttls[i];
      // pttl returns -2 (no key), -1 (no expire), or a positive ms count.
      // Skip already-expired or unbounded entries — neither is meaningful
      // to surface in the "remaining TTL" UI.
      if (typeof ttlMs !== "number" || ttlMs <= 0) continue;
      slots.push({
        ...parsed,
        ttlMs,
        expiresAt: new Date(now + ttlMs).toISOString(),
      });
    }
    slots.sort((a, b) => a.ttlMs - b.ttlMs);
    return { source: "redis", slots };
  } catch (err) {
    console.error(
      "[QueueFallbackAlerterState] Redis getActiveThrottleSlots failed, falling back to in-memory:",
      err,
    );
    return readMemoryThrottleSlots(now);
  }
}

function readMemoryThrottleSlots(now: number): ThrottleSlotsSnapshot {
  const slots: ThrottleSlot[] = [];
  for (const [key, expiresAtMs] of memory.throttle.entries()) {
    if (expiresAtMs <= now) continue;
    const parsed = parseThrottleKey(key);
    if (!parsed) continue;
    slots.push({
      ...parsed,
      ttlMs: expiresAtMs - now,
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  }
  slots.sort((a, b) => a.ttlMs - b.ttlMs);
  return { source: "memory", slots };
}

/** Test-only: reset all in-memory state. Does not touch Redis. */
export function __resetQueueFallbackAlerterStateForTests(): void {
  memory.alerting.email = false;
  memory.alerting.sms = false;
  memory.throttle.clear();
}
