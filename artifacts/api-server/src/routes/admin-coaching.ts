import { Router, type IRouter } from "express";
import { db, coachingSessionsTable, coachesTable, usersTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { completeExpiredSessions, checkAndSendReminders } from "../lib/session-lifecycle";
import type { ActionItem } from "@workspace/db";

const router: IRouter = Router();

router.get("/admin/coaching/sessions", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).then(r => r[0]);
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const status = req.query.status as string | undefined;
  const coachId = req.query.coachId ? parseInt(req.query.coachId as string) : undefined;

  let conditions = [];
  if (status) conditions.push(eq(coachingSessionsTable.status, status));
  if (coachId) conditions.push(eq(coachingSessionsTable.coachId, coachId));

  const query = db
    .select({
      id: coachingSessionsTable.id,
      coachId: coachingSessionsTable.coachId,
      coachName: coachesTable.name,
      memberId: coachingSessionsTable.memberId,
      memberName: usersTable.name,
      memberEmail: usersTable.email,
      scheduledAt: coachingSessionsTable.scheduledAt,
      durationMinutes: coachingSessionsTable.durationMinutes,
      status: coachingSessionsTable.status,
      meetLink: coachingSessionsTable.meetLink,
      coachNotes: coachingSessionsTable.coachNotes,
      memberNotes: coachingSessionsTable.memberNotes,
      actionItems: coachingSessionsTable.actionItems,
      cancelledAt: coachingSessionsTable.cancelledAt,
      cancelledBy: coachingSessionsTable.cancelledBy,
      creditReturned: coachingSessionsTable.creditReturned,
      createdAt: coachingSessionsTable.createdAt,
    })
    .from(coachingSessionsTable)
    .innerJoin(coachesTable, eq(coachingSessionsTable.coachId, coachesTable.id))
    .innerJoin(usersTable, eq(coachingSessionsTable.memberId, usersTable.id))
    .orderBy(desc(coachingSessionsTable.scheduledAt));

  const sessions = conditions.length > 0
    ? await query.where(and(...conditions))
    : await query;

  res.json(sessions);
});

router.patch("/admin/coaching/sessions/:id", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).then(r => r[0]);
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const sessionId = parseInt(req.params.id);
  const { status, coachNotes, memberNotes, actionItems } = req.body;

  const session = await db
    .select()
    .from(coachingSessionsTable)
    .where(eq(coachingSessionsTable.id, sessionId))
    .then(r => r[0]);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const updates: Record<string, any> = {};
  if (status) updates.status = status;
  if (coachNotes !== undefined) updates.coachNotes = coachNotes;
  if (memberNotes !== undefined) updates.memberNotes = memberNotes;
  if (actionItems !== undefined) updates.actionItems = actionItems;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [updated] = await db.update(coachingSessionsTable)
    .set(updates)
    .where(eq(coachingSessionsTable.id, sessionId))
    .returning();

  res.json(updated);
});

router.post("/admin/coaching/sessions/:id/return-credit", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).then(r => r[0]);
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const sessionId = parseInt(req.params.id);

  const session = await db
    .select()
    .from(coachingSessionsTable)
    .where(eq(coachingSessionsTable.id, sessionId))
    .then(r => r[0]);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await db.update(coachingSessionsTable)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: "admin",
      creditReturned: true,
    })
    .where(eq(coachingSessionsTable.id, sessionId));

  res.json({ id: sessionId, status: "cancelled", creditReturned: true, message: "Session cancelled and credit returned by admin." });
});

router.post("/admin/coaching/run-nightly", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).then(r => r[0]);
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const completed = await completeExpiredSessions();
  const reminders = await checkAndSendReminders();

  res.json({ completed, reminders });
});

export default router;
