import { db, communityPostsTable, communityCommentsTable, moderationQueueTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { evaluate } from "./engine";

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
    });
  } catch (err) {
    console.error(
      `[Moderation] Failed to persist flag for ${targetType} ${targetId}:`,
      err,
    );
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
