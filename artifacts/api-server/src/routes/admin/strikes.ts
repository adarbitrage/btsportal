import { Router, type Request, type Response } from "express";
import { db, usersTable, userStrikesTable, moderationQueueTable, auditLogTable } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac";
import { logAuditEvent } from "../../lib/audit-log";

const router = Router();

router.get("/users", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        userId: userStrikesTable.userId,
        strikeCount: sql<number>`cast(count(${userStrikesTable.id}) as int)`,
        lastStrikeAt: sql<string>`max(${userStrikesTable.createdAt})`,
        name: usersTable.name,
        email: usersTable.email,
        postingBannedAt: usersTable.postingBannedAt,
      })
      .from(userStrikesTable)
      .innerJoin(usersTable, eq(userStrikesTable.userId, usersTable.id))
      .groupBy(userStrikesTable.userId, usersTable.name, usersTable.email, usersTable.postingBannedAt)
      .orderBy(desc(sql`max(${userStrikesTable.createdAt})`));

    const users = rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      email: r.email,
      strikeCount: r.strikeCount,
      isBanned: !!r.postingBannedAt,
      postingBannedAt: r.postingBannedAt,
      lastStrikeAt: r.lastStrikeAt,
    }));

    users.sort((a, b) => {
      if (a.isBanned !== b.isBanned) return a.isBanned ? -1 : 1;
      return b.strikeCount - a.strikeCount;
    });

    res.json({ users });
  } catch (err) {
    console.error("[Admin/Strikes] List users error:", err);
    res.status(500).json({ error: "Failed to fetch users with strikes" });
  }
});

router.get("/users/:userId", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string, 10);
    if (isNaN(userId)) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        postingBannedAt: usersTable.postingBannedAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const strikes = await db
      .select({
        id: userStrikesTable.id,
        reason: userStrikesTable.reason,
        queueId: userStrikesTable.queueId,
        targetType: userStrikesTable.targetType,
        targetId: userStrikesTable.targetId,
        createdAt: userStrikesTable.createdAt,
      })
      .from(userStrikesTable)
      .where(eq(userStrikesTable.userId, userId))
      .orderBy(desc(userStrikesTable.createdAt));

    // Surface the audit row written by the moderation reject endpoint when
    // it auto-bans a user, so admins can see whether the ban was an explicit
    // admin action or an automatic threshold trip, who reviewed the strike
    // that caused it, and which queue/strike id tripped it. We return the
    // most recent matching row — re-bans (after an unban) are rare but if
    // they happen the newest one is the relevant context.
    const [autoBan] = await db
      .select({
        id: auditLogTable.id,
        actorId: auditLogTable.actorId,
        actorEmail: auditLogTable.actorEmail,
        description: auditLogTable.description,
        metadata: auditLogTable.metadata,
        createdAt: auditLogTable.createdAt,
      })
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, "auto_ban_posting"),
          eq(auditLogTable.entityType, "user"),
          eq(auditLogTable.entityId, String(userId)),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt))
      .limit(1);

    // Also surface the most recent manual ban/unban audit row so the UI can
    // show who pressed the button and why (auto bans have an `autoBan` row,
    // manual ones don't — without this admins can't tell who manually banned
    // or unbanned the member).
    const [manualBan] = await db
      .select({
        id: auditLogTable.id,
        actionType: auditLogTable.actionType,
        actorId: auditLogTable.actorId,
        actorEmail: auditLogTable.actorEmail,
        description: auditLogTable.description,
        metadata: auditLogTable.metadata,
        createdAt: auditLogTable.createdAt,
      })
      .from(auditLogTable)
      .where(
        and(
          sql`${auditLogTable.actionType} in ('ban_posting', 'unban_posting')`,
          eq(auditLogTable.entityType, "user"),
          eq(auditLogTable.entityId, String(userId)),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt))
      .limit(1);

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        postingBannedAt: user.postingBannedAt,
        isBanned: !!user.postingBannedAt,
      },
      strikes,
      strikeCount: strikes.length,
      autoBan: autoBan ?? null,
      manualBan: manualBan ?? null,
    });
  } catch (err) {
    console.error("[Admin/Strikes] Get user strikes error:", err);
    res.status(500).json({ error: "Failed to fetch user strikes" });
  }
});

router.post("/users/:userId/ban", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string, 10);
    if (isNaN(userId)) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    const [user] = await db
      .select({ id: usersTable.id, postingBannedAt: usersTable.postingBannedAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (user.postingBannedAt) {
      res.status(400).json({ error: "User is already banned from posting" });
      return;
    }

    const bannedAt = new Date();
    await db
      .update(usersTable)
      .set({ postingBannedAt: bannedAt })
      .where(eq(usersTable.id, userId));

    // Record who manually pressed the ban button so admins reviewing the
    // member later can tell auto-bans (auto_ban_posting) apart from explicit
    // admin actions, and see who did it. Surfaced by
    // GET /admin/strikes/users/:userId as `manualBan`.
    await logAuditEvent({
      actorId: req.userId,
      actorEmail: req.userEmail,
      actionType: "ban_posting",
      entityType: "user",
      entityId: String(userId),
      description: `Banned member ${userId} from posting`,
      metadata: {
        userId,
        bannedAt: bannedAt.toISOString(),
      },
      req,
    });

    res.json({ success: true, bannedAt });
  } catch (err) {
    console.error("[Admin/Strikes] Ban user error:", err);
    res.status(500).json({ error: "Failed to ban user" });
  }
});

router.post("/users/:userId/unban", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string, 10);
    if (isNaN(userId)) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    const clearStrikes = req.query.clearStrikes === "true";

    const [user] = await db
      .select({ id: usersTable.id, postingBannedAt: usersTable.postingBannedAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!user.postingBannedAt) {
      res.status(400).json({ error: "User is not banned from posting" });
      return;
    }

    await db
      .update(usersTable)
      .set({ postingBannedAt: null })
      .where(eq(usersTable.id, userId));

    if (clearStrikes) {
      await db
        .delete(userStrikesTable)
        .where(eq(userStrikesTable.userId, userId));
    }

    // Mirror of the ban audit row so admins can see who lifted the ban and
    // whether the lift also wiped the member's strike history (which resets
    // them well below the auto-ban threshold). Surfaced by
    // GET /admin/strikes/users/:userId as `manualBan`.
    await logAuditEvent({
      actorId: req.userId,
      actorEmail: req.userEmail,
      actionType: "unban_posting",
      entityType: "user",
      entityId: String(userId),
      description: clearStrikes
        ? `Unbanned member ${userId} from posting and cleared all strikes`
        : `Unbanned member ${userId} from posting`,
      metadata: {
        userId,
        strikesCleared: clearStrikes,
        previousBannedAt: user.postingBannedAt?.toISOString() ?? null,
      },
      req,
    });

    res.json({ success: true, strikesCleared: clearStrikes });
  } catch (err) {
    console.error("[Admin/Strikes] Unban user error:", err);
    res.status(500).json({ error: "Failed to unban user" });
  }
});

export default router;
