import { db, usersTable, userProductsTable, productsTable, systemSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { PRODUCT_RANK } from "./product-rank";

// Task #1643 (TB2): one-time, idempotent grandfather backfill.
//
// Every existing member stays exactly where they are — the tiered
// onboarding flow (Task #1640, TA1) only applies to people entering or
// ascending after it shipped. This backfill force-completes onboarding for
// every member that already existed when it runs, and permanently stamps
// them `grandfathered = true` so they are forever distinguishable from an
// organic completion (a real kickoff + partner call).
//
// Cutoff is deliberately NOT a hardcoded date. The claim marker below is
// inserted exactly once (same pattern as the onboarding step-contract
// migrations in onboarding-advancement.ts); the UPDATE inside that same
// claim runs against "every member that exists right now" — i.e. the
// cutoff IS the moment the marker is claimed. Any member created after that
// moment is never touched by this function again (the marker blocks a
// second run), so TA1's creation-time defaults are the only thing that ever
// governs a post-ship signup. This also means there is nothing to hardcode:
// the dev DB drifts continuously with test activity and prod is a
// completely different dataset, so a fixed expected count would be wrong on
// arrival.
const MARKER_KEY = "grandfather_backfill_completed_at";

// Report-and-confirm gate (Step 3 of the task): boot only ever EXECUTES the
// backfill when an admin has explicitly armed it via the generic
// `PUT /admin/settings/grandfather_backfill_armed` endpoint AFTER reading the
// live pre-flight report this module logs on every boot until the marker
// exists. Never auto-executes on deploy.
export const GRANDFATHER_BACKFILL_ARMED_KEY = "grandfather_backfill_armed";

export type TierBucket = "free_frontend" | "launchpad" | "3month_plus";
export type OnboardingStateBucket = "not_started" | "mid_flight" | "complete";

export interface GrandfatherBucketRow {
  tier: TierBucket;
  state: OnboardingStateBucket;
  count: number;
}

export interface GrandfatherPreflightReport {
  alreadyMigrated: boolean;
  buckets: GrandfatherBucketRow[];
  total: number;
}

function bucketTier(maxRank: number): TierBucket {
  if (maxRank >= 2) return "3month_plus";
  if (maxRank === 1) return "launchpad";
  return "free_frontend";
}

function bucketState(onboardingComplete: boolean, onboardingStep: number): OnboardingStateBucket {
  if (onboardingComplete) return "complete";
  if (onboardingStep <= 1) return "not_started";
  return "mid_flight";
}

async function isAlreadyMigrated(): Promise<boolean> {
  const [existing] = await db
    .select({ id: systemSettingsTable.id })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, MARKER_KEY))
    .limit(1);
  return !!existing;
}

// Computes the live tier x onboarding-state matrix (and total) over every
// currently-ungrandfathered MEMBER (role = 'member' only — admins, coaches,
// and partner staff are never onboarding subjects and must never be touched
// or counted here). This is intentionally the SAME query shape the execute
// path uses to decide who to touch, so what pre-flight reports is exactly
// what execution will do if run at that instant.
async function computeBucketsAndTotal(): Promise<{ buckets: GrandfatherBucketRow[]; total: number }> {
  const candidates = await db
    .select({
      id: usersTable.id,
      onboardingComplete: usersTable.onboardingComplete,
      onboardingStep: usersTable.onboardingStep,
    })
    .from(usersTable)
    .where(sql`${usersTable.grandfathered} = false AND ${usersTable.role} = 'member'`);

  if (candidates.length === 0) {
    return { buckets: [], total: 0 };
  }

  const productRows = await db
    .select({ userId: userProductsTable.userId, slug: productsTable.slug })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .where(
      sql`${userProductsTable.status} = 'active' AND (${userProductsTable.expiresAt} IS NULL OR ${userProductsTable.expiresAt} >= NOW())`,
    );

  const maxRankByUser = new Map<number, number>();
  for (const row of productRows) {
    const rank = PRODUCT_RANK[row.slug] ?? 0;
    const current = maxRankByUser.get(row.userId);
    if (current === undefined || rank > current) {
      maxRankByUser.set(row.userId, rank);
    }
  }

  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const maxRank = maxRankByUser.get(candidate.id) ?? -1;
    const tier = bucketTier(maxRank);
    const state = bucketState(candidate.onboardingComplete, candidate.onboardingStep);
    const key = `${tier}:${state}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const buckets: GrandfatherBucketRow[] = [];
  for (const [key, count] of counts.entries()) {
    const [tier, state] = key.split(":") as [TierBucket, OnboardingStateBucket];
    buckets.push({ tier, state, count });
  }
  buckets.sort((a, b) => (a.tier === b.tier ? a.state.localeCompare(b.state) : a.tier.localeCompare(b.tier)));

  return { buckets, total: candidates.length };
}

// Pre-flight mode: reports the live bucket matrix + total, writes NOTHING.
// Safe to call any number of times, including after the backfill has
// already executed (buckets/total will simply be empty/0 since every
// pre-existing member is grandfathered by then).
export async function getGrandfatherPreflightReport(): Promise<GrandfatherPreflightReport> {
  const alreadyMigrated = await isAlreadyMigrated();
  const { buckets, total } = await computeBucketsAndTotal();
  return { alreadyMigrated, buckets, total };
}

export function formatGrandfatherPreflightReport(report: GrandfatherPreflightReport): string {
  const lines: string[] = [];
  lines.push("[GrandfatherBackfill] Pre-flight report (live counts, nothing written):");
  if (report.alreadyMigrated) {
    lines.push("[GrandfatherBackfill] Marker already present — the backfill has already run and will never run again.");
  }
  if (report.buckets.length === 0) {
    lines.push("[GrandfatherBackfill]   (no ungrandfathered members found)");
  } else {
    for (const bucket of report.buckets) {
      lines.push(`[GrandfatherBackfill]   ${bucket.tier} / ${bucket.state}: ${bucket.count}`);
    }
  }
  lines.push(`[GrandfatherBackfill] TOTAL that would be marked complete + grandfathered: ${report.total}`);
  return lines.join("\n");
}

export interface GrandfatherBackfillResult {
  executed: boolean;
  usersUpdated: number;
  reason?: "already_run" | "confirmation_required";
}

// Executes the backfill. Requires `confirm: true` — this is the "explicit
// confirmation input" the task calls for; callers (the CLI script and the
// armed-gated boot hook) are responsible for only ever passing `confirm:
// true` once a human has actually reviewed the pre-flight report.
//
// The ONLY built-in sanity assertion: throws if the computed total is zero
// (a zero total means the bucket query itself is broken — e.g. pointed at
// an empty table — not that there is genuinely nothing to do, since this
// function is only ever invoked before the marker exists).
export async function runGrandfatherBackfill(
  options: { confirm: boolean },
): Promise<GrandfatherBackfillResult> {
  if (await isAlreadyMigrated()) {
    return { executed: false, usersUpdated: 0, reason: "already_run" };
  }

  const { total } = await computeBucketsAndTotal();
  if (total === 0) {
    throw new Error(
      "[GrandfatherBackfill] Refusing to run: computed total is 0. This means the bucket query is broken " +
        "(e.g. pointed at an empty/wrong database), not that there is nothing to do — investigate before retrying.",
    );
  }

  if (!options.confirm) {
    return { executed: false, usersUpdated: 0, reason: "confirmation_required" };
  }

  const result = await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(systemSettingsTable)
      .values({
        key: MARKER_KEY,
        value: { startedAt: new Date().toISOString() },
        category: "onboarding",
        description:
          "One-time marker for the grandfather backfill (Task #1643, TB2). Presence of this row means every " +
          "member that existed at claim time has been force-completed + stamped grandfathered=true, and this " +
          "must never run again.",
      })
      .onConflictDoNothing()
      .returning({ id: systemSettingsTable.id });

    if (claimed.length === 0) {
      // Raced with a concurrent claim — someone else already ran it.
      return { executed: false, usersUpdated: 0 };
    }

    const updated = await tx
      .update(usersTable)
      .set({ onboardingComplete: true, grandfathered: true })
      .where(sql`${usersTable.grandfathered} = false AND ${usersTable.role} = 'member'`)
      .returning({ id: usersTable.id });

    await tx
      .update(systemSettingsTable)
      .set({
        value: {
          completedAt: new Date().toISOString(),
          usersUpdated: updated.length,
        },
      })
      .where(eq(systemSettingsTable.id, claimed[0].id));

    return { executed: true, usersUpdated: updated.length };
  });

  if (result.executed) {
    console.log(
      `[GrandfatherBackfill] Grandfathered ${result.usersUpdated} pre-existing member(s): onboardingComplete=true, grandfathered=true.`,
    );
  }

  return result;
}

// Armed-gated boot hook (Step 3). Runs on every boot:
//   - if already migrated: no-op, silent.
//   - if not armed: logs the live pre-flight report so it's visible in
//     deploy logs, then STOPS. Nothing is written.
//   - if armed (an admin set `grandfather_backfill_armed` = true via the
//     generic settings endpoint after reading a prior boot's pre-flight
//     report): executes with confirm=true.
// Never auto-executes without the armed flag having been explicitly set by
// a human — this is what lets the repair reach production (the agent
// cannot write prod directly) while still honoring report -> confirm ->
// execute.
export async function runGrandfatherBackfillBootHook(): Promise<void> {
  const report = await getGrandfatherPreflightReport();
  if (report.alreadyMigrated) {
    return;
  }

  const [armedSetting] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, GRANDFATHER_BACKFILL_ARMED_KEY))
    .limit(1);
  const armed = armedSetting?.value === true;

  if (!armed) {
    console.log(formatGrandfatherPreflightReport(report));
    console.log(
      `[GrandfatherBackfill] Not armed — waiting for an admin to PUT /admin/settings/${GRANDFATHER_BACKFILL_ARMED_KEY} ` +
        `{"value": true} after reviewing the counts above, then restart. No writes have occurred.`,
    );
    return;
  }

  console.log(formatGrandfatherPreflightReport(report));
  console.log("[GrandfatherBackfill] Armed — executing now.");
  await runGrandfatherBackfill({ confirm: true });
}
