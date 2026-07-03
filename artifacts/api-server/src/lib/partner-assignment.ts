import { db, partnersTable, partnerAssignmentsTable, productsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { PRODUCT_RANK } from "./product-rank";
import { getFreeSlots, type FreeSlot } from "./ghl-coaching-calendar";
import { filterSlotsByDailyCap } from "./partner-call-capacity";
import { evaluateAssignmentDelay } from "./partner-escalation-alerter";

// Minimum product rank (see product-rank.ts) that qualifies a member for an
// accountability partner. Rank 2 is "3month" — so any 3-Month+ tier
// (3-month, 6-month, 1-year, lifetime) qualifies, including members who buy
// 6-month (or above) directly and never hold a 3-month grant at all.
export const PARTNER_ELIGIBLE_MIN_RANK = 2;

export function isPartnerEligibleRank(rank: number | undefined): boolean {
  return typeof rank === "number" && rank >= PARTNER_ELIGIBLE_MIN_RANK;
}

async function getProductRank(productId: number): Promise<number | undefined> {
  const [product] = await db
    .select({ slug: productsTable.slug })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!product) return undefined;
  return PRODUCT_RANK[product.slug];
}

export async function getActiveAssignment(
  memberId: number,
): Promise<{ id: number; partnerId: number } | null> {
  const [row] = await db
    .select({ id: partnerAssignmentsTable.id, partnerId: partnerAssignmentsTable.partnerId })
    .from(partnerAssignmentsTable)
    .where(
      and(
        eq(partnerAssignmentsTable.memberId, memberId),
        eq(partnerAssignmentsTable.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

// Soonest-first assignment window/budget. The probe looks at the next 7 days
// of GHL free-slots per active partner and must never block a purchase — a
// ~3s wall-clock budget bounds the whole fan-out, after which we fall back
// to the existing fewest-active selection regardless of what the GHL calls
// eventually return.
const SOONEST_PROBE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// If NO active partner has any surviving slot within the primary 7-day
// window, we can't yet tell who is "soonest" — a 7-day-bounded GHL query
// simply won't return anything past its own end date. Widen to this
// horizon (still inside the same overall probe budget) so we can identify
// the true earliest slot to both assign against and attach to the >7-day
// capacity alert.
const EXTENDED_PROBE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const SOONEST_PROBE_BUDGET_MS_DEFAULT = 3000;
let soonestProbeBudgetMsOverride: number | null = null;

/** Test-only: shrink the probe budget so timeout tests don't take 3s. */
export function __setSoonestProbeBudgetMsForTests(ms: number | null): void {
  soonestProbeBudgetMsOverride = ms;
}
function getSoonestProbeBudgetMs(): number {
  return soonestProbeBudgetMsOverride ?? SOONEST_PROBE_BUDGET_MS_DEFAULT;
}

type FreeSlotsFn = (
  calendarId: string,
  startMs: number,
  endMs: number,
  locationId?: string,
) => Promise<FreeSlot[]>;

let freeSlotsOverride: FreeSlotsFn | null = null;

/** Test-only: replace the GHL free-slots lookup with a deterministic stub. */
export function __setPartnerAssignmentFreeSlotsFnForTests(fn: FreeSlotsFn | null): void {
  freeSlotsOverride = fn;
}

interface FewestActiveCandidate {
  id: number;
  activeCount: number;
  lastAssignedAt: string | null;
}

async function loadFewestActiveCandidates(): Promise<FewestActiveCandidate[]> {
  return db
    .select({
      id: partnersTable.id,
      activeCount: sql<number>`count(${partnerAssignmentsTable.id}) filter (where ${partnerAssignmentsTable.status} = 'active')`,
      lastAssignedAt: sql<string | null>`max(${partnerAssignmentsTable.assignedAt})`,
    })
    .from(partnersTable)
    .leftJoin(partnerAssignmentsTable, eq(partnerAssignmentsTable.partnerId, partnersTable.id))
    .where(eq(partnersTable.isActive, true))
    .groupBy(partnersTable.id)
    .orderBy(
      sql`count(${partnerAssignmentsTable.id}) filter (where ${partnerAssignmentsTable.status} = 'active') asc`,
      sql`max(${partnerAssignmentsTable.assignedAt}) asc nulls first`,
      partnersTable.id,
    );
}

interface SoonestProbeCandidate {
  id: number;
  maxDailyCalls: number;
  ghlCalendarId: string | null;
  ghlLocationId: string;
  activeCount: number;
}

async function loadSoonestProbeCandidates(): Promise<SoonestProbeCandidate[]> {
  const rows = await db
    .select({
      id: partnersTable.id,
      maxDailyCalls: partnersTable.maxDailyCalls,
      ghlCalendarId: partnersTable.ghlCalendarId,
      ghlLocationId: partnersTable.ghlLocationId,
      activeCount: sql<number>`count(${partnerAssignmentsTable.id}) filter (where ${partnerAssignmentsTable.status} = 'active')`,
    })
    .from(partnersTable)
    .leftJoin(partnerAssignmentsTable, eq(partnerAssignmentsTable.partnerId, partnersTable.id))
    .where(eq(partnersTable.isActive, true))
    .groupBy(partnersTable.id);
  return rows;
}

interface SoonestResult {
  partnerId: number;
  earliestSlotMs: number;
  activeCount: number;
}

interface ProbeOutcome {
  soonestOverall: Date | null;
  chosen: SoonestResult | null;
  // True only when the probe ran every partner's GHL call to completion
  // within budget with no errors — i.e. the data is trustworthy enough to
  // drive the >7-day capacity alert. False on timeout, any partner error, or
  // no calendar-configured candidates at all (mirrors evaluateFleetCapacity's
  // "incomplete data, skip fire/clear this cycle" guard).
  reliable: boolean;
}

type FanOutRace =
  | { type: "completed"; results: PromiseSettledResult<SoonestResult | null>[] }
  | { type: "timeout" };

/**
 * Fans out a single free-slots window probe across every calendar-configured
 * partner, racing the whole fan-out against `deadlineMs` (a fixed wall-clock
 * timestamp shared across an entire `probeSoonestPartner` call, so a widened
 * second window can never exceed the overall ~3s budget).
 */
async function runSoonestFanOut(
  withCalendar: (SoonestProbeCandidate & { ghlCalendarId: string })[],
  now: number,
  windowEnd: number,
  deadlineMs: number,
): Promise<FanOutRace> {
  const freeSlotsFn = freeSlotsOverride ?? getFreeSlots;
  const perPartner = withCalendar.map(async (partner): Promise<SoonestResult | null> => {
    const slots = await freeSlotsFn(partner.ghlCalendarId, now, windowEnd, partner.ghlLocationId);
    const usable = await filterSlotsByDailyCap(partner.id, partner.maxDailyCalls, slots, now, windowEnd);
    if (usable.length === 0) return null;
    const earliestSlotMs = Math.min(...usable.map((s) => new Date(s.startTime).getTime()));
    return { partnerId: partner.id, earliestSlotMs, activeCount: partner.activeCount };
  });

  const remainingMs = Math.max(0, deadlineMs - Date.now());
  return Promise.race<FanOutRace>([
    Promise.allSettled(perPartner).then((results) => ({ type: "completed" as const, results })),
    new Promise((resolve) => {
      setTimeout(() => resolve({ type: "timeout" as const }), remainingMs);
    }),
  ]);
}

/** Splits a fan-out's settled results into successes and a failure flag. */
function collectFanOutResults(
  results: PromiseSettledResult<SoonestResult | null>[],
): { found: SoonestResult[]; hadFailure: boolean } {
  const found: SoonestResult[] = [];
  let hadFailure = false;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) found.push(r.value);
    if (r.status === "rejected") {
      hadFailure = true;
      console.error("[PartnerAssignment] Soonest-slot probe failed for one partner:", r.reason);
    }
  }
  return { found, hadFailure };
}

/** Earliest-day-wins, tie-broken by fewest active assignments then lowest id. */
function pickSoonest(found: SoonestResult[]): SoonestResult {
  const sorted = [...found].sort((a, b) => {
    const dayA = Math.floor(a.earliestSlotMs / DAY_MS);
    const dayB = Math.floor(b.earliestSlotMs / DAY_MS);
    if (dayA !== dayB) return dayA - dayB;
    if (a.activeCount !== b.activeCount) return a.activeCount - b.activeCount;
    return a.partnerId - b.partnerId;
  });
  return sorted[0]!;
}

/**
 * Probes every active, calendar-configured partner's free slots (respecting
 * the daily cap via the shared partner-call-capacity lib) and returns the
 * partner with the earliest bookable slot, tie-broken by fewest active
 * assignments (then lowest id) for any partners whose earliest slot falls on
 * the same day.
 *
 * Runs a primary 7-day-window probe first. If NOBODY has a surviving slot
 * within that window, a 7-day-bounded GHL query can't tell us who is
 * actually soonest past day 7 — so it widens to `EXTENDED_PROBE_WINDOW_MS`
 * (same shared deadline) to find the true earliest slot, which both drives
 * the assignment and supplies the real date for the >7-day capacity alert.
 *
 * If ANY partner's probe rejects (GHL error) at either stage, the whole
 * result is discarded (`chosen: null`) rather than picking among only the
 * partners that happened to succeed — a partial result can't be trusted to
 * reflect the true earliest slot.
 */
async function probeSoonestPartner(
  candidates: SoonestProbeCandidate[],
  now: number,
): Promise<ProbeOutcome> {
  const withCalendar = candidates.filter(
    (c): c is SoonestProbeCandidate & { ghlCalendarId: string } => !!c.ghlCalendarId,
  );
  if (withCalendar.length === 0) {
    return { soonestOverall: null, chosen: null, reliable: false };
  }

  const deadlineMs = Date.now() + getSoonestProbeBudgetMs();

  const primaryRaced = await runSoonestFanOut(withCalendar, now, now + SOONEST_PROBE_WINDOW_MS, deadlineMs);
  if (primaryRaced.type === "timeout") {
    console.error("[PartnerAssignment] Soonest-slot probe timed out; falling back to fewest-active");
    return { soonestOverall: null, chosen: null, reliable: false };
  }
  const primary = collectFanOutResults(primaryRaced.results);
  if (primary.hadFailure) {
    // Any single partner probe failing (GHL error/rejection) makes the whole
    // soonest-first result untrustworthy: we can't tell whether the failed
    // partner would actually have had the earliest slot. Rather than
    // silently choosing among only the partners that happened to succeed,
    // discard the probe entirely and let the caller fall back.
    return { soonestOverall: null, chosen: null, reliable: false };
  }

  let found = primary.found;
  if (found.length === 0) {
    if (Date.now() >= deadlineMs) {
      console.error(
        "[PartnerAssignment] No budget left for extended soonest probe; falling back to fewest-active",
      );
      return { soonestOverall: null, chosen: null, reliable: false };
    }
    const extendedRaced = await runSoonestFanOut(
      withCalendar,
      now,
      now + EXTENDED_PROBE_WINDOW_MS,
      deadlineMs,
    );
    if (extendedRaced.type === "timeout") {
      console.error(
        "[PartnerAssignment] Extended soonest-slot probe timed out; falling back to fewest-active",
      );
      return { soonestOverall: null, chosen: null, reliable: false };
    }
    const extended = collectFanOutResults(extendedRaced.results);
    if (extended.hadFailure) {
      return { soonestOverall: null, chosen: null, reliable: false };
    }
    found = extended.found;
  }

  if (found.length === 0) {
    // Nobody has ANY surviving slot even within the extended window —
    // nothing meaningful to assign against or alert with; fall back.
    return { soonestOverall: null, chosen: null, reliable: true };
  }

  const chosen = pickSoonest(found);
  return { soonestOverall: new Date(chosen.earliestSlotMs), chosen, reliable: true };
}

/**
 * Assign an accountability partner to a member.
 *
 * Task #1654 selection order:
 *  1. Soonest-first: probe every active, calendar-configured partner's next
 *     7 days of free slots (day-cap-aware) and pick whoever has the EARLIEST
 *     bookable slot, tie-broken by fewest active assignments then lowest id.
 *     Recorded as `assignmentMethod: "soonest"`.
 *  2. Fallback (fewest-active round robin, `assignmentMethod:
 *     "fallback_fewest_active"`) — used whenever the soonest-first probe
 *     can't produce a confident answer: any active partner missing a
 *     calendar, a GHL error/timeout on any probe, or the ~3s probe budget
 *     being exceeded. This never blocks a purchase on GHL being slow.
 *
 * When the soonest-first probe DOES complete successfully, its findings also
 * drive the fleet capacity alert (`evaluateAssignmentDelay`): if even the
 * best partner's earliest slot is more than 7 days out, on-call is paged.
 * That evaluation is skipped on timeout/error, mirroring
 * evaluateFleetCapacity's "incomplete data" guard — we don't want a GHL
 * outage to look identical to a genuine capacity crunch.
 *
 * Idempotent: if the member already holds an active assignment it is
 * returned as-is (no-op). A concurrent double-call is resolved by the
 * partial unique index on (member_id) WHERE status='active' — a 23505 here
 * is treated as "someone else already assigned this member" and we return
 * whichever assignment won the race, mirroring the pattern in
 * insertUserProductGrant.
 */
export async function assignRoundRobin(
  memberId: number,
): Promise<{ assigned: boolean; partnerId: number | null }> {
  const existing = await getActiveAssignment(memberId);
  if (existing) {
    return { assigned: false, partnerId: existing.partnerId };
  }

  // The GHL probe runs OUTSIDE any DB transaction — it's a slow, best-effort
  // network call, and the actual insert below is the only step that needs
  // transactional/race guarantees (via the partial unique index).
  const probeCandidates = await loadSoonestProbeCandidates();
  const now = Date.now();
  let assignmentMethod: "soonest" | "fallback_fewest_active" = "fallback_fewest_active";
  let targetPartnerId: number | null = null;

  if (probeCandidates.length > 0) {
    const { soonestOverall, chosen, reliable } = await probeSoonestPartner(probeCandidates, now);
    if (chosen) {
      targetPartnerId = chosen.partnerId;
      assignmentMethod = "soonest";
    }
    // Only evaluate the delay alert off a probe that ran to completion with
    // no per-partner errors — a GHL outage/timeout must never masquerade as
    // a genuine capacity crunch.
    if (reliable) {
      try {
        await evaluateAssignmentDelay(soonestOverall, now);
      } catch (err) {
        console.error("[PartnerAssignment] Failed to evaluate assignment-delay alert:", err);
      }
    }
  }

  if (targetPartnerId === null) {
    const candidates = await loadFewestActiveCandidates();
    const chosen = candidates[0];
    if (!chosen) {
      console.error(
        `[PartnerAssignment] No active partners available to assign member ${memberId}`,
      );
      return { assigned: false, partnerId: null };
    }
    targetPartnerId = chosen.id;
    assignmentMethod = "fallback_fewest_active";
  }

  try {
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId, partnerId: targetPartnerId, status: "active", assignmentMethod });
    return { assigned: true, partnerId: targetPartnerId };
  } catch (err: unknown) {
    const e = err as { code?: string; cause?: { code?: string } };
    if (e.code === "23505" || e.cause?.code === "23505") {
      const race = await getActiveAssignment(memberId);
      return { assigned: false, partnerId: race?.partnerId ?? null };
    }
    throw err;
  }
}

/**
 * Called after any successful product grant. Looks up the granted product's
 * rank and triggers round-robin assignment if it's 3-Month+ (rank >= 2).
 * Never throws — a partner-assignment failure must never block a purchase
 * from completing, mirroring the non-fatal try/catch pattern used for
 * ensureAffiliateProfile elsewhere in the grant path.
 */
export async function maybeAssignPartnerForGrant(
  userId: number,
  productId: number,
): Promise<void> {
  try {
    const rank = await getProductRank(productId);
    if (!isPartnerEligibleRank(rank)) return;
    await assignRoundRobin(userId);
  } catch (err) {
    console.error(
      `[PartnerAssignment] Failed to auto-assign partner for user ${userId} product ${productId}:`,
      err,
    );
  }
}

/**
 * Ends a member's current active assignment, if any. Used both by term-expiry
 * cleanup (status "ended") and as the first half of an admin reassignment
 * (status "reassigned").
 */
export async function endActiveAssignment(
  memberId: number,
  reason: string,
  status: "ended" | "reassigned" = "ended",
): Promise<boolean> {
  const updated = await db
    .update(partnerAssignmentsTable)
    .set({ status, endedAt: new Date(), endedReason: reason })
    .where(
      and(
        eq(partnerAssignmentsTable.memberId, memberId),
        eq(partnerAssignmentsTable.status, "active"),
      ),
    )
    .returning({ id: partnerAssignmentsTable.id });
  return updated.length > 0;
}

/**
 * Admin-initiated reassignment (gated on `partners:manage`). Ends the
 * member's current active assignment (if any) and either assigns a specific
 * partner or re-runs round robin. Wrapped in a transaction so the end + the
 * new insert are atomic against the partial-unique-active-row invariant.
 *
 * The replacement partner is selected BEFORE the current active row is
 * touched: if round-robin mode can't find any active partner, the whole
 * transaction is rolled back and the member's existing assignment (if any)
 * is left untouched rather than being ended with no replacement.
 */
export async function reassignMember(
  memberId: number,
  opts: { partnerId?: number; reason: string },
): Promise<{ partnerId: number | null }> {
  return db.transaction(async (tx) => {
    let targetPartnerId: number;

    if (opts.partnerId) {
      targetPartnerId = opts.partnerId;
    } else {
      // Round-robin selection re-implemented against `tx` so it runs inside
      // the same transaction as the end+insert below (assignRoundRobin uses
      // `db`, not `tx`, and would otherwise race against this transaction).
      const candidates = await tx
        .select({
          id: partnersTable.id,
          activeCount: sql<number>`count(${partnerAssignmentsTable.id}) filter (where ${partnerAssignmentsTable.status} = 'active')`,
          lastAssignedAt: sql<string | null>`max(${partnerAssignmentsTable.assignedAt})`,
        })
        .from(partnersTable)
        .leftJoin(partnerAssignmentsTable, eq(partnerAssignmentsTable.partnerId, partnersTable.id))
        .where(eq(partnersTable.isActive, true))
        .groupBy(partnersTable.id)
        .orderBy(
          sql`count(${partnerAssignmentsTable.id}) filter (where ${partnerAssignmentsTable.status} = 'active') asc`,
          sql`max(${partnerAssignmentsTable.assignedAt}) asc nulls first`,
          partnersTable.id,
        );

      const chosen = candidates[0];
      if (!chosen) {
        console.error(
          `[PartnerAssignment] No active partners available to reassign member ${memberId}`,
        );
        // No candidate found: leave the member's existing assignment (if
        // any) untouched rather than ending it with nothing to replace it.
        return { partnerId: null };
      }
      targetPartnerId = chosen.id;
    }

    await tx
      .update(partnerAssignmentsTable)
      .set({ status: "reassigned", endedAt: new Date(), endedReason: opts.reason })
      .where(
        and(
          eq(partnerAssignmentsTable.memberId, memberId),
          eq(partnerAssignmentsTable.status, "active"),
        ),
      );

    await tx
      .insert(partnerAssignmentsTable)
      .values({ memberId, partnerId: targetPartnerId, status: "active" });
    return { partnerId: targetPartnerId };
  });
}
