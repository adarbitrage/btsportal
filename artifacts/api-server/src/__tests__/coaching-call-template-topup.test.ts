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

import { runCoachingCallTemplateTopUp } from "../lib/coaching-call-template-topup";

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
    .values({ name: `${TAG} Coach`, bio: "b", specialties: "s", callTypes: ["weekly_qa"] })
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
