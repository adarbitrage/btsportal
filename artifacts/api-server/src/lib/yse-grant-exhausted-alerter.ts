/**
 * Pages on-call when a YSE grant retry row has exhausted all automatic
 * retries.
 *
 * Why this exists: `yse-grant-retry.ts` replays failed YSE webhook
 * deliveries up to a fixed cap (`YSE_GRANT_MAX_ATTEMPTS`). Once that cap
 * is hit the row sits as `status='failed'`, `attempts >= MAX_ATTEMPTS`,
 * `result IS NULL`, `next_retry_at = NULL`. A paying customer is
 * permanently without portal access until a human spots it on the admin
 * "pending/failed YSE grants" surface. This alerter proactively pages
 * on-call instead of relying on visual inspection.
 *
 * Strategy:
 *   - On every retry sweep (and on a low-cadence poll, so a row that
 *     reached the cap by a manual retry / cluster restart still gets
 *     reported), find rows where:
 *         eventType = YSE
 *         status    = 'failed'
 *         result    IS NULL
 *         attempts  >= YSE_GRANT_MAX_ATTEMPTS
 *         alert_sent_at IS NULL
 *   - For each such row, fire one on-call alert via the shared dispatcher
 *     and write `alert_sent_at = now()` so we never re-page about the
 *     same exhausted row.
 *   - The PagerDuty dedup key is per-row (`yse-grant-exhausted:<id>`)
 *     so a single stuck delivery folds into a single PD incident, and a
 *     wave of exhausted rows opens a wave of incidents — each one is a
 *     specific customer without portal access.
 *
 * Delivery, throttling, and SendGrid lazy init are owned by the shared
 * `oncall-dispatcher.ts`. Delivery channels are configured via the same
 * env vars used by the other alerters:
 *   - PagerDuty:  PAGERDUTY_INTEGRATION_KEY
 *   - Ops email:  OPS_ALERT_EMAIL  (sent via SendGrid)
 *                 SENDGRID_API_KEY required for the email channel
 *   - Slack:      OPS_ALERT_SLACK_WEBHOOK_URL
 *
 * The per-channel throttle window is short by default (1 minute) because
 * the real "don't spam on-call" defense is the per-row `alert_sent_at`
 * mark — the throttle is just a safety net against a hot-loop bug.
 * Override with `YSE_GRANT_EXHAUSTED_ALERT_THROTTLE_MS`.
 */

import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db, webhookLogsTable } from "@workspace/db";
import {
  YSE_GRANT_EVENT_TYPE,
  YSE_GRANT_MAX_ATTEMPTS,
  type ExternalGrantPayload,
} from "./external-grant-product";
import {
  createInMemoryThrottleStore,
  createOnCallDispatcher,
  createPollRunner,
  parseEnvInt,
  type AlertMessages,
  type DeliveryChannel,
  type DeliveryFn,
  type DeliveryResult,
  type OnCallDestinations,
} from "./oncall-dispatcher";

export type { DeliveryResult };

function getThrottleMs(): number {
  return parseEnvInt("YSE_GRANT_EXHAUSTED_ALERT_THROTTLE_MS", 60_000);
}

const POLL_MS = parseEnvInt("YSE_GRANT_EXHAUSTED_POLL_MS", 5 * 60 * 1000);

/**
 * How long a pod can hold the "I'm about to alert about this row" claim
 * before another pod is allowed to steal it. Sized to comfortably exceed
 * any realistic dispatch latency (PagerDuty + SendGrid + Slack in
 * parallel is sub-second in practice, multi-second under network stress)
 * while still recovering a crashed pod's claims well inside one poll
 * interval. Override with `YSE_GRANT_EXHAUSTED_ALERT_CLAIM_TTL_MS`.
 */
function getClaimTtlMs(): number {
  return parseEnvInt(
    "YSE_GRANT_EXHAUSTED_ALERT_CLAIM_TTL_MS",
    2 * 60 * 1000,
  );
}

export interface YseGrantExhaustedPayload {
  webhookLogId: number;
  externalId: string;
  externalOrderId: string | null;
  externalSource: string | null;
  customerEmail: string | null;
  productSlugs: string[];
  attempts: number;
  errorMessage: string | null;
  lastAttemptAt: Date | null;
}

function destinationsFromEnv(): OnCallDestinations {
  return {
    pagerdutyIntegrationKey: process.env.PAGERDUTY_INTEGRATION_KEY ?? null,
    opsAlertEmail: process.env.OPS_ALERT_EMAIL ?? null,
    opsAlertSlackWebhookUrl: process.env.OPS_ALERT_SLACK_WEBHOOK_URL ?? null,
  };
}

function buildMessages(p: YseGrantExhaustedPayload): AlertMessages {
  const who = p.customerEmail ?? "(unknown customer)";
  const order = p.externalOrderId ?? p.externalId;
  const summary = `YSE grant exhausted all ${YSE_GRANT_MAX_ATTEMPTS} retries — ${who} (order ${order}) has no portal access`;
  const detailLines = [
    summary,
    "",
    `Customer:       ${who}`,
    `External order: ${order}`,
    `External source: ${p.externalSource ?? "(none)"}`,
    `Products:       ${p.productSlugs.length > 0 ? p.productSlugs.join(", ") : "(none recorded)"}`,
    `Attempts:       ${p.attempts} / ${YSE_GRANT_MAX_ATTEMPTS}`,
    `Last attempt:   ${p.lastAttemptAt ? p.lastAttemptAt.toISOString() : "(none recorded)"}`,
    `Last error:     ${p.errorMessage ?? "(none recorded)"}`,
    "",
    "The automatic retry job will no longer touch this row. Investigate via",
    `/admin/webhooks (log id ${p.webhookLogId}) and use the admin "Retry now"`,
    "button to replay after fixing the root cause.",
  ];
  const slackText = `:rotating_light: *YSE grant exhausted all ${YSE_GRANT_MAX_ATTEMPTS} retries* — ${who} (order ${order}) is permanently without portal access. Investigate webhook_log id ${p.webhookLogId} on /admin/webhooks.`;
  return {
    pagerduty: {
      // Per-row dedup so each stuck grant opens its own incident and a
      // future "resolve" (manual retry succeeded) could fold against it.
      dedupKey: `yse-grant-exhausted:${p.webhookLogId}`,
      summary,
      severity: "error",
      component: "yse-grant-retry",
      class: "yse_grant_exhausted",
      custom_details: {
        webhook_log_id: p.webhookLogId,
        external_id: p.externalId,
        external_order_id: p.externalOrderId,
        customer_email: p.customerEmail,
        product_slugs: p.productSlugs,
        attempts: p.attempts,
        max_attempts: YSE_GRANT_MAX_ATTEMPTS,
      },
    },
    email: {
      subject: `[ALERT] YSE grant exhausted retries — ${who}`,
      text: detailLines.join("\n"),
    },
    slack: { text: slackText },
  };
}

const throttleStore = createInMemoryThrottleStore();

const dispatcher = createOnCallDispatcher<YseGrantExhaustedPayload, string>({
  name: "YseGrantExhaustedAlerter",
  destinations: destinationsFromEnv,
  throttleMs: getThrottleMs,
  throttleStore,
  // Per-row, per-channel throttle slot. The real "don't double-page"
  // defense is the persisted `alert_sent_at` mark; this just stops a
  // hot-loop bug from spamming on-call within the throttle window.
  throttleKey: (p, dc) => `${p.webhookLogId}:${dc}`,
  buildMessages,
  kindOf: () => "fire",
});

/** Test-only: replace one or more delivery functions with stubs. */
export function __setYseGrantExhaustedAlerterDeliveriesForTests(
  overrides: Partial<
    Record<DeliveryChannel, DeliveryFn<YseGrantExhaustedPayload>>
  > | null,
): void {
  dispatcher.setDeliveryOverrides(overrides);
}

/** Test-only: clear throttle slots / overrides. */
export function __resetYseGrantExhaustedAlerterForTests(): void {
  throttleStore.reset();
  dispatcher.setDeliveryOverrides(null);
}

export interface ExhaustedSweepResult {
  alerted: number;
  rowsConsidered: number;
}

/**
 * Find every YSE grant row that has just transitioned to "exhausted
 * retries" (attempts >= cap, not yet alerted) and page on-call about
 * each one. The `alert_sent_at` write is best-effort scoped to "page
 * succeeded somewhere or all destinations are unconfigured" — if every
 * configured channel hard-fails we leave the row un-marked so the next
 * sweep can try again.
 *
 * Safe to call frequently: the persisted `alert_sent_at` gate ensures
 * one alert per row.
 */
export async function evaluateExhaustedYseGrants(
  now: number = Date.now(),
): Promise<ExhaustedSweepResult> {
  // Atomically lease every currently-unalerted exhausted row whose claim
  // (if any) has expired, via a single UPDATE ... RETURNING. The lease
  // is a separate transient column (`alert_claimed_at`) — we only set
  // `alert_sent_at` after a dispatch actually attempts delivery, so a
  // pod that crashes between claim and dispatch loses its lease after
  // `getClaimTtlMs()` and the row becomes eligible for the next sweep.
  //
  // Two pods evaluating concurrently each see a disjoint slice (or one
  // gets the whole set and the other gets nothing), so the alert is
  // dispatched at most once per row across the cluster — and crashed
  // pods don't permanently suppress alerting.
  const claimedAt = new Date(now);
  const claimTtlMs = getClaimTtlMs();
  const staleBefore = new Date(now - claimTtlMs);
  const rows = await db
    .update(webhookLogsTable)
    .set({ alertClaimedAt: claimedAt })
    .where(
      and(
        eq(webhookLogsTable.eventType, YSE_GRANT_EVENT_TYPE),
        eq(webhookLogsTable.status, "failed"),
        isNull(webhookLogsTable.result),
        isNull(webhookLogsTable.alertSentAt),
        sql`${webhookLogsTable.attempts} >= ${YSE_GRANT_MAX_ATTEMPTS}`,
        or(
          isNull(webhookLogsTable.alertClaimedAt),
          lte(webhookLogsTable.alertClaimedAt, staleBefore),
        ),
      ),
    )
    .returning({
      id: webhookLogsTable.id,
      externalId: webhookLogsTable.externalId,
      attempts: webhookLogsTable.attempts,
      errorMessage: webhookLogsTable.errorMessage,
      lastAttemptAt: webhookLogsTable.lastAttemptAt,
      payload: webhookLogsTable.payload,
    });

  let alerted = 0;
  for (const row of rows) {
    const payload = (row.payload ?? {}) as Partial<ExternalGrantPayload> & {
      customer?: { email?: string };
    };
    const dispatchPayload: YseGrantExhaustedPayload = {
      webhookLogId: row.id,
      externalId: row.externalId,
      externalOrderId: payload.externalOrderId ?? null,
      externalSource: payload.externalSource ?? null,
      customerEmail: payload.customer?.email ?? null,
      productSlugs: Array.isArray(payload.productSlugs)
        ? payload.productSlugs
        : [],
      attempts: row.attempts,
      errorMessage: row.errorMessage,
      lastAttemptAt: row.lastAttemptAt,
    };

    let results;
    try {
      results = await dispatcher.dispatch(dispatchPayload, now);
    } catch (err) {
      // Defensive: shared dispatcher already catches per-channel errors,
      // but if the whole call rejects we release the lease immediately
      // so the next sweep can re-claim the row instead of waiting out
      // the TTL.
      await db
        .update(webhookLogsTable)
        .set({ alertClaimedAt: null })
        .where(eq(webhookLogsTable.id, row.id));
      console.error(
        `[YseGrantExhaustedAlerter] Dispatch threw for webhook_log id=${row.id}; released claim:`,
        err,
      );
      continue;
    }

    // A skip ("not_configured", "throttled", or "sendgrid_not_configured")
    // counts as delivered — re-running the sweep won't help if no
    // channels are wired up, and we don't want the row to re-page every
    // minute forever. If EVERY channel hard-failed we leave both the
    // claim and the sent-marker clear so the next sweep retries; if at
    // least one channel reported `ok`, we persist `alert_sent_at` (the
    // permanent "dispatch attempted" marker) and release the transient
    // claim. The two writes happen as a single UPDATE so a crash mid-
    // post-dispatch cannot leave us with one set and not the other.
    const anyDelivered = results.some((r) => r.ok);
    if (anyDelivered) {
      await db
        .update(webhookLogsTable)
        .set({ alertSentAt: new Date(now), alertClaimedAt: null })
        .where(eq(webhookLogsTable.id, row.id));
      alerted++;
      const okChannels = results
        .filter((r) => r.ok && !r.skipped)
        .map((r) => r.channel)
        .join(",");
      console.log(
        `[YseGrantExhaustedAlerter] Paged on-call for webhook_log id=${row.id} externalId=${row.externalId} via [${okChannels || "no-active-channel"}]`,
      );
    } else {
      await db
        .update(webhookLogsTable)
        .set({ alertClaimedAt: null })
        .where(eq(webhookLogsTable.id, row.id));
      console.error(
        `[YseGrantExhaustedAlerter] All delivery channels failed for webhook_log id=${row.id}; released claim, will retry on next sweep`,
      );
    }
  }

  return { alerted, rowsConsidered: rows.length };
}

const runner = createPollRunner({
  name: "YseGrantExhaustedAlerter",
  pollMs: POLL_MS,
  evaluate: () => evaluateExhaustedYseGrants(),
  startupEvaluate: true,
});

/** Start the low-cadence poll. Idempotent. */
export function startYseGrantExhaustedAlerter(): void {
  runner.start();
}

/** Stop the poll. */
export function stopYseGrantExhaustedAlerter(): void {
  runner.stop();
}
