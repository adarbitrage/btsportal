import { db, kickoffCoachesTable, callBookingsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

// Round-robin kickoff-coach selection (Task #1591 / Tier 2). Unlike
// accountability partners, kickoff coaches have no persisted assignment-
// history table — a kickoff call is a one-time event per member, so
// `call_bookings` itself (type = "kickoff", staff_type = "kickoff_coach") is
// the load signal. Selection is re-run fresh on every call (availability
// fetch AND book), the same way session-pack/VA coach selection has no
// separate "current assignment" concept either.
//
// Selection: the active, calendar-configured kickoff coach with the fewest
// non-canceled kickoff bookings, tie-broken by lowest id so ties are
// deterministic across calls made moments apart.
export interface SelectedKickoffCoach {
  id: number;
  displayName: string;
  photoUrl: string | null;
  bio: string | null;
  ghlCalendarId: string;
}

export async function selectKickoffCoach(): Promise<SelectedKickoffCoach | null> {
  const candidates = await db
    .select({
      id: kickoffCoachesTable.id,
      displayName: kickoffCoachesTable.displayName,
      photoUrl: kickoffCoachesTable.photoUrl,
      bio: kickoffCoachesTable.bio,
      ghlCalendarId: kickoffCoachesTable.ghlCalendarId,
      bookingCount: sql<number>`count(${callBookingsTable.id}) filter (where ${callBookingsTable.status} <> 'canceled')`,
    })
    .from(kickoffCoachesTable)
    .leftJoin(
      callBookingsTable,
      and(
        eq(callBookingsTable.staffId, kickoffCoachesTable.id),
        eq(callBookingsTable.staffType, "kickoff_coach"),
      ),
    )
    .where(eq(kickoffCoachesTable.isActive, true))
    .groupBy(kickoffCoachesTable.id)
    .orderBy(
      sql`count(${callBookingsTable.id}) filter (where ${callBookingsTable.status} <> 'canceled') asc`,
      kickoffCoachesTable.id,
    );

  // Coaches without a configured calendar simply offer no bookable slots —
  // filter them out here rather than in the where() clause above.
  const withCalendar = candidates.filter((c) => !!c.ghlCalendarId);
  const chosen = withCalendar[0];
  if (!chosen) return null;
  return {
    id: chosen.id,
    displayName: chosen.displayName,
    photoUrl: chosen.photoUrl,
    bio: chosen.bio,
    ghlCalendarId: chosen.ghlCalendarId as string,
  };
}

export async function loadKickoffCoachById(coachId: number): Promise<SelectedKickoffCoach | null> {
  const [row] = await db
    .select({
      id: kickoffCoachesTable.id,
      displayName: kickoffCoachesTable.displayName,
      photoUrl: kickoffCoachesTable.photoUrl,
      bio: kickoffCoachesTable.bio,
      ghlCalendarId: kickoffCoachesTable.ghlCalendarId,
    })
    .from(kickoffCoachesTable)
    .where(and(eq(kickoffCoachesTable.id, coachId), eq(kickoffCoachesTable.isActive, true)));
  if (!row || !row.ghlCalendarId) return null;
  return { ...row, ghlCalendarId: row.ghlCalendarId };
}
