import { Router, type Request, type Response } from "express";
import { db, moderationQueueTable, usersTable, communityPostsTable, communityCommentsTable, userStrikesTable } from "@workspace/db";
import { eq, and, lt, gte, lte, desc, sql, inArray, type SQL } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac";
import { logAuditEvent } from "../../lib/audit-log";
import { computeAiThresholdScoreBandSummary } from "../../lib/moderation/ai-threshold-settings";

const router = Router();

router.get("/", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string || "25", 10), 100);

    const conditions = [];
    if (status && ["pending", "approved", "rejected"].includes(status)) {
      conditions.push(eq(moderationQueueTable.status, status));
    }
    if (cursor) {
      const cursorId = parseInt(cursor, 10);
      if (!isNaN(cursorId)) {
        conditions.push(lt(moderationQueueTable.id, cursorId));
      }
    }

    const rows = await db
      .select({
        id: moderationQueueTable.id,
        targetType: moderationQueueTable.targetType,
        targetId: moderationQueueTable.targetId,
        authorId: moderationQueueTable.authorId,
        body: moderationQueueTable.body,
        status: moderationQueueTable.status,
        triggeredBy: moderationQueueTable.triggeredBy,
        wordlistMatches: moderationQueueTable.wordlistMatches,
        aiScores: moderationQueueTable.aiScores,
        flagThreshold: moderationQueueTable.flagThreshold,
        reviewedBy: moderationQueueTable.reviewedBy,
        reviewedAt: moderationQueueTable.reviewedAt,
        createdAt: moderationQueueTable.createdAt,
        authorName: usersTable.name,
        authorEmail: usersTable.email,
      })
      .from(moderationQueueTable)
      .leftJoin(usersTable, eq(moderationQueueTable.authorId, usersTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(moderationQueueTable.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? String(items[items.length - 1].id) : null;

    res.json({ items, nextCursor, hasMore });
  } catch (err) {
    console.error("[Admin/Moderation] List queue error:", err);
    res.status(500).json({ error: "Failed to fetch moderation queue" });
  }
});

/**
 * AI-flagged items dashboard. Lists moderation queue rows that were flagged
 * by the AI classifier (triggeredBy = "ai_classifier" or "combined") with the
 * per-class scores, the threshold that was in effect at flag-time, and the
 * highest single score so admins can sort/filter by "how confidently the
 * classifier wanted this flagged". Backs the admin "AI Flagged" view that
 * lets moderators tune the threshold setting from real data instead of
 * guessing.
 *
 * Query params (all optional):
 *   status     — "pending" | "approved" | "rejected" (queue review state)
 *   from, to   — ISO date strings, inclusive bounds on createdAt
 *   minScore   — 0..1, lower bound on the *max* per-class AI score
 *   maxScore   — 0..1, upper bound on the *max* per-class AI score
 *   cursor     — opaque id from a previous nextCursor
 *   limit      — page size, 1..100, default 25
 */
router.get("/ai-flagged", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const minScoreRaw = req.query.minScore as string | undefined;
    const maxScoreRaw = req.query.maxScore as string | undefined;
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string || "25", 10) || 25, 1), 100);

    // Highest per-class classifier score for the row. Computed in SQL so
    // we can both filter by score band and sort by "most-confident flag".
    // Mirrors the keys produced by ClassifierScores in classifier.ts; if
    // a new class is added there, add it here too.
    const maxScoreSql = sql<number>`GREATEST(
      COALESCE((${moderationQueueTable.aiScores} ->> 'toxicity')::real, 0),
      COALESCE((${moderationQueueTable.aiScores} ->> 'spam')::real, 0),
      COALESCE((${moderationQueueTable.aiScores} ->> 'harassment')::real, 0),
      COALESCE((${moderationQueueTable.aiScores} ->> 'hate_speech')::real, 0)
    )`;

    const conditions: SQL[] = [
      // Only rows where the AI classifier actually weighed in. "wordlist_hard"
      // / "wordlist_soft" rows are pure wordlist flags and have nothing to
      // teach the admin about the threshold setting.
      inArray(moderationQueueTable.triggeredBy, ["ai_classifier", "combined"]),
    ];

    if (status && ["pending", "approved", "rejected"].includes(status)) {
      conditions.push(eq(moderationQueueTable.status, status));
    }
    if (from) {
      const d = new Date(from);
      if (!isNaN(d.getTime())) conditions.push(gte(moderationQueueTable.createdAt, d));
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d.getTime())) conditions.push(lte(moderationQueueTable.createdAt, d));
    }
    if (minScoreRaw !== undefined) {
      const v = parseFloat(minScoreRaw);
      if (!isNaN(v)) conditions.push(sql`${maxScoreSql} >= ${v}`);
    }
    if (maxScoreRaw !== undefined) {
      const v = parseFloat(maxScoreRaw);
      if (!isNaN(v)) conditions.push(sql`${maxScoreSql} <= ${v}`);
    }
    if (cursor) {
      const cursorId = parseInt(cursor, 10);
      if (!isNaN(cursorId)) conditions.push(lt(moderationQueueTable.id, cursorId));
    }

    const rows = await db
      .select({
        id: moderationQueueTable.id,
        targetType: moderationQueueTable.targetType,
        targetId: moderationQueueTable.targetId,
        authorId: moderationQueueTable.authorId,
        body: moderationQueueTable.body,
        status: moderationQueueTable.status,
        triggeredBy: moderationQueueTable.triggeredBy,
        wordlistMatches: moderationQueueTable.wordlistMatches,
        aiScores: moderationQueueTable.aiScores,
        flagThreshold: moderationQueueTable.flagThreshold,
        maxScore: maxScoreSql,
        reviewedBy: moderationQueueTable.reviewedBy,
        reviewedAt: moderationQueueTable.reviewedAt,
        createdAt: moderationQueueTable.createdAt,
        authorName: usersTable.name,
        authorEmail: usersTable.email,
      })
      .from(moderationQueueTable)
      .leftJoin(usersTable, eq(moderationQueueTable.authorId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(moderationQueueTable.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? String(items[items.length - 1].id) : null;

    res.json({ items, nextCursor, hasMore });
  } catch (err) {
    console.error("[Admin/Moderation] AI-flagged list error:", err);
    res.status(500).json({ error: "Failed to fetch AI-flagged items" });
  }
});

/**
 * Score-band summary for the AI Flagged dashboard. Buckets AI-flagged content
 * by max classifier score and reports the approve/reject split per band, plus
 * the raw max-scores so the UI's "what-if threshold" slider can preview how
 * many flags would still trigger at a hypothetical threshold. Read-only.
 *
 * Query params (all optional), mirroring the /ai-flagged list route so the
 * summary tracks the same window the admin applied to the list:
 *   from, to — ISO date strings, inclusive bounds on createdAt. When neither
 *              is supplied the summary falls back to the last 30 days.
 */
router.get("/ai-flagged/summary", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const opts: { from?: Date; to?: Date } = {};
    if (from) {
      const d = new Date(from);
      if (!isNaN(d.getTime())) opts.from = d;
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d.getTime())) opts.to = d;
    }
    const summary = await computeAiThresholdScoreBandSummary(opts);
    res.json(summary);
  } catch (err) {
    console.error("[Admin/Moderation] AI-flagged summary error:", err);
    res.status(500).json({ error: "Failed to compute AI-flagged summary" });
  }
});

router.get("/:id", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const [row] = await db
      .select({
        id: moderationQueueTable.id,
        targetType: moderationQueueTable.targetType,
        targetId: moderationQueueTable.targetId,
        authorId: moderationQueueTable.authorId,
        body: moderationQueueTable.body,
        status: moderationQueueTable.status,
        triggeredBy: moderationQueueTable.triggeredBy,
        wordlistMatches: moderationQueueTable.wordlistMatches,
        aiScores: moderationQueueTable.aiScores,
        flagThreshold: moderationQueueTable.flagThreshold,
        reviewedBy: moderationQueueTable.reviewedBy,
        reviewedAt: moderationQueueTable.reviewedAt,
        createdAt: moderationQueueTable.createdAt,
        authorName: usersTable.name,
        authorEmail: usersTable.email,
      })
      .from(moderationQueueTable)
      .leftJoin(usersTable, eq(moderationQueueTable.authorId, usersTable.id))
      .where(eq(moderationQueueTable.id, id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Queue item not found" });
      return;
    }

    res.json(row);
  } catch (err) {
    console.error("[Admin/Moderation] Get queue item error:", err);
    res.status(500).json({ error: "Failed to fetch queue item" });
  }
});

router.post("/:id/approve", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const [item] = await db
      .select()
      .from(moderationQueueTable)
      .where(eq(moderationQueueTable.id, id))
      .limit(1);

    if (!item) {
      res.status(404).json({ error: "Queue item not found" });
      return;
    }
    if (item.status !== "pending") {
      res.status(400).json({ error: "Queue item is not pending" });
      return;
    }

    await db
      .update(moderationQueueTable)
      .set({ status: "approved", reviewedBy: req.userId, reviewedAt: new Date() })
      .where(eq(moderationQueueTable.id, id));

    if (item.targetType === "post") {
      await db
        .update(communityPostsTable)
        .set({ status: "active" })
        .where(eq(communityPostsTable.id, item.targetId));
    } else if (item.targetType === "comment") {
      await db
        .update(communityCommentsTable)
        .set({ status: "active" })
        .where(eq(communityCommentsTable.id, item.targetId));
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[Admin/Moderation] Approve error:", err);
    res.status(500).json({ error: "Failed to approve queue item" });
  }
});

router.post("/:id/reject", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const [item] = await db
      .select()
      .from(moderationQueueTable)
      .where(eq(moderationQueueTable.id, id))
      .limit(1);

    if (!item) {
      res.status(404).json({ error: "Queue item not found" });
      return;
    }
    if (item.status !== "pending") {
      res.status(400).json({ error: "Queue item is not pending" });
      return;
    }

    const { reason } = req.body;

    await db
      .update(moderationQueueTable)
      .set({ status: "rejected", reviewedBy: req.userId, reviewedAt: new Date() })
      .where(eq(moderationQueueTable.id, id));

    const [insertedStrike] = await db
      .insert(userStrikesTable)
      .values({
        userId: item.authorId,
        reason: reason || "Content violated community guidelines",
        queueId: id,
        targetType: item.targetType,
        targetId: item.targetId,
      })
      .returning({ id: userStrikesTable.id });

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userStrikesTable)
      .where(eq(userStrikesTable.userId, item.authorId));

    if (count >= 3) {
      const [user] = await db
        .select({ postingBannedAt: usersTable.postingBannedAt })
        .from(usersTable)
        .where(eq(usersTable.id, item.authorId))
        .limit(1);

      if (user && !user.postingBannedAt) {
        await db
          .update(usersTable)
          .set({ postingBannedAt: new Date() })
          .where(eq(usersTable.id, item.authorId));
        console.log(`[Moderation] Auto-banned user ${item.authorId} after ${count} strikes`);

        // Record an audit row so admins reviewing the banned member later can
        // see this was an automatic threshold trip (not an explicit ban), who
        // reviewed the strike that tripped it, and which queue/strike caused
        // it. Surfaced by GET /admin/strikes/users/:userId.
        await logAuditEvent({
          actorId: req.userId,
          actorEmail: req.userEmail,
          actionType: "auto_ban_posting",
          entityType: "user",
          entityId: String(item.authorId),
          description: `Auto-banned member ${item.authorId} from posting after ${count} strikes (triggered by moderation queue #${id})`,
          metadata: {
            userId: item.authorId,
            reviewerId: req.userId,
            triggeringQueueId: id,
            triggeringStrikeId: insertedStrike?.id,
            strikeCount: count,
            targetType: item.targetType,
            targetId: item.targetId,
          },
          req,
        });
      }
    }

    res.json({ success: true, strikeCount: count });
  } catch (err) {
    console.error("[Admin/Moderation] Reject error:", err);
    res.status(500).json({ error: "Failed to reject queue item" });
  }
});

export default router;
