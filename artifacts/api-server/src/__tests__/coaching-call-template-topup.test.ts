import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  coachesTable,
  coachingCallsTable,
  coachingCallTemplatesTable,
} from "@workspace/db";
import { eq, inArray, asc } from "drizzle-orm";

import {
  runCoachingCallTemplateTopUp,
  getCoachingCallTemplateTopUpStatus,
  __resetCoachingCallTemplateTopUpStateForTests,
} from "../lib/coaching-call-template-topup";
import { vi } from "vitest";

// Verifies the periodic auto top-up keeps active recurring series populated
// into the future, skips inactive templates, and is idempotent on re-run.

const TAG = `topup-${randomUUID().slice(0, 8)}`;
const DAY = 24 * 60 * 60 * 1000;

let coachId = 0;
const createdTemplateIds: number[] = [];

async function series(templateId: number) {
  return db
    .select({ id: coachingCallsTable.id, scheduledAt: coachingCallsTable.scheduledAt })
    .from(coachingCallsTable)
    .where(eq(coachingCallsTable.templateId, templateId))
    .orderBy(asc(coachingCallsTable.scheduledAt));
}

async function makeTemplate(opts: {
  anchorDaysFromNow: number;
  occurrencesPerBatch: number;
  active: boolean;
  lastGeneratedAt: Date | null;
}) {
  const [tpl] = await db
    .insert(coachingCallTemplatesTable)
    .values({
      title: `${TAG} series`,
      description: "",
      callType: "weekly_qa",
      coachId,
      intervalDays: 7,
      occurrencesPerBatch: opts.occurrencesPerBatch,
      anchorAt: new Date(Date.now() + opts.anchorDaysFromNow * DAY),
      lastGeneratedAt: opts.lastGeneratedAt,
      active: opts.active,
    })
    .returning();
  createdTemplateIds.push(tpl.id);
  return tpl;
}

beforeAll(async () => {
  const [coach] = await db
    .insert(coachesTable)
    .values({ name: `${TAG} Coach`, bio: "b", specialties: "s" })
    .returning({ id: coachesTable.id });
  coachId = coach.id;
});

afterAll(async () => {
  if (createdTemplateIds.length > 0) {
    await db
      .delete(coachingCallsTable)
      .where(inArray(coachingCallsTable.templateId, createdTemplateIds));
    await db
      .delete(coachingCallTemplatesTable)
      .where(inArray(coachingCallTemplatesTable.id, createdTemplateIds));
  }
  if (coachId) {
    await db.delete(coachesTable).where(eq(coachesTable.id, coachId));
  }
});

describe("runCoachingCallTemplateTopUp", () => {
  it("extends an active series whose generated weeks have nearly run out", async () => {
    // Watermark only a week out: well inside the 28-day look-ahead, so it
    // should be topped up to at least ~4 weeks ahead.
    const tpl = await makeTemplate({
      anchorDaysFromNow: 7,
      occurrencesPerBatch: 2,
      active: true,
      lastGeneratedAt: new Date(Date.now() + 7 * DAY),
    });

    const results = await runCoachingCallTemplateTopUp();
    const mine = results.find((r) => r.templateId === tpl.id);
    expect(mine).toBeTruthy();
    expect(mine!.created).toBeGreaterThan(0);

    const rows = await series(tpl.id);
    const furthest = rows[rows.length - 1].scheduledAt.getTime();
    // Now populated past the look-ahead horizon (28 days).
    expect(furthest).toBeGreaterThanOrEqual(Date.now() + 28 * DAY);

    // Watermark advanced to match the furthest generated call.
    const [after] = await db
      .select({ lastGeneratedAt: coachingCallTemplatesTable.lastGeneratedAt })
      .from(coachingCallTemplatesTable)
      .where(eq(coachingCallTemplatesTable.id, tpl.id));
    expect(after.lastGeneratedAt!.getTime()).toBe(furthest);
  });

  it("does not extend an inactive template", async () => {
    const tpl = await makeTemplate({
      anchorDaysFromNow: 1,
      occurrencesPerBatch: 2,
      active: false,
      lastGeneratedAt: new Date(Date.now() + 1 * DAY),
    });

    const results = await runCoachingCallTemplateTopUp();
    expect(results.find((r) => r.templateId === tpl.id)).toBeUndefined();

    const rows = await series(tpl.id);
    expect(rows).toHaveLength(0);
  });

  it("skips an active template whose coach is archived (isActive=false)", async () => {
    const [archivedCoach] = await db
      .insert(coachesTable)
      .values({
        name: `${TAG} Archived Coach`,
        bio: "b",
        specialties: "s",
        isActive: false,
      })
      .returning({ id: coachesTable.id });

    const [tpl] = await db
      .insert(coachingCallTemplatesTable)
      .values({
        title: `${TAG} archived-coach series`,
        description: "",
        callType: "weekly_qa",
        coachId: archivedCoach.id,
        intervalDays: 7,
        occurrencesPerBatch: 2,
        anchorAt: new Date(Date.now() + 1 * DAY),
        lastGeneratedAt: new Date(Date.now() + 1 * DAY),
        active: true,
      })
      .returning({ id: coachingCallTemplatesTable.id });

    try {
      const results = await runCoachingCallTemplateTopUp();
      // The archived coach's series must not be considered at all — no new
      // member-visible calls may be generated for a hidden coach.
      expect(results.find((r) => r.templateId === tpl.id)).toBeUndefined();
      const rows = await series(tpl.id);
      expect(rows).toHaveLength(0);
    } finally {
      await db
        .delete(coachingCallsTable)
        .where(eq(coachingCallsTable.templateId, tpl.id));
      await db
        .delete(coachingCallTemplatesTable)
        .where(eq(coachingCallTemplatesTable.id, tpl.id));
      await db
        .delete(coachesTable)
        .where(eq(coachesTable.id, archivedCoach.id));
    }
  });

  it("is a no-op for a series already populated past the horizon", async () => {
    const tpl = await makeTemplate({
      anchorDaysFromNow: 60,
      occurrencesPerBatch: 4,
      active: true,
      // Already 60 days out — well beyond the 28-day look-ahead.
      lastGeneratedAt: new Date(Date.now() + 60 * DAY),
    });

    const results = await runCoachingCallTemplateTopUp();
    const mine = results.find((r) => r.templateId === tpl.id);
    expect(mine!.created).toBe(0);
    expect(mine!.batches).toBe(0);

    const rows = await series(tpl.id);
    expect(rows).toHaveLength(0);
  });

  it("is idempotent: a second run creates no further calls", async () => {
    const tpl = await makeTemplate({
      anchorDaysFromNow: 3,
      occurrencesPerBatch: 2,
      active: true,
      lastGeneratedAt: new Date(Date.now() + 3 * DAY),
    });

    await runCoachingCallTemplateTopUp();
    const afterFirst = (await series(tpl.id)).length;
    expect(afterFirst).toBeGreaterThan(0);

    const results = await runCoachingCallTemplateTopUp();
    const mine = results.find((r) => r.templateId === tpl.id);
    expect(mine!.created).toBe(0);

    const afterSecond = (await series(tpl.id)).length;
    expect(afterSecond).toBe(afterFirst);
  });

  it("recovers a dormant series whose watermark is already in the past", async () => {
    const tpl = await makeTemplate({
      anchorDaysFromNow: -90,
      occurrencesPerBatch: 4,
      active: true,
      // Last generated 30 days ago — the series has gone dry.
      lastGeneratedAt: new Date(Date.now() - 30 * DAY),
    });

    const results = await runCoachingCallTemplateTopUp();
    const mine = results.find((r) => r.templateId === tpl.id);
    expect(mine!.created).toBeGreaterThan(0);

    const rows = await series(tpl.id);
    const furthest = rows[rows.length - 1].scheduledAt.getTime();
    expect(furthest).toBeGreaterThanOrEqual(Date.now() + 28 * DAY);
  });
});

describe("getCoachingCallTemplateTopUpStatus", () => {
  it("records a per-template heartbeat after a successful run", async () => {
    const tpl = await makeTemplate({
      anchorDaysFromNow: 7,
      occurrencesPerBatch: 2,
      active: true,
      lastGeneratedAt: new Date(Date.now() + 7 * DAY),
    });

    const before = Date.now();
    await runCoachingCallTemplateTopUp();

    const status = getCoachingCallTemplateTopUpStatus();
    const mine = status.find((s) => s.templateId === tpl.id);
    expect(mine).toBeTruthy();
    expect(mine!.title).toBe(`${TAG} series`);
    // Shape lock: every documented field present, correctly typed.
    expect(typeof mine!.lastRanAt).toBe("string");
    expect(new Date(mine!.lastRanAt!).getTime()).toBeGreaterThanOrEqual(before);
    expect(typeof mine!.lastCreatedCount).toBe("number");
    expect(mine!.lastCreatedCount).toBeGreaterThan(0);
    expect(typeof mine!.lastBatches).toBe("number");
    expect(mine!.lastBatches).toBeGreaterThan(0);
    expect(mine!.lastError).toBeNull();
  });

  it("does not record a heartbeat for an inactive (skipped) template", async () => {
    const tpl = await makeTemplate({
      anchorDaysFromNow: 1,
      occurrencesPerBatch: 2,
      active: false,
      lastGeneratedAt: new Date(Date.now() + 1 * DAY),
    });

    await runCoachingCallTemplateTopUp();

    const status = getCoachingCallTemplateTopUpStatus();
    expect(status.find((s) => s.templateId === tpl.id)).toBeUndefined();
  });

  it("captures lastError when a series fails to top up, then clears it on recovery", async () => {
    const tpl = await makeTemplate({
      anchorDaysFromNow: 5,
      occurrencesPerBatch: 2,
      active: true,
      lastGeneratedAt: new Date(Date.now() + 5 * DAY),
    });

    // Force generation to throw for this run so the heartbeat records an
    // error while still advancing lastRanAt (the on-call signal).
    const dbModule = await import("@workspace/db");
    const failureMessage = "synthetic-topup-failure";
    const spy = vi
      .spyOn(dbModule.db, "insert")
      .mockImplementation(() => {
        throw new Error(failureMessage);
      });

    try {
      await runCoachingCallTemplateTopUp();
    } finally {
      spy.mockRestore();
    }

    const failedStatus = getCoachingCallTemplateTopUpStatus().find(
      (s) => s.templateId === tpl.id,
    );
    expect(failedStatus).toBeTruthy();
    expect(failedStatus!.lastError).not.toBeNull();
    expect(failedStatus!.lastError!.message).toBe(failureMessage);
    expect(typeof failedStatus!.lastError!.at).toBe("string");
    // The heartbeat still advanced even though the run failed.
    expect(typeof failedStatus!.lastRanAt).toBe("string");

    // A subsequent successful run clears the error so the surface de-flags.
    await runCoachingCallTemplateTopUp();
    const recoveredStatus = getCoachingCallTemplateTopUpStatus().find(
      (s) => s.templateId === tpl.id,
    );
    expect(recoveredStatus!.lastError).toBeNull();
  });

  it("the test reset hook clears recorded heartbeats", async () => {
    const tpl = await makeTemplate({
      anchorDaysFromNow: 4,
      occurrencesPerBatch: 2,
      active: true,
      lastGeneratedAt: new Date(Date.now() + 4 * DAY),
    });

    await runCoachingCallTemplateTopUp();
    expect(
      getCoachingCallTemplateTopUpStatus().some((s) => s.templateId === tpl.id),
    ).toBe(true);

    __resetCoachingCallTemplateTopUpStateForTests();
    expect(getCoachingCallTemplateTopUpStatus()).toHaveLength(0);
  });
});
