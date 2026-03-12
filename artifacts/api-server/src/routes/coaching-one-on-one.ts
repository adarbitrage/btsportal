import { Router, type IRouter } from "express";
import { db, pool, coachingSessionsTable, coachesTable, coachingRatingsTable, coachAvailabilityTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { getUserEntitlements } from "../lib/entitlements";
import { getAvailableSlots } from "../lib/slot-engine";
import { addMinutes, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format } from "date-fns";
import type { ActionItem } from "@workspace/db";

const router: IRouter = Router();

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

function getSessionFrequency(entitlements: Set<string>): { allowed: boolean; frequency: "weekly" | "monthly" | null; periodStart: Date; periodEnd: Date } {
  const now = new Date();
  if (entitlements.has("coaching:one_on_one:weekly")) {
    return {
      allowed: true,
      frequency: "weekly",
      periodStart: startOfWeek(now, { weekStartsOn: 1 }),
      periodEnd: endOfWeek(now, { weekStartsOn: 1 }),
    };
  }
  if (entitlements.has("coaching:one_on_one:monthly")) {
    return {
      allowed: true,
      frequency: "monthly",
      periodStart: startOfMonth(now),
      periodEnd: endOfMonth(now),
    };
  }
  return { allowed: false, frequency: null, periodStart: now, periodEnd: now };
}

router.get("/coaching/one-on-one/status", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const entitlements = await getUserEntitlements(userId);
  const freq = getSessionFrequency(entitlements);

  if (!freq.allowed) {
    res.json({
      eligible: false,
      frequency: null,
      sessionsUsed: 0,
      sessionsLimit: 0,
      periodStart: null,
      periodEnd: null,
      upcomingSession: null,
    });
    return;
  }

  const sessionsInPeriod = await db
    .select()
    .from(coachingSessionsTable)
    .where(
      and(
        eq(coachingSessionsTable.memberId, userId),
        inArray(coachingSessionsTable.status, ["scheduled", "completed", "no_show"]),
        gte(coachingSessionsTable.scheduledAt, freq.periodStart),
        lte(coachingSessionsTable.scheduledAt, freq.periodEnd)
      )
    );

  const upcoming = await db
    .select({
      id: coachingSessionsTable.id,
      scheduledAt: coachingSessionsTable.scheduledAt,
      durationMinutes: coachingSessionsTable.durationMinutes,
      status: coachingSessionsTable.status,
      coachName: coachesTable.name,
      meetLink: coachingSessionsTable.meetLink,
    })
    .from(coachingSessionsTable)
    .innerJoin(coachesTable, eq(coachingSessionsTable.coachId, coachesTable.id))
    .where(
      and(
        eq(coachingSessionsTable.memberId, userId),
        eq(coachingSessionsTable.status, "scheduled"),
        gte(coachingSessionsTable.scheduledAt, new Date())
      )
    )
    .orderBy(coachingSessionsTable.scheduledAt)
    .limit(1);

  res.json({
    eligible: true,
    frequency: freq.frequency,
    sessionsUsed: sessionsInPeriod.length,
    sessionsLimit: 1,
    periodStart: freq.periodStart.toISOString(),
    periodEnd: freq.periodEnd.toISOString(),
    upcomingSession: upcoming[0] || null,
  });
});

router.get("/coaching/one-on-one/coaches", async (_req, res): Promise<void> => {
  const coaches = await db
    .select()
    .from(coachesTable)
    .where(eq(coachesTable.oneOnOneEnabled, true));

  const result = await Promise.all(
    coaches.map(async (coach) => {
      const availability = await db
        .select()
        .from(coachAvailabilityTable)
        .where(eq(coachAvailabilityTable.coachId, coach.id));

      return {
        id: coach.id,
        name: coach.name,
        bio: coach.bio,
        photoUrl: coach.photoUrl,
        specialties: coach.specialties,
        timezone: coach.timezone,
        averageRating: coach.averageRating ? parseFloat(coach.averageRating) : null,
        totalRatings: coach.totalRatings,
        availability: availability.map(a => ({
          dayOfWeek: a.dayOfWeek,
          startTime: a.startTime,
          endTime: a.endTime,
        })),
      };
    })
  );

  res.json(result);
});

router.get("/coaching/one-on-one/slots", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const coachId = parseInt(req.query.coachId as string);
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;
  const memberTimezone = (req.query.timezone as string) || "America/New_York";

  if (!coachId || !startDate || !endDate) {
    res.status(400).json({ error: "coachId, startDate, and endDate are required" });
    return;
  }

  const entitlements = await getUserEntitlements(userId);
  const freq = getSessionFrequency(entitlements);
  if (!freq.allowed) {
    res.status(403).json({ error: "You do not have a 1-on-1 coaching entitlement" });
    return;
  }

  const slots = await getAvailableSlots(coachId, startDate, endDate, memberTimezone);
  res.json({ slots });
});

router.post("/coaching/one-on-one/book", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { coachId, startTime } = req.body;

  if (!coachId || !startTime) {
    res.status(400).json({ error: "coachId and startTime are required" });
    return;
  }

  const entitlements = await getUserEntitlements(userId);
  const freq = getSessionFrequency(entitlements);
  if (!freq.allowed) {
    res.status(403).json({ error: "You do not have a 1-on-1 coaching entitlement" });
    return;
  }

  const scheduledAt = new Date(startTime);
  const endTime = addMinutes(scheduledAt, 60);

  const now = new Date();
  if (scheduledAt.getTime() <= now.getTime() + 2 * 60 * 60 * 1000) {
    res.status(400).json({ error: "Sessions must be booked at least 2 hours in advance" });
    return;
  }

  const dateStr = scheduledAt.toISOString().slice(0, 10);
  const validSlots = await getAvailableSlots(coachId, dateStr, dateStr, "UTC");
  const isValidSlot = validSlots.some(s => new Date(s.startTime).getTime() === scheduledAt.getTime());

  if (!isValidSlot) {
    res.status(409).json({ error: "This time slot is not available" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);

    const slotKey = Math.abs(hashCode(`coach:${coachId}:${scheduledAt.toISOString()}`));
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${slotKey})`);

    const sessionsInPeriod = await txDb
      .select()
      .from(coachingSessionsTable)
      .where(
        and(
          eq(coachingSessionsTable.memberId, userId),
          inArray(coachingSessionsTable.status, ["scheduled", "completed", "no_show"]),
          gte(coachingSessionsTable.scheduledAt, freq.periodStart),
          lte(coachingSessionsTable.scheduledAt, freq.periodEnd)
        )
      );

    if (sessionsInPeriod.length >= 1) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: `You have already used your ${freq.frequency} 1-on-1 session` });
      return;
    }

    const conflicts = await txDb.execute(sql`
      SELECT id FROM coaching_sessions
      WHERE coach_id = ${coachId}
      AND status = 'scheduled'
      AND scheduled_at < ${endTime.toISOString()}::timestamptz
      AND scheduled_at + (duration_minutes || ' minutes')::interval > ${scheduledAt.toISOString()}::timestamptz
      FOR UPDATE
    `);

    if (conflicts.rows && conflicts.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "This time slot is no longer available" });
      return;
    }

    const coach = await txDb.select().from(coachesTable).where(eq(coachesTable.id, coachId)).then(r => r[0]);
    if (!coach || !coach.oneOnOneEnabled) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Coach not found or does not offer 1-on-1 sessions" });
      return;
    }

    const [session] = await txDb.insert(coachingSessionsTable).values({
      coachId,
      memberId: userId,
      scheduledAt,
      durationMinutes: 60,
      status: "scheduled",
      meetLink: coach.meetLink,
    }).returning();

    await client.query("COMMIT");
    res.status(201).json(session);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

router.get("/coaching/one-on-one/sessions", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const status = req.query.status as string | undefined;

  let conditions = [eq(coachingSessionsTable.memberId, userId)];
  if (status) {
    conditions.push(eq(coachingSessionsTable.status, status));
  }

  const sessions = await db
    .select({
      id: coachingSessionsTable.id,
      coachId: coachingSessionsTable.coachId,
      coachName: coachesTable.name,
      scheduledAt: coachingSessionsTable.scheduledAt,
      durationMinutes: coachingSessionsTable.durationMinutes,
      status: coachingSessionsTable.status,
      meetLink: coachingSessionsTable.meetLink,
      createdAt: coachingSessionsTable.createdAt,
    })
    .from(coachingSessionsTable)
    .innerJoin(coachesTable, eq(coachingSessionsTable.coachId, coachesTable.id))
    .where(and(...conditions))
    .orderBy(desc(coachingSessionsTable.scheduledAt));

  res.json(sessions);
});

router.get("/coaching/one-on-one/sessions/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const sessionId = parseInt(req.params.id);

  const sessions = await db
    .select({
      id: coachingSessionsTable.id,
      coachId: coachingSessionsTable.coachId,
      coachName: coachesTable.name,
      coachPhotoUrl: coachesTable.photoUrl,
      memberId: coachingSessionsTable.memberId,
      scheduledAt: coachingSessionsTable.scheduledAt,
      durationMinutes: coachingSessionsTable.durationMinutes,
      status: coachingSessionsTable.status,
      meetLink: coachingSessionsTable.meetLink,
      memberNotes: coachingSessionsTable.memberNotes,
      actionItems: coachingSessionsTable.actionItems,
      cancelledAt: coachingSessionsTable.cancelledAt,
      cancelledBy: coachingSessionsTable.cancelledBy,
      cancellationReason: coachingSessionsTable.cancellationReason,
      creditReturned: coachingSessionsTable.creditReturned,
      rescheduledFromId: coachingSessionsTable.rescheduledFromId,
      rescheduledToId: coachingSessionsTable.rescheduledToId,
      createdAt: coachingSessionsTable.createdAt,
      updatedAt: coachingSessionsTable.updatedAt,
    })
    .from(coachingSessionsTable)
    .innerJoin(coachesTable, eq(coachingSessionsTable.coachId, coachesTable.id))
    .where(
      and(
        eq(coachingSessionsTable.id, sessionId),
        eq(coachingSessionsTable.memberId, userId)
      )
    );

  if (sessions.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const rating = await db
    .select()
    .from(coachingRatingsTable)
    .where(eq(coachingRatingsTable.sessionId, sessionId))
    .then(r => r[0] || null);

  res.json({
    ...sessions[0],
    rating: rating ? { rating: rating.rating, comment: rating.comment, createdAt: rating.createdAt } : null,
  });
});

router.patch("/coaching/one-on-one/sessions/:id/cancel", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const sessionId = parseInt(req.params.id);
  const { reason } = req.body || {};

  const session = await db
    .select()
    .from(coachingSessionsTable)
    .where(
      and(
        eq(coachingSessionsTable.id, sessionId),
        eq(coachingSessionsTable.memberId, userId),
        eq(coachingSessionsTable.status, "scheduled")
      )
    )
    .then(r => r[0]);

  if (!session) {
    res.status(404).json({ error: "Session not found or cannot be cancelled" });
    return;
  }

  const now = new Date();
  const hoursUntilSession = (new Date(session.scheduledAt).getTime() - now.getTime()) / (1000 * 60 * 60);
  const creditReturned = hoursUntilSession >= 24;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);

    const cancelKey = Math.abs(hashCode(`session:cancel:${sessionId}`));
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${cancelKey})`);

    const current = await txDb.select({ status: coachingSessionsTable.status })
      .from(coachingSessionsTable)
      .where(eq(coachingSessionsTable.id, sessionId))
      .then(r => r[0]);

    if (!current || current.status !== "scheduled") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Session is no longer in a cancellable state" });
      return;
    }

    await txDb.update(coachingSessionsTable)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: "member",
        cancellationReason: reason || null,
        creditReturned,
      })
      .where(eq(coachingSessionsTable.id, sessionId));

    await client.query("COMMIT");

    res.json({
      id: sessionId,
      status: "cancelled",
      creditReturned,
      message: creditReturned
        ? "Session cancelled. Your credit has been returned."
        : "Session cancelled. Credit was not returned because cancellation was within 24 hours of the session.",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

router.post("/coaching/one-on-one/sessions/:id/reschedule", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const sessionId = parseInt(req.params.id);
  const { newStartTime, coachId: newCoachId } = req.body;

  if (!newStartTime) {
    res.status(400).json({ error: "newStartTime is required" });
    return;
  }

  const session = await db
    .select()
    .from(coachingSessionsTable)
    .where(
      and(
        eq(coachingSessionsTable.id, sessionId),
        eq(coachingSessionsTable.memberId, userId),
        eq(coachingSessionsTable.status, "scheduled")
      )
    )
    .then(r => r[0]);

  if (!session) {
    res.status(404).json({ error: "Session not found or cannot be rescheduled" });
    return;
  }

  const targetCoachId = newCoachId || session.coachId;
  const newScheduledAt = new Date(newStartTime);
  const now = new Date();
  const minRescheduleTime = addMinutes(now, 120);
  if (newScheduledAt < minRescheduleTime) {
    res.status(400).json({ error: "New time must be at least 2 hours from now" });
    return;
  }
  const newEndTime = addMinutes(newScheduledAt, 60);

  const dateStr = newScheduledAt.toISOString().slice(0, 10);
  const validSlots = await getAvailableSlots(targetCoachId, dateStr, dateStr, "UTC");
  const isValidSlot = validSlots.some(s => new Date(s.startTime).getTime() === newScheduledAt.getTime());

  if (!isValidSlot) {
    res.status(409).json({ error: "This time slot is not available" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);

    const slotKey = Math.abs(hashCode(`coach:${targetCoachId}:${newScheduledAt.toISOString()}`));
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(${slotKey})`);

    const conflicts = await txDb.execute(sql`
      SELECT id FROM coaching_sessions
      WHERE coach_id = ${targetCoachId}
      AND status = 'scheduled'
      AND id != ${sessionId}
      AND scheduled_at < ${newEndTime.toISOString()}::timestamptz
      AND scheduled_at + (duration_minutes || ' minutes')::interval > ${newScheduledAt.toISOString()}::timestamptz
      FOR UPDATE
    `);

    if (conflicts.rows && conflicts.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "This time slot is no longer available" });
      return;
    }

    const coach = await txDb.select().from(coachesTable).where(eq(coachesTable.id, targetCoachId)).then(r => r[0]);

    await txDb.update(coachingSessionsTable)
      .set({ status: "rescheduled", cancelledAt: new Date(), cancelledBy: "member", cancellationReason: "Rescheduled" })
      .where(eq(coachingSessionsTable.id, sessionId));

    const [newSession] = await txDb.insert(coachingSessionsTable).values({
      coachId: targetCoachId,
      memberId: userId,
      scheduledAt: newScheduledAt,
      durationMinutes: 60,
      status: "scheduled",
      meetLink: coach?.meetLink || session.meetLink,
      rescheduledFromId: sessionId,
    }).returning();

    await txDb.update(coachingSessionsTable)
      .set({ rescheduledToId: newSession.id })
      .where(eq(coachingSessionsTable.id, sessionId));

    await client.query("COMMIT");
    res.status(201).json(newSession);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

router.patch("/coaching/one-on-one/sessions/:id/action-items", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const sessionId = parseInt(req.params.id);
  const { actionItemId, completed } = req.body;

  if (!actionItemId || typeof completed !== "boolean") {
    res.status(400).json({ error: "actionItemId and completed are required" });
    return;
  }

  const session = await db
    .select()
    .from(coachingSessionsTable)
    .where(
      and(
        eq(coachingSessionsTable.id, sessionId),
        eq(coachingSessionsTable.memberId, userId)
      )
    )
    .then(r => r[0]);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const actionItems = (session.actionItems as ActionItem[] || []).map(item => {
    if (item.id === actionItemId) {
      return {
        ...item,
        completed,
        completedAt: completed ? new Date().toISOString() : undefined,
      };
    }
    return item;
  });

  await db.update(coachingSessionsTable)
    .set({ actionItems })
    .where(eq(coachingSessionsTable.id, sessionId));

  res.json({ actionItems });
});

router.post("/coaching/one-on-one/sessions/:id/rate", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const sessionId = parseInt(req.params.id);
  const { rating, comment } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    res.status(400).json({ error: "Rating must be between 1 and 5" });
    return;
  }

  const session = await db
    .select()
    .from(coachingSessionsTable)
    .where(
      and(
        eq(coachingSessionsTable.id, sessionId),
        eq(coachingSessionsTable.memberId, userId),
        eq(coachingSessionsTable.status, "completed")
      )
    )
    .then(r => r[0]);

  if (!session) {
    res.status(404).json({ error: "Session not found or not completed" });
    return;
  }

  const existingRating = await db
    .select()
    .from(coachingRatingsTable)
    .where(eq(coachingRatingsTable.sessionId, sessionId))
    .then(r => r[0]);

  if (existingRating) {
    res.status(409).json({ error: "You have already rated this session" });
    return;
  }

  const [newRating] = await db.insert(coachingRatingsTable).values({
    sessionId,
    coachId: session.coachId,
    memberId: userId,
    rating,
    comment: comment || null,
  }).returning();

  const allRatings = await db
    .select({ rating: coachingRatingsTable.rating })
    .from(coachingRatingsTable)
    .where(eq(coachingRatingsTable.coachId, session.coachId));

  const avg = allRatings.reduce((sum, r) => sum + r.rating, 0) / allRatings.length;

  await db.update(coachesTable)
    .set({
      averageRating: avg.toFixed(2),
      totalRatings: allRatings.length,
    })
    .where(eq(coachesTable.id, session.coachId));

  res.status(201).json(newRating);
});

export default router;
