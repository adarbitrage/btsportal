/**
 * Auto top-up for recurring coaching-call templates.
 *
 * Background: a recurring template (`coaching_call_templates`) only ever
 * materialises a fixed batch of `coaching_calls` rows up front — when it is
 * created and whenever an admin clicks "Generate". Once those generated weeks
 * are used up the series silently stops appearing on the member schedule until
 * someone remembers to extend it by hand.
 *
 * This job walks every ACTIVE template on a periodic timer and, reusing the
 * exact same generation logic as the admin "Generate" button
 * (`generateForTemplate`), keeps each series populated at least
 * `LOOKAHEAD_DAYS` into the future. Inactive/paused templates are skipped, so
 * pausing a series remains the way to stop it growing.
 *
 * Why this is safe to run unattended:
 *   - `generateForTemplate` advances the template's strictly-forward watermark
 *     (`lastGeneratedAt`), so a cancelled occurrence is never resurrected.
 *   - The unique (template_id, scheduled_at) index + `onConflictDoNothing`
 *     make generation idempotent, so overlapping runs / retries never produce
 *     duplicate calls.
 *
 * Each template is topped up in a small loop: a single batch
 * (`occurrencesPerBatch`) may not span the whole look-ahead window when the
 * batch is small or the series has fallen far behind (e.g. it already ran dry),
 * so we keep generating batches until the watermark clears the horizon, capped
 * by `MAX_BATCHES_PER_RUN` so a misconfigured template can never loop
 * unbounded. Because generation always moves strictly forward from the
 * watermark, a long-dormant series is recovered by marching its occurrences
 * forward to (and past) the present.
 */

import { db, coachingCallTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  generateForTemplate,
  type TemplateRow,
} from "../routes/admin-coaching-calls";

const DAY_MS = 24 * 60 * 60 * 1000;

// Run the sweep once a day. Generation is idempotent, so the exact cadence
// only affects how promptly a series is topped up, never correctness.
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Keep every active series populated at least this far into the future. With
// the default cadence (weekly, 8 weeks per batch) a daily sweep tops a series
// back up to ~8 weeks out long before it drops under four.
const LOOKAHEAD_DAYS = 28;

// Hard cap on how many batches a single template may generate in one run. This
// bounds the recovery of a long-dormant series (and protects against a
// pathological interval/batch combination) so the job can never spin.
const MAX_BATCHES_PER_RUN = 26;

// Twice the run interval. If no *successful* sweep has landed within this
// window the series are at risk of running dry, so the watchdog
// (`coaching-call-template-topup-alerter.ts`) pages on-call. The 2× factor
// matches every other scheduled-sweep staleness check (abuse rate-limit
// cleanup, audit-log retention) so on-call only has to learn one rule.
const STALE_AFTER_MS = 2 * RUN_INTERVAL_MS;

export interface TemplateTopUpResult {
  templateId: number;
  created: number;
  batches: number;
}

// ---------------------------------------------------------------------------
// Heartbeat / health tracking
// ---------------------------------------------------------------------------
//
// This job is the only thing keeping recurring coaching-call series populated
// into the future. If its timer silently dies, or every run starts throwing,
// the series quietly run dry again — the exact failure this feature was built
// to prevent. We record a heartbeat on every run plus, separately, the time of
// the last *successful* sweep so a watchdog (and the admin System Health page)
// can tell the difference between "timer stopped" and "running but erroring
// every time": both collapse into "no successful run within 2× the interval".

interface TopUpRunState {
  /** Wall-clock of the most recent run attempt (success OR failure). */
  lastRanAt: Date | null;
  /** Wall-clock of the most recent run that actually completed the sweep. */
  lastSuccessfulRunAt: Date | null;
  /** Summary of the most recent run for the System Health card. */
  lastResult: { templates: number; created: number; failed: number } | null;
  /**
   * The error from the most recent run, if it failed. Cleared by the next
   * successful (or partially-successful) run so the watchdog de-flags
   * automatically once the job recovers.
   */
  lastError: { at: Date; message: string } | null;
}

const runState: TopUpRunState = {
  lastRanAt: null,
  lastSuccessfulRunAt: null,
  lastResult: null,
  lastError: null,
};

// Baseline used to compute staleness before the first run lands. Set at module
// load — process start in production, the same moment the job's timer is
// installed. If no successful sweep shows up within 2× the interval from here,
// the watchdog treats the job as stale instead of leaving it "Pending"
// forever.
let baselineSince = new Date();

/**
 * Per-template heartbeat tracking. Keyed by template id so the admin
 * System Health page (and the recurring-templates list) can show, for
 * each active series independently, when the top-up job last ran against
 * it, how many calls that run generated, and whether the most recent
 * attempt failed.
 *
 * Mirrors the `policyState` / `getAuditLogRetentionStatus` pattern in
 * `audit-log-retention.ts`. Updated in the `finally` of
 * `topUpTemplateTracked` so a thrown error still advances `lastRanAt`
 * (the heartbeat) while also recording the error — exactly the signal an
 * admin needs to spot a series that stopped extending.
 *
 * `title` is captured alongside the heartbeat so the status surface can
 * label each series without a second DB round-trip; it is refreshed on
 * every run so a renamed template shows its current title.
 */
interface TemplateTopUpState {
  templateId: number;
  title: string;
  lastRanAt: Date;
  lastCreatedCount: number;
  lastBatches: number;
  lastError: { at: Date; message: string } | null;
}

const templateState = new Map<number, TemplateTopUpState>();

/**
 * Extend a single template until its watermark is at least `LOOKAHEAD_DAYS`
 * ahead of `now`, reusing the admin "Generate" logic. Returns how many calls
 * were created and how many batches it took.
 */
async function topUpTemplate(
  template: TemplateRow,
  now: number,
): Promise<TemplateTopUpResult> {
  const horizon = now + LOOKAHEAD_DAYS * DAY_MS;
  let current = template;
  let created = 0;
  let batches = 0;

  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    // Already populated past the horizon — nothing to do.
    if (current.lastGeneratedAt && current.lastGeneratedAt.getTime() >= horizon) {
      break;
    }
    const { created: batchCreated, through } = await generateForTemplate(
      current,
      current.occurrencesPerBatch,
    );
    created += batchCreated;
    batches += 1;
    // Mirror the persisted watermark in-memory so the next loop iteration
    // generates strictly forward from where this batch ended.
    current = { ...current, lastGeneratedAt: through };
  }

  return { templateId: template.id, created, batches };
}

/**
 * Top a single template up and record its heartbeat. The heartbeat is
 * written in the `finally` so a thrown error still advances `lastRanAt`
 * while recording the error — a successful run clears any prior error so
 * the status surface automatically de-flags once the series recovers.
 */
async function topUpTemplateTracked(
  template: TemplateRow,
  now: number,
): Promise<TemplateTopUpResult> {
  let result: TemplateTopUpResult = {
    templateId: template.id,
    created: 0,
    batches: 0,
  };
  let runError: { at: Date; message: string } | null = null;
  try {
    result = await topUpTemplate(template, now);
    return result;
  } catch (err) {
    runError = {
      at: new Date(),
      message: (err as Error)?.message ?? String(err),
    };
    throw err;
  } finally {
    templateState.set(template.id, {
      templateId: template.id,
      title: template.title,
      lastRanAt: new Date(),
      lastCreatedCount: result.created,
      lastBatches: result.batches,
      lastError: runError,
    });
  }
}

/**
 * Walk every active template and top each one up to the look-ahead horizon.
 * Each template is wrapped in its own try/catch so one failing series can
 * never starve the rest of the schedule. Returns a per-template summary so
 * tests (and any future health surface) can assert exactly what happened.
 */
export async function runCoachingCallTemplateTopUp(): Promise<
  TemplateTopUpResult[]
> {
  const now = Date.now();
  const templates = await db
    .select()
    .from(coachingCallTemplatesTable)
    .where(eq(coachingCallTemplatesTable.active, true));

  const results: TemplateTopUpResult[] = [];
  let templatesFailed = 0;
  let createdTotal = 0;
  // Remember the most recent per-template error so an all-failed run can
  // surface a concrete cause to on-call.
  let lastTemplateError: Error | null = null;
  for (const template of templates) {
    try {
      const result = await topUpTemplateTracked(template, now);
      createdTotal += result.created;
      if (result.created > 0) {
        console.log(
          `[CoachingCallTopUp] Template ${template.id} ("${template.title}"): generated ${result.created} call(s) across ${result.batches} batch(es)`,
        );
      }
      results.push(result);
    } catch (err) {
      templatesFailed += 1;
      lastTemplateError = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[CoachingCallTopUp] Template ${template.id} ("${template.title}") failed:`,
        err,
      );
      results.push({ templateId: template.id, created: 0, batches: 0 });
    }
  }

  // A run only counts as a *failure* (for the heartbeat / watchdog) when it
  // accomplished nothing because of errors: there were active templates and
  // every single one threw. A partial failure (>=1 template succeeded) and an
  // empty schedule (no active templates) both count as a healthy heartbeat —
  // per-template isolation is intentional and a quiet week is not an outage.
  const ranAt = new Date();
  runState.lastRanAt = ranAt;
  runState.lastResult = {
    templates: templates.length,
    created: createdTotal,
    failed: templatesFailed,
  };
  const allTemplatesFailed =
    templates.length > 0 && templatesFailed === templates.length;
  if (allTemplatesFailed && lastTemplateError) {
    runState.lastError = { at: ranAt, message: lastTemplateError.message };
  } else {
    runState.lastSuccessfulRunAt = ranAt;
    runState.lastError = null;
  }

  return results;
}

export interface CoachingCallTemplateTopUpStatus {
  templateId: number;
  title: string;
  lastRanAt: string | null;
  lastCreatedCount: number | null;
  lastBatches: number | null;
  lastError: { at: string; message: string } | null;
}

/**
 * Snapshot of every recurring template the auto top-up job has run
 * against, plus its most recent run stats. Surfaced on the admin System
 * Health page so staff can confirm each series is being extended and spot
 * one that started failing. Ordered by template id for a stable render.
 *
 * Only templates the job has actually swept appear here — a template that
 * has never been topped up (e.g. created since the last run, or always
 * inactive) simply has no heartbeat yet.
 */
export function getCoachingCallTemplateTopUpStatus(): CoachingCallTemplateTopUpStatus[] {
  return [...templateState.values()]
    .sort((a, b) => a.templateId - b.templateId)
    .map((state) => ({
      templateId: state.templateId,
      title: state.title,
      lastRanAt: state.lastRanAt.toISOString(),
      lastCreatedCount: state.lastCreatedCount,
      lastBatches: state.lastBatches,
      lastError: state.lastError
        ? {
            at: state.lastError.at.toISOString(),
            message: state.lastError.message,
          }
        : null,
    }));
}

export interface CoachingCallTemplateTopUpHealth {
  /** Configured run interval in ms. */
  intervalMs: number;
  /** ISO of the most recent run attempt (success OR failure), or null. */
  lastRanAt: string | null;
  /** ISO of the most recent run that completed the sweep, or null. */
  lastSuccessfulRunAt: string | null;
  /** Summary of the most recent run, or null before the first run. */
  lastResult: { templates: number; created: number; failed: number } | null;
  /** Error from the most recent run if it failed, else null. */
  lastError: { at: string; message: string } | null;
  /**
   * True when no successful sweep has landed within 2× the run interval.
   * Covers both failure modes the watchdog watches for: the timer stopping
   * entirely (no run at all) and the job running but erroring every time
   * (`lastSuccessfulRunAt` stops advancing while `lastRanAt` keeps moving).
   */
  stale: boolean;
}

/**
 * Job-level heartbeat snapshot. Consumed by the watchdog
 * (`coaching-call-template-topup-alerter.ts`) and surfaced on the admin
 * System Health endpoint so on-call can confirm the job is still firing.
 * Distinct from the per-template `getCoachingCallTemplateTopUpStatus`: this
 * answers "is the sweep itself alive?", that answers "which series got
 * extended?".
 */
export function getCoachingCallTemplateTopUpHealth(): CoachingCallTemplateTopUpHealth {
  // Before the first successful run we fall back to the module-load baseline:
  // a process that has been up longer than 2 intervals without a single
  // successful sweep is itself the regression worth surfacing.
  const referenceTs = (
    runState.lastSuccessfulRunAt ?? baselineSince
  ).getTime();
  const stale = Date.now() - referenceTs > STALE_AFTER_MS;
  return {
    intervalMs: RUN_INTERVAL_MS,
    lastRanAt: runState.lastRanAt ? runState.lastRanAt.toISOString() : null,
    lastSuccessfulRunAt: runState.lastSuccessfulRunAt
      ? runState.lastSuccessfulRunAt.toISOString()
      : null,
    lastResult: runState.lastResult ? { ...runState.lastResult } : null,
    lastError: runState.lastError
      ? {
          at: runState.lastError.at.toISOString(),
          message: runState.lastError.message,
        }
      : null,
    stale,
  };
}

/**
 * Test hook: reset both the per-template heartbeat state and the job-level
 * heartbeat back to a clean slate so each test can assert from scratch. Not
 * intended for production use.
 */
export function __resetCoachingCallTemplateTopUpStateForTests(): void {
  templateState.clear();
  runState.lastRanAt = null;
  runState.lastSuccessfulRunAt = null;
  runState.lastResult = null;
  runState.lastError = null;
  baselineSince = new Date();
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startCoachingCallTemplateTopUpJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    runCoachingCallTemplateTopUp().catch((err) => {
      console.error("[CoachingCallTopUp] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[CoachingCallTopUp] Started auto top-up job (every ${RUN_INTERVAL_MS / 60000}m, look-ahead ${LOOKAHEAD_DAYS}d)`,
  );
  runCoachingCallTemplateTopUp().catch((err) => {
    console.error("[CoachingCallTopUp] Initial run failed:", err);
  });
}

export function stopCoachingCallTemplateTopUpJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
