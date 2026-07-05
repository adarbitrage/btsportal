import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db, partnersTable, kickoffCoachesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: async () => false,
}));

import {
  seedPartnerPhotos,
  PARTNER_PHOTO_PATHS,
  KICKOFF_COACH_PHOTO_PATHS,
} from "../lib/seed-partner-photos";

// The seed keys on the EXACT production display names, so the test must use
// them. We only ever create rows when none exist for a name, and clean up
// strictly by the ids we created, so a real roster row (if one ever appears
// in this DB) is never touched or deleted by this spec.
const CUSTOM_URL = "/objects/custom-admin-upload.png";

let createdIds: number[] = [];
let createdKickoffIds: number[] = [];

async function createKickoffIfAbsent(
  displayName: string,
  photoUrl: string | null,
): Promise<number | null> {
  const [existing] = await db
    .select({ id: kickoffCoachesTable.id })
    .from(kickoffCoachesTable)
    .where(eq(kickoffCoachesTable.displayName, displayName))
    .limit(1);
  if (existing) return null;
  const [row] = await db
    .insert(kickoffCoachesTable)
    .values({ displayName, photoUrl })
    .returning({ id: kickoffCoachesTable.id });
  createdKickoffIds.push(row.id);
  return row.id;
}

async function createIfAbsent(displayName: string, photoUrl: string | null): Promise<number | null> {
  const [existing] = await db
    .select({ id: partnersTable.id })
    .from(partnersTable)
    .where(eq(partnersTable.displayName, displayName))
    .limit(1);
  if (existing) return null;
  const [row] = await db
    .insert(partnersTable)
    .values({ displayName, photoUrl, isActive: displayName !== "Myco" })
    .returning({ id: partnersTable.id });
  createdIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  createdIds = [];
  createdKickoffIds = [];
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(partnersTable).where(inArray(partnersTable.id, createdIds));
  }
  if (createdKickoffIds.length > 0) {
    await db
      .delete(kickoffCoachesTable)
      .where(inArray(kickoffCoachesTable.id, createdKickoffIds));
  }
});

describe("seedPartnerPhotos", () => {
  it("no-ops cleanly when no partner rows exist", async () => {
    // Must not throw and must not insert any rows.
    const before = await db.select({ id: partnersTable.id }).from(partnersTable);
    await seedPartnerPhotos();
    const after = await db.select({ id: partnersTable.id }).from(partnersTable);
    expect(after.length).toBe(before.length);
  });

  it("sets photo_url only where NULL, never clobbers, includes inactive Myco", async () => {
    const mikhaId = await createIfAbsent("Mikha", null);
    const mycoId = await createIfAbsent("Myco", null); // is_active=false
    const johnId = await createIfAbsent("John", CUSTOM_URL); // pre-set: must survive
    // Neil intentionally absent: seed must no-op for him without inserting.
    if (mikhaId === null || mycoId === null || johnId === null) {
      // A real roster row already exists in this DB — skip rather than
      // mutate data we don't own.
      return;
    }

    await seedPartnerPhotos();

    const rows = await db
      .select({
        id: partnersTable.id,
        displayName: partnersTable.displayName,
        photoUrl: partnersTable.photoUrl,
      })
      .from(partnersTable)
      .where(inArray(partnersTable.id, [mikhaId, mycoId, johnId]));
    const byName = new Map(rows.map((r) => [r.displayName, r]));

    expect(byName.get("Mikha")?.photoUrl).toBe(PARTNER_PHOTO_PATHS.Mikha);
    // Inactive rows still get armed — the seed must not filter on is_active.
    expect(byName.get("Myco")?.photoUrl).toBe(PARTNER_PHOTO_PATHS.Myco);
    // Non-null photo_url is never clobbered (admin replacement survives boots).
    expect(byName.get("John")?.photoUrl).toBe(CUSTOM_URL);

    // Neil was never inserted by the seed.
    const neil = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(eq(partnersTable.displayName, "Neil"));
    const neilCreatedByUs = neil.filter((r) => createdIds.includes(r.id));
    expect(neilCreatedByUs.length).toBe(0);

    // Idempotent: second run changes nothing.
    await seedPartnerPhotos();
    const [mikhaAgain] = await db
      .select({ photoUrl: partnersTable.photoUrl })
      .from(partnersTable)
      .where(eq(partnersTable.id, mikhaId));
    expect(mikhaAgain.photoUrl).toBe(PARTNER_PHOTO_PATHS.Mikha);
  });

  it("sets kickoff-coach photo_url only where NULL, never clobbers", async () => {
    const bruceId = await createKickoffIfAbsent("Bruce", null);
    const markId = await createKickoffIfAbsent("Mark", CUSTOM_URL); // pre-set: must survive
    const neilId = await createKickoffIfAbsent("Neil", null);
    // Todd intentionally absent: seed must no-op for him without inserting.
    if (bruceId === null || markId === null || neilId === null) {
      // A real roster row already exists in this DB — skip rather than
      // mutate data we don't own.
      return;
    }

    await seedPartnerPhotos();

    const rows = await db
      .select({
        id: kickoffCoachesTable.id,
        displayName: kickoffCoachesTable.displayName,
        photoUrl: kickoffCoachesTable.photoUrl,
      })
      .from(kickoffCoachesTable)
      .where(inArray(kickoffCoachesTable.id, [bruceId, markId, neilId]));
    const byName = new Map(rows.map((r) => [r.displayName, r]));

    expect(byName.get("Bruce")?.photoUrl).toBe(KICKOFF_COACH_PHOTO_PATHS.Bruce);
    // Non-null photo_url is never clobbered (admin replacement survives boots).
    expect(byName.get("Mark")?.photoUrl).toBe(CUSTOM_URL);
    expect(byName.get("Neil")?.photoUrl).toBe(KICKOFF_COACH_PHOTO_PATHS.Neil);

    // Todd was never inserted by the seed.
    const todd = await db
      .select({ id: kickoffCoachesTable.id })
      .from(kickoffCoachesTable)
      .where(eq(kickoffCoachesTable.displayName, "Todd"));
    const toddCreatedByUs = todd.filter((r) => createdKickoffIds.includes(r.id));
    expect(toddCreatedByUs.length).toBe(0);

    // Idempotent: second run changes nothing.
    await seedPartnerPhotos();
    const [neilAgain] = await db
      .select({ photoUrl: kickoffCoachesTable.photoUrl })
      .from(kickoffCoachesTable)
      .where(eq(kickoffCoachesTable.id, neilId));
    expect(neilAgain.photoUrl).toBe(KICKOFF_COACH_PHOTO_PATHS.Neil);
  });
});
