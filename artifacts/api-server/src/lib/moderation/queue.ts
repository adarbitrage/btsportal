import { db, communityPostsTable, communityCommentsTable, moderationQueueTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { evaluate } from "./engine";
import { recordModerationFailure } from "./failure-tracker";

/**
 * Lightweight, in-process background queue for moderation evaluations.
 *
 * Trade-off: posts and comments are saved as `active` and returned to the
 * client immediately, then evaluated asynchronously via `setImmediate`. If the
 * engine flags the content, it is updated to `shadow_hidden` and added to the
 * moderation queue shortly after creation (typically within milliseconds, plus
 * the AI classifier round-trip). This means there is a brief window where
 * flagged content is publicly `active`. This is an acceptable trade-off for
 * removing classifier latency from the create response path. Because the queue
 * is in-process, jobs that are pending when the process exits are lost; this
 * is acceptable since flagged content can still be reported and moderated
 * manually after the fact.
 */


export interface ModerationJob {
  targetType: "post" | "comment";
  targetId: number;
  authorId: number;
  body: string;
}

export async function runModerationJob(job: ModerationJob): Promise<void> {
  const { targetType, targetId, authorId, body } = job;

  let result;
  try {
    result = await evaluate({ body, targetType, authorId });
  } catch (err) {
    console.error(
      `[Moderation] Engine error on ${targetType} ${targetId}, failing open:`,
      err,
    );
    // Surface to the failure tracker so the on-call alerter can page
    // when the evaluator starts dropping jobs. "Engine" failures mean
    // flagged content may have slipped through *unevaluated*.
    recordModerationFailure("engine", err, { targetType, targetId });
    return;
  }

  if (!result.flagged) return;

  try {
    if (targetType === "post") {
      await db
        .update(communityPostsTable)
        .set({ status: "shadow_hidden" })
        .where(eq(communityPostsTable.id, targetId));
    } else {
      await db
        .update(communityCommentsTable)
        .set({ status: "shadow_hidden" })
        .where(eq(communityCommentsTable.id, targetId));
    }

    await db.insert(moderationQueueTable).values({
      targetType,
      targetId,
      authorId,
      body,
      triggeredBy: result.triggeredBy,
      wordlistMatches: result.wordlistMatches,
      aiScores: result.aiScores,
      flagThreshold: result.flagThreshold,
    });
  } catch (err) {
    console.error(
      `[Moderation] Failed to persist flag for ${targetType} ${targetId}:`,
      err,
    );
    // "Persist" failures are the more serious of the two: the content
    // was *known* to be flag-worthy, the DB write to shadow-hide it
    // threw, and the post stays publicly `active`. Tracked separately
    // from engine failures so the alert body can call it out.
    recordModerationFailure("persist", err, { targetType, targetId });
  }
}

const pending = new Set<Promise<void>>();

export function enqueueModerationJob(job: ModerationJob): void {
  let resolveDeferred!: () => void;
  const deferred = new Promise<void>((resolve) => {
    resolveDeferred = resolve;
  });
  pending.add(deferred);
  setImmediate(() => {
    runModerationJob(job).finally(() => {
      pending.delete(deferred);
      resolveDeferred();
    });
  });
}

export function pendingModerationJobs(): Promise<void> {
  return Promise.all(Array.from(pending)).then(() => undefined);
}
