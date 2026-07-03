/**
 * Escalation + capacity alerts for the accountability-partner program
 * (Task #1629 / T9).
 *
 * Reuses the same shared on-call dispatcher plumbing (`oncall-dispatcher.ts`)
 * and poll-runner cadence as every other "page on-call when X happens"
 * alerter (retell-agent-alerter, coaching-call-template-topup-alerter,
 * etc.) — PagerDuty / SendGrid / Slack delivery, per-channel throttling, and
 * the SendGrid lazy init are all owned there. This module only contributes
 * the three state-transition detectors and their alert copy. There is
 * deliberately no ad-hoc email path here — every notification goes through
 * the shared dispatcher so on-call only ever has to learn one alert pattern.
 *
 * Three independent alert types, each with its own fire/clear state and its
 * own audit-log action type (so the System Health alert timeline can filter
 * / label them separately):
 *
 *   1. No-show escalation (`partner_noshow_alert`) — a member's 3rd
 *      consecutive no-show (no completed call in between) fires exactly one
 *      alert per escalation; it clears the moment they complete a call.
 *      Reuses `computeConsecutiveNoShows` from `partner-escalation-metrics.ts`
 *      — the exact same logic the partner dashboard roster displays, so
 *      on-call and the partner's own view can never disagree.
 *
 *   2. Vanish rule (`partner_vanish_alert`) — an active 3-Month+ member with
 *      an active partner assignment who has gone >= 14 days without a
 *      completed partner call (measured from their last completed call, or
 *      from assignment start if they have never had one). Distinct from
 *      no-show escalation: a member who simply never books doesn't
 *      accumulate no-shows, so this catches the "gone quiet" case the
 *      no-show counter can't see.
 *
 *   3. Fleet capacity (`partner_capacity_alert`) — trailing-7-day booked
 *      slots (call_bookings for ACTIVE partners) as a fraction of available
 *      slots (GHL free-slots over the next 7 days, capped per partner per
 *      day at `maxDailyCalls`) reaching >= 80% fires "time to hire".
 *      Inactive partners (e.g. Myco) are excluded from BOTH sides of the
 *      ratio — arming them is out of scope for this task.
 *
 * Out of scope (per Task #1629): GHL webhook status ingestion (T7), member
 * reminder nudges (T8), and arming any currently-inactive partner.
 */

import {
  db,
  partnersTable,
  partnerAssignmentsTable,
  usersTable,
} from "@workspace/db";
import { sql, eq, and, isNotNull } from "drizzle-orm";
import {
  createInMemoryThrottleStore,
  createOnCallDispatcher,
  createPollRunner,
  parseEnvInt,
  type AlertKind,
  type AlertMessages,
  type DeliveryFn,
  type DeliveryChannel,
  type DeliveryResult,
  type OnCallDestinations,
} from "./oncall-dispatcher";
import { logAuditEvent } from "./audit-log";
import {
  daysSince,
  computeConsecutiveNoShows,
} from "./partner-escalation-metrics";
import { PRODUCT_RANK } from "./product-rank";
import { PARTNER_ELIGIBLE_MIN_RANK } from "./partner-assignment";
import { getFreeSlots, type FreeSlot } from "./ghl-coaching-calendar";

export type { DeliveryResult };

// ---------------------------------------------------------------------------
// Audit-log identifiers. `entityType` is the shared "alert" bucket every
// on-call alerter writes to, so the System Health alert timeline can union
// them by entityType="alert" + action type. Each action type constant is
// added to the timeline's allow-list in admin-panel.ts.
// ---------------------------------------------------------------------------

export const PARTNER_NO_SHOW_ALERT_ACTION_TYPE = "partner_noshow_alert";
export const PARTNER_VANISH_ALERT_ACTION_TYPE = "partner_vanish_alert";
export const PARTNER_CAPACITY_ALERT_ACTION_TYPE = "partner_capacity_alert";
export const PARTNER_ESCALATION_ALERT_ENTITY_TYPE = "alert";

export type AlertDeliveryOutcome = "sent" | "failed" | "throttled" | "skipped";

// A member's Nth consecutive no-show (with no completed call in between)
// fires the escalation. 3 matches Task #1629's "3rd consecutive no-show".
export const NO_SHOW_ESCALATION_THRESHOLD = 3;

// Days since last completed partner call (or assignment start if never
// called) before an active 3-Month+ member is considered "vanished".
export const VANISH_DAYS_THRESHOLD = 14;

// Trailing-7-day booked/available ratio at which the fleet is considered at
// capacity and it's "time to hire" another partner.
export const CAPACITY_RATIO_THRESHOLD = 0.8;

const CAPACITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function getNotificationThrottleMs(): number {
  return parseEnvInt("PARTNER_ESCALATION_NOTIFICATION_THROTTLE_MS", 60 * 60 * 1000);
}

// 15 minutes by default, matching the scheduled-comms cadence this evaluator
// reuses the poll-runner infra from.
const POLL_MS = parseEnvInt("PARTNER_ESCALATION_ALERTER_POLL_MS", 15 * 60 * 1000);

// ---------------------------------------------------------------------------
// Payload / message building
// ---------------------------------------------------------------------------

export type PartnerEscalationAlertPayload =
  | {
      alertType: "no_show";
      kind: AlertKind;
      now: number;
      memberId: number;
      memberName: string;
      consecutiveNoShows: number;
    }
  | {
      alertType: "vanish";
      kind: AlertKind;
      now: number;
      memberId: number;
      memberName: string;
      daysSinceLastCall: number;
    }
  | {
      alertType: "capacity";
      kind: AlertKind;
      now: number;
      bookedSlots: number;
      availableSlots: number;
      ratioPct: number;
    };

function destinationsFromEnv(): OnCallDestinations {
  return {
    pagerdutyIntegrationKey: process.env.PAGERDUTY_INTEGRATION_KEY ?? null,
    opsAlertEmail: process.env.OPS_ALERT_EMAIL ?? null,
    opsAlertSlackWebhookUrl: process.env.OPS_ALERT_SLACK_WEBHOOK_URL ?? null,
  };
}

function actionTypeFor(alertType: PartnerEscalationAlertPayload["alertType"]): string {
  if (alertType === "no_show") return PARTNER_NO_SHOW_ALERT_ACTION_TYPE;
  if (alertType === "vanish") return PARTNER_VANISH_ALERT_ACTION_TYPE;
  return PARTNER_CAPACITY_ALERT_ACTION_TYPE;
}

function entityIdFor(payload: PartnerEscalationAlertPayload): string {
  if (payload.alertType === "capacity") return "partner-capacity-fleet";
  if (payload.alertType === "no_show") return `partner-noshow:${payload.memberId}`;
  return `partner-vanish:${payload.memberId}`;
}

function buildMessages(p: PartnerEscalationAlertPayload): AlertMessages {
  if (p.alertType === "no_show") {
    const subject =
      p.kind === "fire"
        ? `[ALERT] ${p.memberName} has had ${p.consecutiveNoShows} consecutive partner-call no-shows`
        : `[RESOLVED] ${p.memberName}'s partner no-show streak cleared`;
    const text =
      p.kind === "fire"
        ? [
            `${p.memberName} (member #${p.memberId}) has now no-showed ${p.consecutiveNoShows} accountability-partner calls in a row with no completed call in between.`,
            "",
            "Open /admin/partners or the partner's dashboard to follow up before the member disengages further.",
          ].join("\n")
        : [
            `${p.memberName} (member #${p.memberId}) completed a partner call, clearing their no-show escalation.`,
          ].join("\n");
    const slackText =
      p.kind === "fire"
        ? `:rotating_light: *Partner no-show escalation* — ${p.memberName} (#${p.memberId}) has ${p.consecutiveNoShows} consecutive no-shows. Check /admin/partners.`
        : `:white_check_mark: *Partner no-show escalation cleared* — ${p.memberName} (#${p.memberId}) completed a call.`;
    return {
      pagerduty: {
        dedupKey: `partner-no-show:${p.memberId}`,
        summary: `${p.memberName} has ${p.consecutiveNoShows} consecutive partner-call no-shows`,
        severity: "warning",
        component: "partner-escalation",
        class: "partner_noshow_escalation",
        custom_details: {
          memberId: p.memberId,
          consecutiveNoShows: p.consecutiveNoShows,
          link: "/admin/partners",
        },
      },
      email: { subject, text },
      slack: { text: slackText },
    };
  }

  if (p.alertType === "vanish") {
    const subject =
      p.kind === "fire"
        ? `[ALERT] ${p.memberName} has gone ${p.daysSinceLastCall} days without a completed partner call`
        : `[RESOLVED] ${p.memberName} is back in touch with their partner`;
    const text =
      p.kind === "fire"
        ? [
            `${p.memberName} (member #${p.memberId}) is an active 3-Month+ member with an active accountability-partner assignment, but has gone ${p.daysSinceLastCall} days without a completed partner call (threshold: ${VANISH_DAYS_THRESHOLD}).`,
            "",
            "Open /admin/partners or the partner's dashboard to check in before the member churns.",
          ].join("\n")
        : [
            `${p.memberName} (member #${p.memberId}) completed a partner call, clearing the vanish alert.`,
          ].join("\n");
    const slackText =
      p.kind === "fire"
        ? `:ghost: *Partner vanish alert* — ${p.memberName} (#${p.memberId}) has gone ${p.daysSinceLastCall} days without a completed partner call. Check /admin/partners.`
        : `:white_check_mark: *Partner vanish alert cleared* — ${p.memberName} (#${p.memberId}) completed a call.`;
    return {
      pagerduty: {
        dedupKey: `partner-vanish:${p.memberId}`,
        summary: `${p.memberName} has gone ${p.daysSinceLastCall} days without a completed partner call`,
        severity: "warning",
        component: "partner-escalation",
        class: "partner_vanish",
        custom_details: {
          memberId: p.memberId,
          daysSinceLastCall: p.daysSinceLastCall,
          link: "/admin/partners",
        },
      },
      email: { subject, text },
      slack: { text: slackText },
    };
  }

  // capacity
  const subject =
    p.kind === "fire"
      ? "[ALERT] Partner capacity \u2265 80% \u2014 time to hire"
      : "[RESOLVED] Partner fleet capacity back under 80%";
  const text =
    p.kind === "fire"
      ? [
          `Accountability-partner fleet booked ${p.bookedSlots} of ${p.availableSlots} available slots over the trailing 7 days (${p.ratioPct}%), at or above the ${Math.round(CAPACITY_RATIO_THRESHOLD * 100)}% threshold.`,
          "",
          "Time to hire another accountability partner. Open /admin/partners to review current roster load.",
        ].join("\n")
      : [
          `Accountability-partner fleet capacity dropped back to ${p.ratioPct}% (booked ${p.bookedSlots} of ${p.availableSlots} available slots), below the ${Math.round(CAPACITY_RATIO_THRESHOLD * 100)}% threshold.`,
        ].join("\n");
  const slackText =
    p.kind === "fire"
      ? `:rotating_light: *Partner capacity \u2265 80% \u2014 time to hire* — booked ${p.bookedSlots}/${p.availableSlots} slots (${p.ratioPct}%) over the trailing 7 days. Check /admin/partners.`
      : `:white_check_mark: *Partner fleet capacity recovered* — ${p.ratioPct}% (booked ${p.bookedSlots}/${p.availableSlots}).`;
  return {
    pagerduty: {
      dedupKey: "partner-capacity:fleet",
      summary: `Partner capacity ${p.ratioPct}% \u2014 time to hire`,
      severity: "warning",
      component: "partner-escalation",
      class: "partner_capacity_high",
      custom_details: {
        bookedSlots: p.bookedSlots,
        availableSlots: p.availableSlots,
        ratioPct: p.ratioPct,
        link: "/admin/partners",
      },
    },
    email: { subject, text },
    slack: { text: slackText },
  };
}

function classifyOutcome(result: DeliveryResult): AlertDeliveryOutcome {
  if (!result.ok) return "failed";
  if (result.skipped) {
    return result.reason === "throttled" ? "throttled" : "skipped";
  }
  return "sent";
}

function describeAttempt(
  payload: PartnerEscalationAlertPayload,
  result: DeliveryResult,
  outcome: AlertDeliveryOutcome,
): string {
  const verb = payload.kind === "fire" ? "fire" : "clear";
  const reasonSuffix = result.reason ? ` (${result.reason})` : "";
  const label =
    payload.alertType === "no_show"
      ? "no-show escalation"
      : payload.alertType === "vanish"
        ? "vanish alert"
        : "fleet capacity alert";
  switch (outcome) {
    case "sent":
      return `Sent ${verb} alert via ${result.channel} for partner ${label}`;
    case "failed":
      return `Failed to send ${verb} alert via ${result.channel} for partner ${label}${reasonSuffix}`;
    case "throttled":
      return `Throttled ${verb} alert via ${result.channel} for partner ${label}${reasonSuffix}`;
    case "skipped":
      return `Skipped ${verb} alert via ${result.channel} for partner ${label}${reasonSuffix}`;
  }
}

async function recordDeliveryAttempt(
  payload: PartnerEscalationAlertPayload,
  result: DeliveryResult,
): Promise<void> {
  const outcome = classifyOutcome(result);
  await logAuditEvent({
    actionType: actionTypeFor(payload.alertType),
    entityType: PARTNER_ESCALATION_ALERT_ENTITY_TYPE,
    entityId: entityIdFor(payload),
    description: describeAttempt(payload, result, outcome),
    metadata: {
      deliveryChannel: result.channel,
      kind: payload.kind,
      outcome,
      reason: result.reason ?? null,
      alertType: payload.alertType,
      ...(payload.alertType === "no_show"
        ? { memberId: payload.memberId, consecutiveNoShows: payload.consecutiveNoShows }
        : payload.alertType === "vanish"
          ? { memberId: payload.memberId, daysSinceLastCall: payload.daysSinceLastCall }
          : {
              bookedSlots: payload.bookedSlots,
              availableSlots: payload.availableSlots,
              ratioPct: payload.ratioPct,
            }),
    },
  });
}

const throttleStore = createInMemoryThrottleStore();

const dispatcher = createOnCallDispatcher<PartnerEscalationAlertPayload, string>({
  name: "PartnerEscalationAlerter",
  destinations: destinationsFromEnv,
  throttleMs: getNotificationThrottleMs,
  throttleStore,
  throttleKey: (p, dc) =>
    p.alertType === "capacity"
      ? `capacity:${p.kind}:${dc}`
      : `${p.alertType}:${p.memberId}:${p.kind}:${dc}`,
  buildMessages,
  kindOf: (p) => p.kind,
  onDelivery: recordDeliveryAttempt,
});

/** Test-only: replace one or more delivery functions with stubs. */
export function __setPartnerEscalationAlerterDeliveriesForTests(
  overrides: Partial<
    Record<DeliveryChannel, DeliveryFn<PartnerEscalationAlertPayload>>
  > | null,
): void {
  dispatcher.setDeliveryOverrides(overrides);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const noShowAlertingMembers = new Set<number>();
const vanishAlertingMembers = new Set<number>();
let capacityAlerting = false;

/** Test-only: reset all alerter state. */
export function __resetPartnerEscalationAlerterForTests(): void {
  noShowAlertingMembers.clear();
  vanishAlertingMembers.clear();
  capacityAlerting = false;
  throttleStore.reset();
  dispatcher.setDeliveryOverrides(null);
  freeSlotsOverride = null;
}

/** Public read-only view of current alerting state, for System Health. */
export function getPartnerEscalationAlertingState(): {
  noShowAlertingMemberIds: number[];
  vanishAlertingMemberIds: number[];
  capacityAlerting: boolean;
} {
  return {
    noShowAlertingMemberIds: Array.from(noShowAlertingMembers),
    vanishAlertingMemberIds: Array.from(vanishAlertingMembers),
    capacityAlerting,
  };
}

// ---------------------------------------------------------------------------
// (a) No-show escalation
// ---------------------------------------------------------------------------

/**
 * Reads every partner-call completed/no_show row across the whole fleet
 * (not scoped to one partner, unlike the dashboard's per-partner roster
 * query) and runs it through the exact same `computeConsecutiveNoShows`
 * the dashboard uses. Fires when a member crosses the threshold for the
 * first time; clears the moment their most recent call is a completion
 * (at which point they no longer appear in the consecutive-no-show map at
 * all).
 */
export async function evaluateNoShowEscalations(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const result = await db.execute(sql`
    SELECT cb.member_id, cb.status, u.name AS member_name
    FROM call_bookings cb
    JOIN users u ON u.id = cb.member_id
    WHERE cb.staff_type = 'partner' AND cb.status IN ('completed', 'no_show')
    ORDER BY cb.member_id, cb.scheduled_at DESC
  `);
  const rows = result.rows as Array<{
    member_id: number;
    status: string;
    member_name: string;
  }>;

  const memberNames = new Map<number, string>();
  for (const row of rows) memberNames.set(row.member_id, row.member_name);

  const consecutive = computeConsecutiveNoShows(rows);
  const currentlyEscalating = new Set<number>();
  for (const [memberId, count] of consecutive) {
    if (count >= NO_SHOW_ESCALATION_THRESHOLD) currentlyEscalating.add(memberId);
  }

  const deliveries: DeliveryResult[] = [];

  for (const memberId of currentlyEscalating) {
    if (noShowAlertingMembers.has(memberId)) continue;
    noShowAlertingMembers.add(memberId);
    const dispatched = await dispatcher.dispatch(
      {
        alertType: "no_show",
        kind: "fire",
        now,
        memberId,
        memberName: memberNames.get(memberId) ?? `Member #${memberId}`,
        consecutiveNoShows: consecutive.get(memberId) ?? NO_SHOW_ESCALATION_THRESHOLD,
      },
      now,
    );
    deliveries.push(...dispatched);
  }

  for (const memberId of Array.from(noShowAlertingMembers)) {
    if (currentlyEscalating.has(memberId)) continue;
    noShowAlertingMembers.delete(memberId);
    const dispatched = await dispatcher.dispatch(
      {
        alertType: "no_show",
        kind: "clear",
        now,
        memberId,
        memberName: memberNames.get(memberId) ?? `Member #${memberId}`,
        consecutiveNoShows: 0,
      },
      now,
    );
    deliveries.push(...dispatched);
  }

  return deliveries;
}

// ---------------------------------------------------------------------------
// (b) Vanish rule
// ---------------------------------------------------------------------------

// Product slugs whose rank qualifies for the accountability-partner program
// (rank >= PARTNER_ELIGIBLE_MIN_RANK, see partner-assignment.ts) — the same
// "3-Month+" definition used to auto-assign a partner in the first place.
function eligibleProductSlugs(): string[] {
  return Object.entries(PRODUCT_RANK)
    .filter(([, rank]) => rank >= PARTNER_ELIGIBLE_MIN_RANK)
    .map(([slug]) => slug);
}

export async function evaluateVanishRule(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const eligibleSlugsLiteral = `{${eligibleProductSlugs().join(",")}}`;

  const result = await db.execute(sql`
    SELECT pa.member_id, pa.assigned_at, u.name AS member_name,
      (
        SELECT MAX(cb.scheduled_at) FROM call_bookings cb
        WHERE cb.staff_type = 'partner' AND cb.member_id = pa.member_id AND cb.status = 'completed'
      ) AS last_completed_at
    FROM partner_assignments pa
    JOIN users u ON u.id = pa.member_id
    WHERE pa.status = 'active'
      AND EXISTS (
        SELECT 1 FROM user_products up
        JOIN products p ON p.id = up.product_id
        WHERE up.user_id = pa.member_id AND up.status = 'active'
          AND p.slug = ANY(${eligibleSlugsLiteral}::text[])
      )
  `);
  const rows = result.rows as Array<{
    member_id: number;
    assigned_at: Date;
    member_name: string;
    last_completed_at: Date | null;
  }>;

  const currentlyVanished = new Map<number, number>();
  const memberNames = new Map<number, string>();
  for (const row of rows) {
    memberNames.set(row.member_id, row.member_name);
    const anchor = row.last_completed_at ?? row.assigned_at;
    const days = daysSince(anchor, now) ?? 0;
    if (days >= VANISH_DAYS_THRESHOLD) {
      currentlyVanished.set(row.member_id, days);
    }
  }

  const deliveries: DeliveryResult[] = [];

  for (const [memberId, days] of currentlyVanished) {
    if (vanishAlertingMembers.has(memberId)) continue;
    vanishAlertingMembers.add(memberId);
    const dispatched = await dispatcher.dispatch(
      {
        alertType: "vanish",
        kind: "fire",
        now,
        memberId,
        memberName: memberNames.get(memberId) ?? `Member #${memberId}`,
        daysSinceLastCall: days,
      },
      now,
    );
    deliveries.push(...dispatched);
  }

  for (const memberId of Array.from(vanishAlertingMembers)) {
    if (currentlyVanished.has(memberId)) continue;
    vanishAlertingMembers.delete(memberId);
    const dispatched = await dispatcher.dispatch(
      {
        alertType: "vanish",
        kind: "clear",
        now,
        memberId,
        memberName: memberNames.get(memberId) ?? `Member #${memberId}`,
        daysSinceLastCall: 0,
      },
      now,
    );
    deliveries.push(...dispatched);
  }

  return deliveries;
}

// ---------------------------------------------------------------------------
// (c) Fleet capacity
// ---------------------------------------------------------------------------

type FreeSlotsFn = (
  calendarId: string,
  startMs: number,
  endMs: number,
  locationId?: string,
) => Promise<FreeSlot[]>;

let freeSlotsOverride: FreeSlotsFn | null = null;

/** Test-only: replace the GHL free-slots lookup with a deterministic stub. */
export function __setPartnerEscalationFreeSlotsFnForTests(
  fn: FreeSlotsFn | null,
): void {
  freeSlotsOverride = fn;
}

/**
 * Booked = trailing-7-day call_bookings for ACTIVE partners (any
 * non-canceled status — booked, completed, or no_show all consumed a slot).
 * Available = GHL free-slots over the NEXT 7 days per active partner,
 * bucketed by calendar day and capped at that partner's `maxDailyCalls`
 * (so a partner who technically has more open GHL slots than they're
 * willing to take calls on doesn't inflate the fleet's true capacity), then
 * summed across partners. Inactive partners (e.g. Myco) are excluded from
 * both sides — arming them is out of scope for this task.
 */
export async function evaluateFleetCapacity(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const activePartners = await db
    .select({
      id: partnersTable.id,
      maxDailyCalls: partnersTable.maxDailyCalls,
      ghlCalendarId: partnersTable.ghlCalendarId,
      ghlLocationId: partnersTable.ghlLocationId,
    })
    .from(partnersTable)
    .where(and(eq(partnersTable.isActive, true), isNotNull(partnersTable.ghlCalendarId)));

  if (activePartners.length === 0) {
    return [];
  }

  const partnerIdsLiteral = `{${activePartners.map((p) => p.id).join(",")}}`;
  const windowStart = new Date(now - CAPACITY_WINDOW_MS);
  const windowEnd = new Date(now);
  const bookedResult = await db.execute(sql`
    SELECT count(*)::int AS value
    FROM call_bookings
    WHERE staff_type = 'partner'
      AND staff_id = ANY(${partnerIdsLiteral}::int[])
      AND status != 'canceled'
      AND scheduled_at >= ${windowStart}
      AND scheduled_at < ${windowEnd}
  `);
  const bookedSlots = Number(
    (bookedResult.rows[0] as { value: number } | undefined)?.value ?? 0,
  );

  const freeSlotsFn = freeSlotsOverride ?? getFreeSlots;
  let availableSlots = 0;
  let hadFetchFailure = false;
  for (const partner of activePartners) {
    if (!partner.ghlCalendarId) continue;
    try {
      const slots = await freeSlotsFn(
        partner.ghlCalendarId,
        now,
        now + CAPACITY_WINDOW_MS,
        partner.ghlLocationId,
      );
      const perDay = new Map<string, number>();
      for (const slot of slots) {
        const day = slot.startTime.slice(0, 10);
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
      }
      for (const dayCount of perDay.values()) {
        availableSlots += Math.min(dayCount, partner.maxDailyCalls);
      }
    } catch (err) {
      hadFetchFailure = true;
      console.error(
        `[PartnerEscalationAlerter] Failed to fetch free slots for partner ${partner.id}:`,
        err,
      );
    }
  }

  if (hadFetchFailure) {
    // Availability data is incomplete (partial or total fetch failure), so the
    // booked/available ratio cannot be trusted this cycle. Skip firing OR
    // clearing to avoid false-positive escalations and false-negative clears
    // of an already-firing alert; the next successful poll will re-evaluate.
    console.warn(
      "[PartnerEscalationAlerter] Skipping fleet capacity evaluation this cycle due to incomplete free-slot data",
    );
    return [];
  }

  const ratio = availableSlots > 0 ? bookedSlots / availableSlots : 0;
  const currentlyOverCapacity = availableSlots > 0 && ratio >= CAPACITY_RATIO_THRESHOLD;
  const ratioPct = Math.round(ratio * 100);

  if (currentlyOverCapacity && !capacityAlerting) {
    capacityAlerting = true;
    return dispatcher.dispatch(
      { alertType: "capacity", kind: "fire", now, bookedSlots, availableSlots, ratioPct },
      now,
    );
  }
  if (!currentlyOverCapacity && capacityAlerting) {
    capacityAlerting = false;
    return dispatcher.dispatch(
      { alertType: "capacity", kind: "clear", now, bookedSlots, availableSlots, ratioPct },
      now,
    );
  }
  return [];
}

// ---------------------------------------------------------------------------
// Combined evaluation + poll runner
// ---------------------------------------------------------------------------

export async function evaluatePartnerEscalationAlerts(
  now: number = Date.now(),
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  results.push(...(await evaluateNoShowEscalations(now)));
  results.push(...(await evaluateVanishRule(now)));
  results.push(...(await evaluateFleetCapacity(now)));
  return results;
}

const runner = createPollRunner({
  name: "PartnerEscalationAlerter",
  pollMs: POLL_MS,
  evaluate: () => evaluatePartnerEscalationAlerts(),
  startupEvaluate: true,
});

/** Run a startup check and start the recovery poll. Idempotent. */
export function startPartnerEscalationAlerter(): void {
  runner.start();
}

/** Stop the poll. */
export function stopPartnerEscalationAlerter(): void {
  runner.stop();
}
