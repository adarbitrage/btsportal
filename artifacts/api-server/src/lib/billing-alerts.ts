/**
 * Billing operational alerter.
 *
 * Queues fire-and-forget alerts for three dangerous billing transitions:
 *   (a) paid_reconciliation_needed — money moved but post-charge step failed
 *   (b) refund_side_effect_failed  — refund succeeded but grant/sub revoke failed
 *   (c) circuit_breaker_tripped    — decline-velocity breaker triggered
 *
 * Delivery goes through the shared oncall-dispatcher (PagerDuty + Email + Slack).
 * The email recipient prefers BILLING_ALERTS_EMAIL, falling back to the
 * standard opsAlertEmail from on-call settings. Alerts are always fire-and-forget
 * — no money path ever awaits them.
 *
 * Dedup: each distinct event type + key gets a throttle window so a billing
 * incident can't cause an alert storm.
 */

import {
  createOnCallDispatcher,
  createInMemoryThrottleStore,
  type AlertMessages,
  type OnCallDestinations,
} from "./oncall-dispatcher.js";
import { getOnCallDestinations } from "./oncall-settings.js";

export type BillingAlertType =
  | "reconciliation_needed"
  | "refund_side_effect_failed"
  | "circuit_breaker_tripped"
  | "renewal_charger_failed";

export interface ReconciliationNeededPayload {
  type: "reconciliation_needed";
  orderNumber: string;
  amountCents: number;
  userEmail: string;
  failedStep: string;
}

export interface RefundSideEffectFailedPayload {
  type: "refund_side_effect_failed";
  orderNumber: string;
  refundTxnId: string | undefined;
  failedSideEffect: string;
  error: string;
}

export interface CircuitBreakerTrippedPayload {
  type: "circuit_breaker_tripped";
  dimension: "user" | "ip";
  dimensionLabel: string;
  declineCount: number;
  windowSeconds: number;
  cooldownSeconds: number;
}

export interface RenewalChargerFailedPayload {
  type: "renewal_charger_failed";
  jobName: string;
  error: string;
}

export type BillingAlertPayload =
  | ReconciliationNeededPayload
  | RefundSideEffectFailedPayload
  | CircuitBreakerTrippedPayload
  | RenewalChargerFailedPayload;

const THROTTLE_MS = 5 * 60 * 1000;

const throttleStore = createInMemoryThrottleStore();

async function billingAlertDestinations(): Promise<OnCallDestinations> {
  const base = await getOnCallDestinations();
  const override = process.env.BILLING_ALERTS_EMAIL?.trim() || null;
  return {
    pagerdutyIntegrationKey: base.pagerdutyIntegrationKey,
    opsAlertEmail: override ?? base.opsAlertEmail,
    opsAlertSlackWebhookUrl: base.opsAlertSlackWebhookUrl,
  };
}

function buildMessages(payload: BillingAlertPayload): AlertMessages {
  switch (payload.type) {
    case "reconciliation_needed": {
      const amountDollars = (payload.amountCents / 100).toFixed(2);
      const summary = `BILLING ALERT: Order ${payload.orderNumber} paid but ${payload.failedStep} failed — manual reconciliation required`;
      const text =
        `Order:        ${payload.orderNumber}\n` +
        `Amount:       $${amountDollars}\n` +
        `Customer:     ${payload.userEmail}\n` +
        `Failed step:  ${payload.failedStep}\n\n` +
        `Action: Log in to the admin panel and complete the order manually. ` +
        `The charge has already gone through — do NOT attempt to re-charge.`;
      return {
        pagerduty: { dedupKey: `billing-recon-${payload.orderNumber}`, summary, severity: "error" },
        email: { subject: `[BILLING] Reconciliation needed: Order ${payload.orderNumber}`, text },
        slack: { text: `⚠️ *BILLING ALERT* — ${summary}\n${text}` },
      };
    }
    case "refund_side_effect_failed": {
      const summary = `BILLING ALERT: Refund succeeded for ${payload.orderNumber} but ${payload.failedSideEffect} failed`;
      const text =
        `Order:         ${payload.orderNumber}\n` +
        `Refund txn:    ${payload.refundTxnId ?? "(unknown)"}\n` +
        `Failed step:   ${payload.failedSideEffect}\n` +
        `Error:         ${payload.error}\n\n` +
        `Action: Manually revoke the product grant/subscription for this order if applicable.`;
      return {
        pagerduty: { dedupKey: `billing-refund-sidefx-${payload.orderNumber}`, summary, severity: "warning" },
        email: { subject: `[BILLING] Refund side-effect failed: Order ${payload.orderNumber}`, text },
        slack: { text: `⚠️ *BILLING ALERT* — ${summary}\n${text}` },
      };
    }
    case "circuit_breaker_tripped": {
      const summary = `BILLING ALERT: Decline circuit breaker tripped for ${payload.dimension} ${payload.dimensionLabel}`;
      const text =
        `Dimension:     ${payload.dimension} (${payload.dimensionLabel})\n` +
        `Declines:      ${payload.declineCount} in ${Math.round(payload.windowSeconds / 60)} minutes\n` +
        `Blocked for:   ${Math.round(payload.cooldownSeconds / 60)} minutes\n\n` +
        `Action: Review recent billing logs for potential card-testing abuse.`;
      return {
        pagerduty: {
          dedupKey: `billing-cb-${payload.dimension}-${payload.dimensionLabel}`,
          summary,
          severity: "warning",
        },
        email: { subject: `[BILLING] Circuit breaker tripped: ${payload.dimension} ${payload.dimensionLabel}`, text },
        slack: { text: `⚠️ *BILLING ALERT* — ${summary}\n${text}` },
      };
    }
    case "renewal_charger_failed": {
      const summary = `BILLING ALERT: Renewal charger job "${payload.jobName}" failed`;
      const text =
        `Job:    ${payload.jobName}\n` +
        `Error:  ${payload.error}\n\n` +
        `Action: The hourly renewal + dunning run threw before completing. Check ` +
        `server logs. Automated renewals and dunning may be delayed until the ` +
        `next successful run.`;
      return {
        pagerduty: { dedupKey: `billing-charger-failed`, summary, severity: "error" },
        email: { subject: `[BILLING] Renewal charger job failed`, text },
        slack: { text: `⚠️ *BILLING ALERT* — ${summary}\n${text}` },
      };
    }
  }
}

function dedupKey(payload: BillingAlertPayload): string {
  switch (payload.type) {
    case "reconciliation_needed":
      return `recon:${payload.orderNumber}`;
    case "refund_side_effect_failed":
      return `refund-sidefx:${payload.orderNumber}`;
    case "circuit_breaker_tripped":
      return `cb:${payload.dimension}:${payload.dimensionLabel}`;
    case "renewal_charger_failed":
      return `charger-failed`;
  }
}

const dispatcher = createOnCallDispatcher<BillingAlertPayload, string>({
  name: "BillingAlerts",
  destinations: billingAlertDestinations,
  throttleMs: () => THROTTLE_MS,
  throttleStore,
  throttleKey: (payload, channel) => `billing:${dedupKey(payload)}:${channel}`,
  buildMessages,
  kindOf: () => "fire",
});

/**
 * Queue a billing alert — fire and forget, never throws to the caller.
 * Safe to call from within money paths.
 */
export function queueBillingAlert(payload: BillingAlertPayload): void {
  dispatcher.dispatch(payload, Date.now()).catch((err) => {
    console.error("[BillingAlerts] dispatch failed:", err?.message ?? err);
  });
}

/** Test-only: inject a custom delivery function. */
export const __billingAlerterForTests = dispatcher;
