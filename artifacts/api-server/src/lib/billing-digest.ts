/**
 * Daily billing digest — once-a-day summary email sent to BILLING_ALERTS_EMAIL
 * (or opsAlertEmail from on-call settings) covering:
 *
 *   - Renewal charger last-run timestamp + runs in the last 24 h (plus the
 *     lifetime total), from the DB heartbeat table (NOT Redis), with a
 *     staleness warning
 *   - Renewal successes / declines in last 24 h (from bts_orders)
 *   - Subscriptions grouped by status
 *   - Open reconciliation count (from checkout_idempotency's durable JSONB
 *     result — the only durable trace of a paid_reconciliation_needed outcome;
 *     we never query bts_orders by that status, which is never persisted there)
 *   - Refunds processed in last 24 h
 *
 * The digest is the DEAD-MAN'S-SWITCH for the renewal scheduler: its absence
 * means the billing scheduler is down. To keep that guarantee meaningful it is
 * scheduled by an in-process setInterval (NOT BullMQ/Redis, whose death is the
 * very thing being guarded) and the charger heartbeat lives in Postgres (NOT
 * Redis). Cross-process duplicate sends are prevented by an atomic DB claim
 * (claimDigestRun) so every web replica can run the timer while only one emails
 * the digest per period.
 *
 * RESIDUAL RISK (stated because full independence is not achievable in a single
 * web process): the timer + claim survive a Redis/BullMQ outage, but they do
 * NOT survive a full outage of the web process/host they run in. If that
 * process is down, both this digest AND the renewal charger it monitors go
 * silent together — external uptime monitoring of the app is the only cover for
 * that gap. This is also printed in the email footer.
 *
 * Env vars:
 *   BILLING_ALERTS_EMAIL            — recipient override (falls back to opsAlertEmail)
 *   BILLING_DIGEST_INTERVAL_MINUTES — run interval in minutes (default 1440 = 24 h; 0 = disabled)
 *   BILLING_CHARGER_STALE_HOURS     — hours since last charger run before we warn (default 3)
 *
 * The charger records its last_run_at by calling `recordChargerRun()` (in
 * billing-heartbeat.ts) on every `processDueRenewals` invocation (wired in
 * renewal-charger.ts).
 */

import sgMail from "@sendgrid/mail";
import { db, subscriptionsTable, btsOrdersTable, checkoutIdempotencyTable, refundIdempotencyTable } from "@workspace/db";
import { sql, count, and, gte, eq } from "drizzle-orm";
import { getChargerHeartbeat, claimDigestRun, releaseDigestClaim } from "./billing-heartbeat.js";
import { getOnCallDestinations } from "./oncall-settings.js";
import { ensureSendGridInitialized, defaultOpsAlertFromEmail } from "./oncall-dispatcher.js";

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getIntervalMs(): number {
  return parseEnvInt("BILLING_DIGEST_INTERVAL_MINUTES", 1440) * 60 * 1000;
}

function getStaleHours(): number {
  const h = parseEnvInt("BILLING_CHARGER_STALE_HOURS", 3);
  return h > 0 ? h : 3;
}

interface DigestStats {
  chargerLastRunAt: Date | null;
  chargerRunCount: number;
  chargerRunsLast24h: number;
  hoursSinceLastRun: number | null;
  chargerStale: boolean;
  renewalSuccessLast24h: number;
  renewalDeclineLast24h: number;
  subscriptionsByStatus: Record<string, number>;
  openReconciliationCount: number;
  refundsLast24h: number;
}

async function gatherStats(): Promise<DigestStats> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const charger = await getChargerHeartbeat();

  const [renewalRows, subStatusRows, reconRows, refundRows] = await Promise.all([
    db
      .select({
        status: btsOrdersTable.status,
        cnt: count(),
      })
      .from(btsOrdersTable)
      .where(
        and(
          sql`${btsOrdersTable.orderType} IN ('recurring_renewal', 'recurring_initial')`,
          gte(btsOrdersTable.createdAt, since24h),
        ),
      )
      .groupBy(btsOrdersTable.status),

    db
      .select({ status: subscriptionsTable.status, cnt: count() })
      .from(subscriptionsTable)
      .groupBy(subscriptionsTable.status),

    // Open reconciliations are read from the checkout_idempotency JSONB result
    // (the durable trace of a paid_reconciliation_needed outcome), NOT from
    // bts_orders — that status is never persisted on the order row.
    db
      .select({ cnt: count() })
      .from(checkoutIdempotencyTable)
      .where(
        sql`${checkoutIdempotencyTable.result}->>'outcomeType' = 'paid_reconciliation_needed'`,
      ),

    db
      .select({ cnt: count() })
      .from(refundIdempotencyTable)
      .where(
        and(
          eq(refundIdempotencyTable.status, "completed"),
          sql`${refundIdempotencyTable.result}->>'outcome' = 'success'`,
          gte(refundIdempotencyTable.completedAt!, since24h),
        ),
      ),
  ]);

  let renewalSuccessLast24h = 0;
  let renewalDeclineLast24h = 0;
  for (const row of renewalRows) {
    if (row.status === "paid") renewalSuccessLast24h += Number(row.cnt);
    else if (row.status === "failed") renewalDeclineLast24h += Number(row.cnt);
  }

  const subscriptionsByStatus: Record<string, number> = {};
  for (const row of subStatusRows) {
    subscriptionsByStatus[row.status] = Number(row.cnt);
  }

  const openReconciliationCount = Number(reconRows[0]?.cnt ?? 0);
  const refundsLast24h = Number(refundRows[0]?.cnt ?? 0);

  const hoursSinceLastRun = charger.lastRunAt
    ? (Date.now() - charger.lastRunAt.getTime()) / (60 * 60 * 1000)
    : null;
  const chargerStale =
    hoursSinceLastRun === null || hoursSinceLastRun > getStaleHours();

  return {
    chargerLastRunAt: charger.lastRunAt,
    chargerRunCount: charger.runCount,
    chargerRunsLast24h: charger.runsLast24h,
    hoursSinceLastRun,
    chargerStale,
    renewalSuccessLast24h,
    renewalDeclineLast24h,
    subscriptionsByStatus,
    openReconciliationCount,
    refundsLast24h,
  };
}

function buildDigestEmail(stats: DigestStats): { subject: string; text: string } {
  const now = new Date().toUTCString();
  const subLines = Object.entries(stats.subscriptionsByStatus)
    .map(([s, c]) => `    ${s.padEnd(12)} ${c}`)
    .join("\n") || "    (none)";

  const lastRunDisplay = stats.chargerLastRunAt
    ? stats.chargerLastRunAt.toUTCString()
    : "UNKNOWN — charger has never recorded a run!";

  const sinceDisplay =
    stats.hoursSinceLastRun === null
      ? "n/a"
      : `${stats.hoursSinceLastRun.toFixed(1)} h ago`;

  const staleWarning = stats.chargerStale
    ? `\n⚠️  Charger looks STALLED — no run in over ${getStaleHours()} h. ` +
      `Automated renewals and dunning may not be running. Investigate now.`
    : "";

  const reconWarning =
    stats.openReconciliationCount > 0
      ? `\n⚠️  ${stats.openReconciliationCount} order(s) need manual reconciliation — check the admin panel.`
      : "";

  const text =
    `BTS Billing Daily Digest — ${now}\n` +
    `${"─".repeat(60)}\n\n` +
    `RENEWAL CHARGER\n` +
    `  Last run:          ${lastRunDisplay}\n` +
    `  Since last run:    ${sinceDisplay}\n` +
    `  Runs (last 24 h):  ${stats.chargerRunsLast24h}\n` +
    `  Total runs:        ${stats.chargerRunCount}${staleWarning}\n\n` +
    `RENEWALS (last 24 h)\n` +
    `  Succeeded:         ${stats.renewalSuccessLast24h}\n` +
    `  Declined:          ${stats.renewalDeclineLast24h}\n\n` +
    `SUBSCRIPTIONS (current totals)\n` +
    `${subLines}\n\n` +
    `RECONCILIATION\n` +
    `  Open (all time):   ${stats.openReconciliationCount}${reconWarning}\n\n` +
    `REFUNDS (last 24 h): ${stats.refundsLast24h}\n\n` +
    `${"─".repeat(60)}\n` +
    `⚠️  If you stop receiving this email, the billing scheduler is DOWN.\n` +
    `   Investigate immediately — automated renewals and dunning will not run.\n\n` +
    `RESIDUAL RISK: this digest is scheduled by an in-process timer (not\n` +
    `BullMQ/Redis) and its heartbeat lives in Postgres, so it survives a Redis\n` +
    `outage. It does NOT survive a full outage of the web process/host it runs\n` +
    `in: if that process is down, both this digest AND the renewal charger it\n` +
    `monitors go silent together. External uptime monitoring of the app is the\n` +
    `only cover for that gap.`;

  return {
    subject: `[BTS Billing Digest] ${now}`,
    text,
  };
}

export interface DigestRunResult {
  outcome:
    | "sent"
    | "skipped_no_recipient"
    | "skipped_sendgrid_not_configured"
    | "skipped_already_sent"
    | "failed";
  recipient: string | null;
  reason?: string;
}

let emailSenderOverride: ((msg: { to: string; from: string; subject: string; text: string }) => Promise<void>) | null = null;

export function __setBillingDigestEmailSender(
  fn: typeof emailSenderOverride,
): void {
  emailSenderOverride = fn;
}

/**
 * How long (ms) must elapse before a new digest may be claimed. Set slightly
 * below the schedule interval so clock jitter across replicas never skips a
 * legitimate period, while still preventing two replicas from both sending
 * within the same period.
 */
function getClaimMinIntervalMs(): number {
  const intervalMs = getIntervalMs();
  const slack = Math.min(intervalMs * 0.1, 15 * 60 * 1000);
  return Math.max(intervalMs - slack, Math.floor(intervalMs / 2));
}

export async function runBillingDigest(
  opts: { force?: boolean } = {},
): Promise<DigestRunResult> {
  const dest = await getOnCallDestinations();
  const to = process.env.BILLING_ALERTS_EMAIL?.trim() || dest.opsAlertEmail;
  if (!to) {
    return { outcome: "skipped_no_recipient", recipient: null };
  }

  if (!emailSenderOverride && !ensureSendGridInitialized()) {
    return { outcome: "skipped_sendgrid_not_configured", recipient: to };
  }

  // DB-guarded duplicate prevention: only the replica/tick that wins this
  // atomic claim proceeds to send. Manual/test invocations pass force to bypass.
  let claimed = true;
  if (!opts.force) {
    try {
      claimed = await claimDigestRun(getClaimMinIntervalMs());
    } catch (err) {
      console.error("[BillingDigest] Claim query failed:", err);
      return {
        outcome: "failed",
        recipient: to,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    if (!claimed) {
      return { outcome: "skipped_already_sent", recipient: to };
    }
  }

  // Once claimed, any downstream failure releases the claim so the next
  // scheduler tick can retry instead of the period being silently swallowed.
  const releaseOnFailure = async () => {
    if (!opts.force) await releaseDigestClaim().catch(() => {});
  };

  let stats: DigestStats;
  try {
    stats = await gatherStats();
  } catch (err) {
    console.error("[BillingDigest] Stats query failed:", err);
    await releaseOnFailure();
    return {
      outcome: "failed",
      recipient: to,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const { subject, text } = buildDigestEmail(stats);
  const from = defaultOpsAlertFromEmail();

  try {
    if (emailSenderOverride) {
      await emailSenderOverride({ to, from, subject, text });
    } else {
      await sgMail.send({ to, from, subject, text });
    }
    console.log(`[BillingDigest] Sent to ${to}`);
    return { outcome: "sent", recipient: to };
  } catch (err) {
    console.error("[BillingDigest] Email send failed:", err);
    await releaseOnFailure();
    return {
      outcome: "failed",
      recipient: to,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

let digestInterval: ReturnType<typeof setInterval> | null = null;

export function startBillingDigestJob(): void {
  const intervalMs = getIntervalMs();
  if (intervalMs <= 0) return;
  digestInterval = setInterval(() => {
    runBillingDigest().catch((err) => {
      console.error("[BillingDigest] scheduled run error:", err);
    });
  }, intervalMs);
  digestInterval.unref?.();
  console.log(
    `[BillingDigest] Daily digest job started (every ${Math.round(intervalMs / 60_000)} min)`,
  );
}

export function stopBillingDigestJob(): void {
  if (digestInterval) {
    clearInterval(digestInterval);
    digestInterval = null;
  }
}
