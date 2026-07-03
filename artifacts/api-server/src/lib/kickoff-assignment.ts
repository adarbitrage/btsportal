import { db, kickoffCoachesTable, callBookingsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getUserEntitlements, getHighestProductLabel } from "./entitlements";

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
  ghlLocationId: string;
}

// Task #1641: which kickoff-coach roster a member draws from. 'launchpad'
// members (rank 1, product-rank.ts) round-robin ONLY across coaches tiered
// 'launchpad' (Neil, on his own dedicated calendar); everyone else eligible
// for a kickoff call (3-Month+, rank >= 2) round-robins across 'full' tier
// coaches (Todd/Mark/Bruce). There is deliberately no cross-tier fallback —
// see the loud-failure guard in call-bookings.ts.
export type KickoffCoachTier = "launchpad" | "full";

export async function selectKickoffCoach(
  tier: KickoffCoachTier,
): Promise<SelectedKickoffCoach | null> {
  const candidates = await db
    .select({
      id: kickoffCoachesTable.id,
      displayName: kickoffCoachesTable.displayName,
      photoUrl: kickoffCoachesTable.photoUrl,
      bio: kickoffCoachesTable.bio,
      ghlCalendarId: kickoffCoachesTable.ghlCalendarId,
      ghlLocationId: kickoffCoachesTable.ghlLocationId,
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
    .where(and(eq(kickoffCoachesTable.isActive, true), eq(kickoffCoachesTable.tier, tier)))
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
    ghlLocationId: chosen.ghlLocationId,
  };
}

// Task #1641: map a member's current highest product to a kickoff-coach
// tier bucket. LaunchPad (rank 1) is the only bucket that gets 'launchpad';
// everything else (including 3-Month+, which is the only other cohort that
// ever reaches kickoff booking) falls into 'full'.
export async function getMemberKickoffTier(userId: number): Promise<KickoffCoachTier> {
  const entitlements = await getUserEntitlements(userId);
  const highest = getHighestProductLabel(entitlements);
  return highest.slug === "launchpad" ? "launchpad" : "full";
}

export async function loadKickoffCoachById(coachId: number): Promise<SelectedKickoffCoach | null> {
  const [row] = await db
    .select({
      id: kickoffCoachesTable.id,
      displayName: kickoffCoachesTable.displayName,
      photoUrl: kickoffCoachesTable.photoUrl,
      bio: kickoffCoachesTable.bio,
      ghlCalendarId: kickoffCoachesTable.ghlCalendarId,
      ghlLocationId: kickoffCoachesTable.ghlLocationId,
    })
    .from(kickoffCoachesTable)
    .where(and(eq(kickoffCoachesTable.id, coachId), eq(kickoffCoachesTable.isActive, true)));
  if (!row || !row.ghlCalendarId) return null;
  return { ...row, ghlCalendarId: row.ghlCalendarId };
}
