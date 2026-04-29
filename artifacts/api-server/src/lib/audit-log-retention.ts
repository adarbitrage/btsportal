/**
 * Generic audit-log retention sweep.
 *
 * Background: `auditLogTable` is the durable home for every action our
 * server records. A few action types are written autonomously on every
 * event and so already have bespoke cleanup jobs:
 *   - `queue_fallback` / `queue_fallback_alert` — cleaned by
 *     `queue-fallback-audit-cleanup.ts` (30d retention).
 *   - `auth_rate_limit_blocked` — cleaned by
 *     `auth-rate-limit-audit-cleanup.ts` (30d retention).
 *
 * This module covers the next tier of action types: ones that are
 * admin-initiated (so not as bursty as the auto-logged types above) but
 * are written per-event and would still grow without bound on a busy
 * tenant. Today that's the Flexy support tooling — `regenerate_password`
 * and `notify_password` get one row per support action and a busy support
 * team can write hundreds per day. We cap them at one year of history,
 * which still comfortably covers the admin password-reset history view
 * (`/admin/apps/flexy/password-reset-history`) — that endpoint paginates
 * to a `limit` of at most 100 rows and never asks for older history.
 *
 * Adding a new noisy action type is a one-line change to `RETENTION_POLICIES`
 * below. Each policy is enforced independently, so a new entry only ever
 * deletes its own action types and can never affect the others. Unit
 * tests in `__tests__/audit-log-retention.test.ts` lock that in.
 *
 * Why the registry (instead of yet another per-type cleanup file): we
 * already have two near-identical cleanup files for the auto-logged
 * types. Forking a third file for `regenerate_password` would set a
 * pattern that scales poorly; a registry keeps the boilerplate flat as
 * the list of capped action types grows.
 */

import { db, auditLogTable } from "@workspace/db";
import { and, inArray, lt } from "drizzle-orm";
import { FLEXY_RESET_ACTIONS } from "../routes/admin-apps";

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RetentionPolicy {
  /** Human-readable label for log lines and tests. */
  label: string;
  /** action_type values this policy targets. */
  actionTypes: readonly string[];
  /** Rows older than this many days are deleted. Must be > 0. */
  retentionDays: number;
}

/**
 * The list of action types this sweep is responsible for. Action types
 * with their own dedicated cleanup job (queue_fallback*, auth_rate_limit_*)
 * are intentionally NOT listed here so they can keep their own (shorter)
 * retention windows.
 */
export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  {
    label: "flexy_password_actions",
    // Both written from the admin Flexy support tools. Capped together so
    // the matching pair (`regenerate_password` + `notify_password`) ages
    // out on the same boundary instead of leaving orphaned halves of an
    // event after a year. Imported from the route so the action_type
    // strings live in exactly one place.
    actionTypes: FLEXY_RESET_ACTIONS,
    retentionDays: 365,
  },
];

export interface PolicyRunResult {
  label: string;
  deleted: number;
}

async function runPolicy(policy: RetentionPolicy): Promise<number> {
  if (policy.retentionDays <= 0) {
    throw new Error(
      `[AuditLogRetention] Refusing to run policy "${policy.label}" with non-positive retentionDays=${policy.retentionDays}`,
    );
  }
  if (policy.actionTypes.length === 0) {
    return 0;
  }
  const cutoff = new Date(
    Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000,
  );
  const result = await db
    .delete(auditLogTable)
    .where(
      and(
        inArray(auditLogTable.actionType, [...policy.actionTypes]),
        lt(auditLogTable.createdAt, cutoff),
      ),
    );
  const deletedCount = result.rowCount ?? 0;
  if (deletedCount > 0) {
    console.log(
      `[AuditLogRetention] Deleted ${deletedCount} ${policy.actionTypes.join("/")} audit row(s) older than ${policy.retentionDays}d (policy="${policy.label}")`,
    );
  }
  return deletedCount;
}

/**
 * Run every policy in `RETENTION_POLICIES`. Each policy is wrapped in
 * its own try/catch so one failing policy can never starve the others.
 * Returns a per-policy summary so tests (and future health endpoints)
 * can assert exactly which policies fired.
 */
export async function runAuditLogRetention(): Promise<PolicyRunResult[]> {
  const results: PolicyRunResult[] = [];
  for (const policy of RETENTION_POLICIES) {
    try {
      const deleted = await runPolicy(policy);
      results.push({ label: policy.label, deleted });
    } catch (err) {
      console.error(
        `[AuditLogRetention] Policy "${policy.label}" failed:`,
        err,
      );
      results.push({ label: policy.label, deleted: 0 });
    }
  }
  return results;
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startAuditLogRetentionJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    runAuditLogRetention().catch((err) => {
      console.error("[AuditLogRetention] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  const summary = RETENTION_POLICIES.map(
    (p) => `${p.label}=${p.retentionDays}d`,
  ).join(", ");
  console.log(
    `[AuditLogRetention] Started cleanup job (every ${RUN_INTERVAL_MS / 60000}m, policies: ${summary})`,
  );
  runAuditLogRetention().catch((err) => {
    console.error("[AuditLogRetention] Initial run failed:", err);
  });
}

export function stopAuditLogRetentionJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
