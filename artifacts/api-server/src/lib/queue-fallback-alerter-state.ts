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

/** Test-only: reset all in-memory state. Does not touch Redis. */
export function __resetQueueFallbackAlerterStateForTests(): void {
  memory.alerting.email = false;
  memory.alerting.sms = false;
  memory.throttle.clear();
}
