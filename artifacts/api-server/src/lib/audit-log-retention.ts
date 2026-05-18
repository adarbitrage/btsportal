/**
 * Generic audit-log retention sweep.
 *
 * Background: `auditLogTable` is the durable home for every action our
 * server records. A few action types are written autonomously on every
 * event and so already have bespoke cleanup jobs:
 *   - `queue_fallback` / `queue_fallback_alert` — cleaned by
 *     `queue-fallback-audit-cleanup.ts` (30d retention).
 *   - `auth_rate_limit_blocked` / `auth_rate_limit_alert` — cleaned by
 *     `auth-rate-limit-audit-cleanup.ts` (30d retention).
 *
 * This module covers the remaining action types that would otherwise
 * grow without bound on a busy tenant. Today that's:
 *   - Flexy support tooling — `regenerate_password` and `notify_password`
 *     get one row per support action and a busy support team can write
 *     hundreds per day. Capped at one year, which still comfortably
 *     covers the admin password-reset history view
 *     (`/admin/apps/flexy/password-reset-history`) — that endpoint
 *     paginates to a `limit` of at most 100 rows and never asks for
 *     older history.
 *   - `signup_notice_suppressed` — written automatically by the
 *     signup-attempted email throttle. The throttle's dedup gate caps
 *     these to one row per targeted address per window, but sustained
 *     probing can still pile up thousands of rows over time. Capped at
 *     30 days to match the other auto-logged types.
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
import { SIGNUP_NOTICE_SUPPRESSED_AUDIT_ACTION } from "../routes/auth";

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
  {
    // Written automatically by the signup-attempted email throttle (see
    // `SIGNUP_NOTICE_SUPPRESSED_AUDIT_ACTION` in `routes/auth.ts`). The
    // throttle's dedup gate caps these to one row per targeted address per
    // window, but sustained probing of a busy tenant can still pile up
    // thousands of rows over time, and admins only need recent history
    // for incident retros. 30 days matches the bespoke cleanup windows
    // used by the other auto-logged auth/queue types
    // (queue_fallback*, auth_rate_limit_*).
    label: "signup_notice_suppressed",
    actionTypes: [SIGNUP_NOTICE_SUPPRESSED_AUDIT_ACTION],
    retentionDays: 30,
  },
];

export interface PolicyRunResult {
  label: string;
  deleted: number;
}

/**
 * Per-policy heartbeat tracking. Keyed by policy label so the System
 * Health page can show, for each policy independently, when it last ran,
 * how many rows it deleted, and whether the most recent attempt failed.
 *
 * Updated in the `finally` of `runPolicyTracked` so a thrown error still
 * advances `lastRanAt` (the heartbeat) while also recording the error —
 * exactly the signal an on-call needs to spot a sweep that started
 * silently failing.
 */
interface PolicyRunState {
  lastRanAt: Date;
  lastDeletedCount: number;
  lastError: { at: Date; message: string } | null;
}

const policyState = new Map<string, PolicyRunState>();

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

async function runPolicyTracked(policy: RetentionPolicy): Promise<number> {
  let deleted = 0;
  let runError: { at: Date; message: string } | null = null;
  try {
    deleted = await runPolicy(policy);
    return deleted;
  } catch (err) {
    runError = {
      at: new Date(),
      message: (err as Error)?.message ?? String(err),
    };
    throw err;
  } finally {
    policyState.set(policy.label, {
      lastRanAt: new Date(),
      lastDeletedCount: deleted,
      // A successful run clears any prior error so the System Health card
      // automatically de-flags once the sweep recovers.
      lastError: runError,
    });
  }
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
      const deleted = await runPolicyTracked(policy);
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

export interface AuditLogRetentionPolicyStatus {
  label: string;
  actionTypes: string[];
  retentionDays: number;
  lastRanAt: string | null;
  lastDeletedCount: number | null;
  lastError: { at: string; message: string } | null;
}

/**
 * Snapshot of every registered retention policy plus its most recent run
 * stats. Surfaced on the admin System Health page so on-call can confirm
 * each sweep is firing and see which one (if any) failed last.
 */
export function getAuditLogRetentionStatus(): AuditLogRetentionPolicyStatus[] {
  return RETENTION_POLICIES.map((policy) => {
    const state = policyState.get(policy.label);
    return {
      label: policy.label,
      actionTypes: [...policy.actionTypes],
      retentionDays: policy.retentionDays,
      lastRanAt: state ? state.lastRanAt.toISOString() : null,
      lastDeletedCount: state ? state.lastDeletedCount : null,
      lastError: state?.lastError
        ? { at: state.lastError.at.toISOString(), message: state.lastError.message }
        : null,
    };
  });
}

/**
 * Test hook: reset all per-policy heartbeat state. Not intended for
 * production use.
 */
export function __resetAuditLogRetentionStateForTests(): void {
  policyState.clear();
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
