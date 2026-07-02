import { db, partnersTable, partnerAssignmentsTable, productsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { PRODUCT_RANK } from "./product-rank";

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

/**
 * Assign the least-loaded active partner to a member via round robin.
 *
 * Selection: the active partner with the fewest current active assignments,
 * tie-broken by whoever was least-recently assigned (oldest `assignedAt`
 * first) so a freshly-added partner isn't starved once counts even out.
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

  const candidates = await db
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
      `[PartnerAssignment] No active partners available to assign member ${memberId}`,
    );
    return { assigned: false, partnerId: null };
  }

  try {
    await db
      .insert(partnerAssignmentsTable)
      .values({ memberId, partnerId: chosen.id, status: "active" });
    return { assigned: true, partnerId: chosen.id };
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
