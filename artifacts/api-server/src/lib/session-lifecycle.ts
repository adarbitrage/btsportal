import { db, coachingSessionsTable, coachesTable } from "@workspace/db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { addMinutes, subHours } from "date-fns";

export async function completeExpiredSessions(): Promise<number> {
  const now = new Date();

  const expiredSessions = await db
    .select({ id: coachingSessionsTable.id, scheduledAt: coachingSessionsTable.scheduledAt, durationMinutes: coachingSessionsTable.durationMinutes })
    .from(coachingSessionsTable)
    .where(
      and(
        eq(coachingSessionsTable.status, "scheduled"),
        lte(coachingSessionsTable.scheduledAt, subHours(now, 1))
      )
    );

  const toComplete = expiredSessions.filter(s => {
    const endTime = addMinutes(new Date(s.scheduledAt), s.durationMinutes);
    return endTime <= now;
  });

  if (toComplete.length === 0) return 0;

  for (const session of toComplete) {
    await db.update(coachingSessionsTable)
      .set({ status: "completed" })
      .where(eq(coachingSessionsTable.id, session.id));
  }

  console.log(`[session-lifecycle] Auto-completed ${toComplete.length} expired sessions`);
  return toComplete.length;
}

export async function checkAndSendReminders(): Promise<{ reminders24h: number; reminders1h: number }> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in1h = new Date(now.getTime() + 60 * 60 * 1000);

  const sessions24h = await db
    .select()
    .from(coachingSessionsTable)
    .innerJoin(coachesTable, eq(coachingSessionsTable.coachId, coachesTable.id))
    .where(
      and(
        eq(coachingSessionsTable.status, "scheduled"),
        eq(coachingSessionsTable.reminder24hSent, false),
        gte(coachingSessionsTable.scheduledAt, now),
        lte(coachingSessionsTable.scheduledAt, in24h)
      )
    );

  for (const row of sessions24h) {
    console.log(`[reminder-stub] 24h reminder for session ${row.coaching_sessions.id} - member ${row.coaching_sessions.memberId} with coach ${row.coaches.name} at ${row.coaching_sessions.scheduledAt}`);
    console.log(`[reminder-stub] Would send email via SendGrid and SMS via Twilio`);

    await db.update(coachingSessionsTable)
      .set({ reminder24hSent: true })
      .where(eq(coachingSessionsTable.id, row.coaching_sessions.id));
  }

  const sessions1h = await db
    .select()
    .from(coachingSessionsTable)
    .innerJoin(coachesTable, eq(coachingSessionsTable.coachId, coachesTable.id))
    .where(
      and(
        eq(coachingSessionsTable.status, "scheduled"),
        eq(coachingSessionsTable.reminder1hSent, false),
        gte(coachingSessionsTable.scheduledAt, now),
        lte(coachingSessionsTable.scheduledAt, in1h)
      )
    );

  for (const row of sessions1h) {
    console.log(`[reminder-stub] 1h reminder for session ${row.coaching_sessions.id} - member ${row.coaching_sessions.memberId} with coach ${row.coaches.name} at ${row.coaching_sessions.scheduledAt}`);
    console.log(`[reminder-stub] Would send email via SendGrid and SMS via Twilio`);

    await db.update(coachingSessionsTable)
      .set({ reminder1hSent: true })
      .where(eq(coachingSessionsTable.id, row.coaching_sessions.id));
  }

  console.log(`[session-lifecycle] Sent ${sessions24h.length} 24h reminders and ${sessions1h.length} 1h reminders`);
  return { reminders24h: sessions24h.length, reminders1h: sessions1h.length };
}
