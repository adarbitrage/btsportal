import { Router, type Request, type Response } from "express";
import { db, moderationQueueTable, usersTable, communityPostsTable, communityCommentsTable, userStrikesTable } from "@workspace/db";
import { eq, and, lt, desc, sql } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac";
import { logAuditEvent } from "../../lib/audit-log";

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
