import { db, partnersTable, kickoffCoachesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Task #1611: verified live (read-only, 2026-07-02) GHL calendar roster for
// the accountability-partner and kickoff-coach round robins. All calendars
// below live in the "Build Test Scale" GHL sub-account — a distinct location
// from COACHING_LOCATION_ID (the private/group coaching sub-account) — which
// is why every row also needs its own `ghlLocationId`.
//
// Idempotent: keyed on displayName (neither table has a natural unique
// business key), update-if-exists / insert-if-missing on every boot so
// production picks up the roster on its next deploy without a manual
// migration (the agent cannot write prod directly). Re-running with the same
// data is always a no-op after the first successful run.
const BTS_LOCATION_ID = "7XrT9sAfQ4rSyuk5QhhC";

interface PartnerRosterEntry {
  displayName: string;
  ghlCalendarId: string | null;
  isActive: boolean;
  maxDailyCalls: number;
}

interface KickoffCoachRosterEntry {
  displayName: string;
  ghlCalendarId: string;
  isActive: boolean;
}

const PARTNER_ROSTER: PartnerRosterEntry[] = [
  { displayName: "Jean", ghlCalendarId: "nkYhDbtQT3JCmiOtyz1w", isActive: true, maxDailyCalls: 6 },
  { displayName: "Mikha", ghlCalendarId: "1eLYfVfYqD9oViR4LQO0", isActive: true, maxDailyCalls: 6 },
  { displayName: "John", ghlCalendarId: "QVVfVN9hOeHDfH61JAjn", isActive: true, maxDailyCalls: 6 },
  { displayName: "Neil", ghlCalendarId: "2BCEaFdbunl34Idf4F56", isActive: true, maxDailyCalls: 6 },
  // Myco has no GHL calendar anywhere in the agency yet (verified by
  // name/slug search) — seeded inactive with no calendar so round-robin
  // assignment (assignRoundRobin filters isActive=true) and booking
  // (loadAssignedPartner requires ghlCalendarId) both skip them until a real
  // calendar exists and the user signals it's ready to arm.
  { displayName: "Myco", ghlCalendarId: null, isActive: false, maxDailyCalls: 6 },
];

const KICKOFF_COACH_ROSTER: KickoffCoachRosterEntry[] = [
  { displayName: "Todd", ghlCalendarId: "Nx8nzFJxkxHQlQyx5ZSW", isActive: true },
  { displayName: "Mark", ghlCalendarId: "wvSF5RfAi8FlsgHRo8IQ", isActive: true },
  { displayName: "Bruce", ghlCalendarId: "wLvil3ING3i1d4oX7vg5", isActive: true },
];

export async function seedCallBookingRoster(): Promise<void> {
  for (const entry of PARTNER_ROSTER) {
    const [existing] = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(eq(partnersTable.displayName, entry.displayName))
      .limit(1);
    const values = {
      displayName: entry.displayName,
      ghlCalendarId: entry.ghlCalendarId,
      ghlLocationId: BTS_LOCATION_ID,
      isActive: entry.isActive,
      maxDailyCalls: entry.maxDailyCalls,
    };
    if (existing) {
      await db.update(partnersTable).set(values).where(eq(partnersTable.id, existing.id));
    } else {
      await db.insert(partnersTable).values(values);
    }
  }

  for (const entry of KICKOFF_COACH_ROSTER) {
    const [existing] = await db
      .select({ id: kickoffCoachesTable.id })
      .from(kickoffCoachesTable)
      .where(eq(kickoffCoachesTable.displayName, entry.displayName))
      .limit(1);
    const values = {
      displayName: entry.displayName,
      ghlCalendarId: entry.ghlCalendarId,
      ghlLocationId: BTS_LOCATION_ID,
      isActive: entry.isActive,
    };
    if (existing) {
      await db.update(kickoffCoachesTable).set(values).where(eq(kickoffCoachesTable.id, existing.id));
    } else {
      await db.insert(kickoffCoachesTable).values(values);
    }
  }
}
