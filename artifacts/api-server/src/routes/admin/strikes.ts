import { Router, type Request, type Response } from "express";
import { db, usersTable, userStrikesTable, moderationQueueTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac";

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

    await db
      .update(usersTable)
      .set({ postingBannedAt: new Date() })
      .where(eq(usersTable.id, userId));

    res.json({ success: true, bannedAt: new Date() });
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

    res.json({ success: true, strikesCleared: clearStrikes });
  } catch (err) {
    console.error("[Admin/Strikes] Unban user error:", err);
    res.status(500).json({ error: "Failed to unban user" });
  }
});

export default router;
