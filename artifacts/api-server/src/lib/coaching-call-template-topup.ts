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

export interface TemplateTopUpResult {
  templateId: number;
  created: number;
  batches: number;
}

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
  for (const template of templates) {
    try {
      const result = await topUpTemplate(template, now);
      if (result.created > 0) {
        console.log(
          `[CoachingCallTopUp] Template ${template.id} ("${template.title}"): generated ${result.created} call(s) across ${result.batches} batch(es)`,
        );
      }
      results.push(result);
    } catch (err) {
      console.error(
        `[CoachingCallTopUp] Template ${template.id} ("${template.title}") failed:`,
        err,
      );
      results.push({ templateId: template.id, created: 0, batches: 0 });
    }
  }
  return results;
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
