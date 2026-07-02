import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { db, usersTable, memberRefundEventsTable, systemSettingsTable } from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";
import {
  getRefundRateBaseline,
  setRefundRateBaseline,
  validateBaselinePercent,
  getPartneredCohortMonthlyTrend,
  computeMonthlyTrendForCohort,
  getPartneredMemberIds,
} from "../lib/partnered-cohort-metrics";

const TAG = `cohort-metrics-${randomUUID().slice(0, 8)}`;
const BASELINE_KEY = "partnered_cohort.refund_rate_baseline_percent";

const userIds: number[] = [];

async function insertMember(suffix: string): Promise<number> {
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-${suffix}@example.test`,
      name: `Cohort Member ${suffix}`,
      passwordHash: "x",
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  userIds.push(row.id);
  return row.id;
}

async function insertEvent(memberId: number, type: "refund" | "chargeback", occurredAt: Date, suffix: string) {
  await db.insert(memberRefundEventsTable).values({
    memberId,
    orderId: null,
    orderNumber: null,
    type,
    amountCents: 1000,
    nmiTransactionId: `${TAG}-${suffix}`,
    matched: true,
    occurredAt,
  });
}

afterAll(async () => {
  await db.delete(memberRefundEventsTable).where(like(memberRefundEventsTable.nmiTransactionId, `${TAG}%`));
  await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, BASELINE_KEY));
  if (userIds.length > 0) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
});

describe("validateBaselinePercent", () => {
  it("accepts values in [0, 100]", () => {
    expect(validateBaselinePercent(0)).toEqual({ ok: true, value: 0 });
    expect(validateBaselinePercent(12.5)).toEqual({ ok: true, value: 12.5 });
    expect(validateBaselinePercent(100)).toEqual({ ok: true, value: 100 });
  });

  it("rejects out-of-range and non-numeric input", () => {
    expect(validateBaselinePercent(-1).ok).toBe(false);
    expect(validateBaselinePercent(101).ok).toBe(false);
    expect(validateBaselinePercent("12" as unknown).ok).toBe(false);
    expect(validateBaselinePercent(NaN).ok).toBe(false);
  });
});

describe("refund rate baseline setting", () => {
  it("round-trips through insert then update", async () => {
    await setRefundRateBaseline(8, "admin@example.test");
    let status = await getRefundRateBaseline();
    expect(status.baselinePercent).toBe(8);
    expect(status.updatedBy).toBe("admin@example.test");

    await setRefundRateBaseline(5.5, "admin2@example.test");
    status = await getRefundRateBaseline();
    expect(status.baselinePercent).toBe(5.5);
    expect(status.updatedBy).toBe("admin2@example.test");
  });
});

describe("getPartneredMemberIds (placeholder pending partner-assignment task)", () => {
  it("returns an empty cohort today, by design", async () => {
    expect(await getPartneredMemberIds()).toEqual([]);
  });

  it("getPartneredCohortMonthlyTrend degrades gracefully to a null-rate trend end-to-end", async () => {
    const trend = await getPartneredCohortMonthlyTrend(3);
    expect(trend).toHaveLength(3);
    for (const point of trend) {
      expect(point.cohortSize).toBe(0);
      expect(point.ratePercent).toBeNull();
    }
  });
});

describe("computeMonthlyTrendForCohort", () => {
  it("degrades gracefully to an empty (null-rate) trend when the cohort is empty", async () => {
    const trend = await computeMonthlyTrendForCohort([], 3);
    expect(trend).toHaveLength(3);
    for (const point of trend) {
      expect(point.cohortSize).toBe(0);
      expect(point.ratePercent).toBeNull();
    }
  });

  it("computes the distinct-member rate for the current month against a real cohort", async () => {
    const memberA = await insertMember("a");
    const memberB = await insertMember("b");
    const memberC = await insertMember("c");

    const now = new Date();
    // Two events for member A this month (still counts once — distinct members).
    await insertEvent(memberA, "refund", now, "evt-a1");
    await insertEvent(memberA, "chargeback", now, "evt-a2");
    // One event for member B this month.
    await insertEvent(memberB, "refund", now, "evt-b1");
    // Member C has no events -> not counted.

    const trend = await computeMonthlyTrendForCohort([memberA, memberB, memberC], 1);
    expect(trend).toHaveLength(1);
    const point = trend[0];
    expect(point.cohortSize).toBe(3);
    expect(point.membersWithEvent).toBe(2);
    expect(point.refundCount).toBe(2);
    expect(point.chargebackCount).toBe(1);
    expect(point.ratePercent).toBeCloseTo((2 / 3) * 100, 5);
  });

  it("excludes events outside the requested month window", async () => {
    const member = await insertMember("outside-window");

    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 2);
    await insertEvent(member, "refund", lastMonth, "evt-outside");

    const trend = await computeMonthlyTrendForCohort([member], 1);
    expect(trend[0].membersWithEvent).toBe(0);
    expect(trend[0].ratePercent).toBe(0);
  });
});
