import { Router, type Request, type Response } from "express";
import {
  db,
  coachesTable,
  coachAvailabilityTable,
  coachAvailabilityOverridesTable,
  coachingSessionsTable,
  coachingActionItemsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql, gte, lte, count } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";
import { completeExpiredSessions, checkAndSendReminders } from "../lib/session-lifecycle";

const router = Router();

const VALID_STATUSES = ["scheduled", "completed", "cancelled", "no_show", "credit_returned"];
const VALID_OVERRIDE_TYPES = ["blocked", "extra"];

function parseId(value: string | string[]): number | null {
  const str = Array.isArray(value) ? value[0] : value;
  const num = parseInt(str, 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}

router.get("/admin/coaching/coaches", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const coaches = await db.select().from(coachesTable).orderBy(asc(coachesTable.name));
    res.json(coaches);
  } catch {
    res.status(500).json({ error: "Failed to fetch coaches" });
  }
});

router.get("/admin/coaching/coaches/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid coach ID" }); return; }
    const [coach] = await db.select().from(coachesTable).where(eq(coachesTable.id, id));
    if (!coach) { res.status(404).json({ error: "Coach not found" }); return; }
    const availability = await db.select().from(coachAvailabilityTable)
      .where(eq(coachAvailabilityTable.coachId, coach.id))
      .orderBy(asc(coachAvailabilityTable.dayOfWeek), asc(coachAvailabilityTable.startTime));
    const overrides = await db.select().from(coachAvailabilityOverridesTable)
      .where(and(
        eq(coachAvailabilityOverridesTable.coachId, coach.id),
        gte(coachAvailabilityOverridesTable.overrideDate, new Date().toISOString().split("T")[0])
      ))
      .orderBy(asc(coachAvailabilityOverridesTable.overrideDate));
    res.json({ ...coach, availability, overrides });
  } catch {
    res.status(500).json({ error: "Failed to fetch coach" });
  }
});

router.patch("/admin/coaching/coaches/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid coach ID" }); return; }
    const { oneOnOneEnabled, meetLink, timezone, maxDailySessions } = req.body;
    if (maxDailySessions !== undefined && (!Number.isInteger(maxDailySessions) || maxDailySessions < 1 || maxDailySessions > 20)) {
      res.status(400).json({ error: "maxDailySessions must be an integer between 1 and 20" });
      return;
    }
    const [updated] = await db.update(coachesTable)
      .set({
        ...(oneOnOneEnabled !== undefined && { oneOnOneEnabled: Boolean(oneOnOneEnabled) }),
        ...(meetLink !== undefined && { meetLink }),
        ...(timezone !== undefined && { timezone }),
        ...(maxDailySessions !== undefined && { maxDailySessions }),
      })
      .where(eq(coachesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Coach not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update coach" });
  }
});

router.post("/admin/coaching/availability", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { coachId, dayOfWeek, startTime, endTime, sessionDurationMinutes, bufferMinutes } = req.body;
    if (!coachId || dayOfWeek === undefined || !startTime || !endTime) {
      res.status(400).json({ error: "coachId, dayOfWeek, startTime, endTime are required" });
      return;
    }
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      res.status(400).json({ error: "dayOfWeek must be 0-6" });
      return;
    }
    const duration = sessionDurationMinutes || 60;
    const buffer = bufferMinutes || 15;
    if (!Number.isInteger(duration) || duration < 15 || duration > 180) {
      res.status(400).json({ error: "sessionDurationMinutes must be 15-180" });
      return;
    }
    const [slot] = await db.insert(coachAvailabilityTable).values({
      coachId, dayOfWeek, startTime, endTime,
      sessionDurationMinutes: duration,
      bufferMinutes: buffer,
    }).returning();
    res.status(201).json(slot);
  } catch {
    res.status(500).json({ error: "Failed to create availability slot" });
  }
});

router.patch("/admin/coaching/availability/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid slot ID" }); return; }
    const { dayOfWeek, startTime, endTime, sessionDurationMinutes, bufferMinutes } = req.body;
    if (dayOfWeek !== undefined && (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)) {
      res.status(400).json({ error: "dayOfWeek must be 0-6" });
      return;
    }
    const [updated] = await db.update(coachAvailabilityTable)
      .set({
        ...(dayOfWeek !== undefined && { dayOfWeek }),
        ...(startTime !== undefined && { startTime }),
        ...(endTime !== undefined && { endTime }),
        ...(sessionDurationMinutes !== undefined && { sessionDurationMinutes }),
        ...(bufferMinutes !== undefined && { bufferMinutes }),
      })
      .where(eq(coachAvailabilityTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Slot not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update availability slot" });
  }
});

router.delete("/admin/coaching/availability/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid slot ID" }); return; }
    const [deleted] = await db.delete(coachAvailabilityTable)
      .where(eq(coachAvailabilityTable.id, id))
      .returning();
    if (!deleted) { res.status(404).json({ error: "Slot not found" }); return; }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete availability slot" });
  }
});

router.post("/admin/coaching/overrides", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { coachId, overrideDate, overrideType, startTime, endTime, reason } = req.body;
    if (!coachId || !overrideDate || !overrideType) {
      res.status(400).json({ error: "coachId, overrideDate, overrideType are required" });
      return;
    }
    if (!VALID_OVERRIDE_TYPES.includes(overrideType)) {
      res.status(400).json({ error: "overrideType must be 'blocked' or 'extra'" });
      return;
    }
    const [override] = await db.insert(coachAvailabilityOverridesTable).values({
      coachId, overrideDate, overrideType,
      startTime: startTime || null,
      endTime: endTime || null,
      reason: reason || null,
    }).returning();
    res.status(201).json(override);
  } catch {
    res.status(500).json({ error: "Failed to create override" });
  }
});

router.patch("/admin/coaching/overrides/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid override ID" }); return; }
    const { overrideDate, overrideType, startTime, endTime, reason } = req.body;
    if (overrideType !== undefined && !VALID_OVERRIDE_TYPES.includes(overrideType)) {
      res.status(400).json({ error: "overrideType must be 'blocked' or 'extra'" });
      return;
    }
    const [updated] = await db.update(coachAvailabilityOverridesTable)
      .set({
        ...(overrideDate !== undefined && { overrideDate }),
        ...(overrideType !== undefined && { overrideType }),
        ...(startTime !== undefined && { startTime }),
        ...(endTime !== undefined && { endTime }),
        ...(reason !== undefined && { reason }),
      })
      .where(eq(coachAvailabilityOverridesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Override not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update override" });
  }
});

router.delete("/admin/coaching/overrides/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid override ID" }); return; }
    const [deleted] = await db.delete(coachAvailabilityOverridesTable)
      .where(eq(coachAvailabilityOverridesTable.id, id))
      .returning();
    if (!deleted) { res.status(404).json({ error: "Override not found" }); return; }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete override" });
  }
});

router.get("/admin/coaching/sessions", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { status, coachId, memberId, dateFrom, dateTo, needsNotes, noShow } = req.query;
    const conditions: any[] = [];
    if (status) {
      if (!VALID_STATUSES.includes(status as string)) {
        res.status(400).json({ error: "Invalid status filter" });
        return;
      }
      conditions.push(eq(coachingSessionsTable.status, status as string));
    }
    if (coachId) {
      const cid = parseId(coachId as string);
      if (!cid) { res.status(400).json({ error: "Invalid coachId" }); return; }
      conditions.push(eq(coachingSessionsTable.coachId, cid));
    }
    if (memberId) {
      const mid = parseId(memberId as string);
      if (!mid) { res.status(400).json({ error: "Invalid memberId" }); return; }
      conditions.push(eq(coachingSessionsTable.memberId, mid));
    }
    if (dateFrom) conditions.push(gte(coachingSessionsTable.scheduledAt, new Date(dateFrom as string)));
    if (dateTo) conditions.push(lte(coachingSessionsTable.scheduledAt, new Date(dateTo as string)));
    if (needsNotes === "true") {
      conditions.push(eq(coachingSessionsTable.status, "completed"));
      conditions.push(sql`${coachingSessionsTable.coachNotes} IS NULL`);
    }
    if (noShow === "true") {
      conditions.push(eq(coachingSessionsTable.status, "no_show"));
    }

    const sessions = await db.select({
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
      rating: coachingSessionsTable.rating,
      actionItems: coachingSessionsTable.actionItems,
      cancelledAt: coachingSessionsTable.cancelledAt,
      cancelledBy: coachingSessionsTable.cancelledBy,
      creditReturned: coachingSessionsTable.creditReturned,
      createdAt: coachingSessionsTable.createdAt,
      updatedAt: coachingSessionsTable.updatedAt,
    })
    .from(coachingSessionsTable)
    .innerJoin(coachesTable, eq(coachingSessionsTable.coachId, coachesTable.id))
    .innerJoin(usersTable, eq(coachingSessionsTable.memberId, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(coachingSessionsTable.scheduledAt))
    .limit(100);

    res.json(sessions);
  } catch {
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

router.get("/admin/coaching/sessions/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid session ID" }); return; }
    const [session] = await db.select({
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
      rating: coachingSessionsTable.rating,
      cancelledAt: coachingSessionsTable.cancelledAt,
      cancelledBy: coachingSessionsTable.cancelledBy,
      creditReturned: coachingSessionsTable.creditReturned,
      createdAt: coachingSessionsTable.createdAt,
      updatedAt: coachingSessionsTable.updatedAt,
    })
    .from(coachingSessionsTable)
    .innerJoin(coachesTable, eq(coachingSessionsTable.coachId, coachesTable.id))
    .innerJoin(usersTable, eq(coachingSessionsTable.memberId, usersTable.id))
    .where(eq(coachingSessionsTable.id, id));

    if (!session) { res.status(404).json({ error: "Session not found" }); return; }

    const actionItems = await db.select().from(coachingActionItemsTable)
      .where(eq(coachingActionItemsTable.sessionId, session.id))
      .orderBy(asc(coachingActionItemsTable.createdAt));

    res.json({ ...session, actionItems });
  } catch {
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

router.patch("/admin/coaching/sessions/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid session ID" }); return; }
    const { status, coachNotes, memberNotes, rating } = req.body;
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
      return;
    }
    if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      res.status(400).json({ error: "Rating must be an integer between 1 and 5" });
      return;
    }
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (status !== undefined) updateData.status = status;
    if (coachNotes !== undefined) updateData.coachNotes = coachNotes;
    if (memberNotes !== undefined) updateData.memberNotes = memberNotes;
    if (rating !== undefined) updateData.rating = rating;
    if (status === "cancelled") {
      updateData.cancelledAt = new Date();
      updateData.cancelledBy = "admin";
    }
    const [updated] = await db.update(coachingSessionsTable)
      .set(updateData)
      .where(eq(coachingSessionsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Session not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update session" });
  }
});

router.post("/admin/coaching/sessions/:id/return-credit", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid session ID" }); return; }
    const [updated] = await db.update(coachingSessionsTable)
      .set({
        status: "credit_returned",
        creditReturned: true,
        cancelledAt: new Date(),
        cancelledBy: "admin",
        updatedAt: new Date(),
      })
      .where(and(
        eq(coachingSessionsTable.id, id),
        eq(coachingSessionsTable.status, "no_show")
      ))
      .returning();
    if (!updated) { res.status(404).json({ error: "Session not found or not a no-show" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to return credit" });
  }
});

router.post("/admin/coaching/run-nightly", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const completed = await completeExpiredSessions();
    const reminders = await checkAndSendReminders();
    res.json({ completed, reminders });
  } catch {
    res.status(500).json({ error: "Failed to run nightly tasks" });
  }
});

router.post("/admin/coaching/sessions/:id/action-items", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sessionId = parseId(req.params.id);
    if (!sessionId) { res.status(400).json({ error: "Invalid session ID" }); return; }
    const { text: itemText, dueDate } = req.body;
    if (!itemText || typeof itemText !== "string" || !itemText.trim()) {
      res.status(400).json({ error: "Text is required" });
      return;
    }
    const [sessionExists] = await db.select({ id: coachingSessionsTable.id })
      .from(coachingSessionsTable)
      .where(eq(coachingSessionsTable.id, sessionId))
      .limit(1);
    if (!sessionExists) { res.status(404).json({ error: "Session not found" }); return; }
    const [item] = await db.insert(coachingActionItemsTable).values({
      sessionId,
      text: itemText.trim(),
      dueDate: dueDate || null,
    }).returning();
    res.status(201).json(item);
  } catch {
    res.status(500).json({ error: "Failed to create action item" });
  }
});

router.patch("/admin/coaching/action-items/:id/complete", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid action item ID" }); return; }
    const [updated] = await db.update(coachingActionItemsTable)
      .set({ completedAt: new Date() })
      .where(eq(coachingActionItemsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Action item not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to complete action item" });
  }
});

router.delete("/admin/coaching/action-items/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid action item ID" }); return; }
    const [deleted] = await db.delete(coachingActionItemsTable)
      .where(eq(coachingActionItemsTable.id, id))
      .returning();
    if (!deleted) { res.status(404).json({ error: "Action item not found" }); return; }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete action item" });
  }
});

router.get("/admin/coaching/analytics", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const [thisMonth] = await db.select({ count: count() }).from(coachingSessionsTable)
      .where(gte(coachingSessionsTable.scheduledAt, thisMonthStart));
    const [lastMonth] = await db.select({ count: count() }).from(coachingSessionsTable)
      .where(and(
        gte(coachingSessionsTable.scheduledAt, lastMonthStart),
        lte(coachingSessionsTable.scheduledAt, lastMonthEnd)
      ));

    const statusCounts = await db.select({
      status: coachingSessionsTable.status,
      count: count(),
    }).from(coachingSessionsTable)
      .where(gte(coachingSessionsTable.scheduledAt, thisMonthStart))
      .groupBy(coachingSessionsTable.status);

    const statusMap: Record<string, number> = {};
    statusCounts.forEach((s) => { statusMap[s.status] = Number(s.count); });

    const avgRating = await db.select({
      avg: sql<number>`ROUND(AVG(${coachingSessionsTable.rating})::numeric, 2)`,
    }).from(coachingSessionsTable)
      .where(sql`${coachingSessionsTable.rating} IS NOT NULL`);

    const popularCoaches = await db.select({
      coachId: coachingSessionsTable.coachId,
      coachName: coachesTable.name,
      sessionCount: count(),
    }).from(coachingSessionsTable)
      .innerJoin(coachesTable, eq(coachingSessionsTable.coachId, coachesTable.id))
      .where(gte(coachingSessionsTable.scheduledAt, thisMonthStart))
      .groupBy(coachingSessionsTable.coachId, coachesTable.name)
      .orderBy(desc(count()))
      .limit(5);

    const needsNotes = await db.select({ count: count() }).from(coachingSessionsTable)
      .where(and(
        eq(coachingSessionsTable.status, "completed"),
        sql`${coachingSessionsTable.coachNotes} IS NULL`
      ));

    const totalActionItems = await db.select({ count: count() }).from(coachingActionItemsTable);
    const completedActionItems = await db.select({ count: count() }).from(coachingActionItemsTable)
      .where(sql`${coachingActionItemsTable.completedAt} IS NOT NULL`);

    res.json({
      sessionsThisMonth: Number(thisMonth.count),
      sessionsLastMonth: Number(lastMonth.count),
      completedRate: statusMap.completed || 0,
      cancelledRate: statusMap.cancelled || 0,
      noShowRate: statusMap.no_show || 0,
      creditReturned: statusMap.credit_returned || 0,
      averageRating: avgRating[0]?.avg || null,
      popularCoaches,
      needsNotesCount: Number(needsNotes[0].count),
      actionItemsTotal: Number(totalActionItems[0].count),
      actionItemsCompleted: Number(completedActionItems[0].count),
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

export default router;
