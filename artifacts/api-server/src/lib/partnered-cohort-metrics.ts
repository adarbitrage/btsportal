/**
 * Partnered-cohort refund/chargeback metric.
 *
 * The accountability-partner program's judgment metric is: does having a
 * partner reduce a member's refund/chargeback rate? This module compares the
 * partnered cohort's rate against an Adam-supplied baseline, trended monthly.
 *
 * Partner assignment is a SEPARATE task. Until that lands, `getPartneredMemberIds`
 * returns an empty set and the cohort is simply empty — the trend still
 * renders (all zeros / "no cohort yet") rather than erroring. Once partner
 * assignments exist, only this function needs to change; everything else
 * (baseline storage, monthly aggregation, the route/UI) already works off of
 * whatever member-id set it returns.
 */

import { db, systemSettingsTable, memberRefundEventsTable } from "@workspace/db";
import { eq, and, gte, lt, inArray } from "drizzle-orm";

const BASELINE_KEY = "partnered_cohort.refund_rate_baseline_percent";
const CATEGORY = "billing";

export interface BaselineStatus {
  baselinePercent: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Adam-supplied baseline refund/chargeback rate, as a percent (0-100). */
export async function getRefundRateBaseline(): Promise<BaselineStatus> {
  const [row] = await db
    .select({
      value: systemSettingsTable.value,
      updatedBy: systemSettingsTable.updatedBy,
      updatedAt: systemSettingsTable.updatedAt,
    })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, BASELINE_KEY))
    .limit(1);

  if (!row) return { baselinePercent: null, updatedBy: null, updatedAt: null };

  const raw = row.value as { baselinePercent?: number } | number | null;
  const baselinePercent =
    typeof raw === "number" ? raw : typeof raw === "object" && raw !== null ? raw.baselinePercent ?? null : null;

  return {
    baselinePercent: typeof baselinePercent === "number" ? baselinePercent : null,
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export function validateBaselinePercent(input: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return { ok: false, error: "baselinePercent must be a finite number" };
  }
  if (input < 0 || input > 100) {
    return { ok: false, error: "baselinePercent must be between 0 and 100" };
  }
  return { ok: true, value: input };
}

export async function setRefundRateBaseline(baselinePercent: number, updatedBy: string | null): Promise<void> {
  const value = { baselinePercent };
  const existing = await db
    .select({ id: systemSettingsTable.id })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, BASELINE_KEY))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(systemSettingsTable)
      .set({ value, updatedBy: updatedBy ?? undefined })
      .where(eq(systemSettingsTable.key, BASELINE_KEY));
  } else {
    await db.insert(systemSettingsTable).values({
      key: BASELINE_KEY,
      value,
      category: CATEGORY,
      description: "Adam-supplied baseline refund/chargeback rate (%) for the partnered-cohort accountability metric.",
      updatedBy: updatedBy ?? undefined,
    });
  }
}

/**
 * Members currently assigned an accountability partner. Placeholder until
 * the partner-assignment task lands — returns an empty set so every caller
 * degrades gracefully (empty cohort, not an error).
 */
export async function getPartneredMemberIds(): Promise<number[]> {
  return [];
}

export interface MonthlyRatePoint {
  month: string; // "YYYY-MM"
  cohortSize: number;
  membersWithEvent: number;
  refundCount: number;
  chargebackCount: number;
  ratePercent: number | null; // null when cohortSize === 0 (no data, not "0%")
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthStart(year: number, monthIndex0: number): Date {
  return new Date(Date.UTC(year, monthIndex0, 1, 0, 0, 0, 0));
}

/**
 * Monthly trend of the partnered cohort's refund/chargeback rate vs. the
 * cohort size, for the last `months` calendar months (most recent last).
 *
 * Rate definition: percent of the partnered cohort with at least one
 * matched refund/chargeback event in that month. Using distinct-members
 * (rather than raw event count) keeps the metric comparable to "baseline
 * refund rate" framing, which is naturally a per-member rate.
 */
export async function getPartneredCohortMonthlyTrend(months: number): Promise<MonthlyRatePoint[]> {
  const cohortIds = await getPartneredMemberIds();
  return computeMonthlyTrendForCohort(cohortIds, months);
}

/**
 * Pure(-ish) computation split out from `getPartneredCohortMonthlyTrend` so
 * it can be exercised directly in tests with an explicit cohort, without
 * needing to mock `getPartneredMemberIds` (which is a trivial placeholder
 * today, but the aggregation math is the part worth testing thoroughly).
 */
export async function computeMonthlyTrendForCohort(cohortIds: number[], months: number): Promise<MonthlyRatePoint[]> {
  const now = new Date();
  const points: MonthlyRatePoint[] = [];

  // Build the list of month boundaries first so the loop is simple and the
  // "no cohort" case still returns a fully-shaped trend (all nulls) instead
  // of an empty array — the UI can render axis labels either way.
  const boundaries: { start: Date; end: Date; month: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = monthStart(now.getUTCFullYear(), now.getUTCMonth() - i);
    const end = monthStart(now.getUTCFullYear(), now.getUTCMonth() - i + 1);
    boundaries.push({ start, end, month: monthKey(start) });
  }

  if (cohortIds.length === 0) {
    return boundaries.map((b) => ({
      month: b.month,
      cohortSize: 0,
      membersWithEvent: 0,
      refundCount: 0,
      chargebackCount: 0,
      ratePercent: null,
    }));
  }

  for (const { start, end, month } of boundaries) {
    const rows = await db
      .select({
        memberId: memberRefundEventsTable.memberId,
        type: memberRefundEventsTable.type,
      })
      .from(memberRefundEventsTable)
      .where(
        and(
          eq(memberRefundEventsTable.matched, true),
          inArray(memberRefundEventsTable.memberId, cohortIds),
          gte(memberRefundEventsTable.occurredAt, start),
          lt(memberRefundEventsTable.occurredAt, end),
        ),
      );

    const membersWithEvent = new Set<number>();
    let refundCount = 0;
    let chargebackCount = 0;
    for (const row of rows) {
      if (row.memberId !== null) membersWithEvent.add(row.memberId);
      if (row.type === "refund") refundCount++;
      else if (row.type === "chargeback") chargebackCount++;
    }

    points.push({
      month,
      cohortSize: cohortIds.length,
      membersWithEvent: membersWithEvent.size,
      refundCount,
      chargebackCount,
      ratePercent: (membersWithEvent.size / cohortIds.length) * 100,
    });
  }

  return points;
}
