import { db, userProductsTable, productsTable, usersTable } from "@workspace/db";
import { eq, and, or, isNull, gte, asc } from "drizzle-orm";
import { isAdminRole, isCoachRole } from "@workspace/auth";

/**
 * Resolve a member's brand from their active front-end product grants.
 *
 * Front-end products (`products.type === "frontend"`) carry the brand identity
 * (e.g. "backroad", "yse_front_end", "reserve_income"). If a user holds several
 * front-end grants we pick the earliest one (entry offer). If they hold none,
 * we fall back to the platform default "bts".
 *
 * Active/non-expired filtering mirrors getUserEntitlements so the two stay in
 * lockstep. Does NOT grant any access — sourceProduct is a branding signal only.
 */
export async function resolveMemberBrand(userId: number): Promise<string> {
  const now = new Date();

  const [row] = await db
    .select({ slug: productsTable.slug })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .where(
      and(
        eq(userProductsTable.userId, userId),
        eq(userProductsTable.status, "active"),
        eq(productsTable.type, "frontend"),
        or(
          isNull(userProductsTable.expiresAt),
          gte(userProductsTable.expiresAt, now),
        ),
      ),
    )
    .orderBy(asc(userProductsTable.createdAt))
    .limit(1);

  return row?.slug ?? "bts";
}

export async function getUserEntitlements(userId: number): Promise<Set<string>> {
  const now = new Date();

  const userProducts = await db
    .select({
      status: userProductsTable.status,
      expiresAt: userProductsTable.expiresAt,
      entitlementKeys: productsTable.entitlementKeys,
    })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .where(
      and(
        eq(userProductsTable.userId, userId),
        eq(userProductsTable.status, "active"),
        or(
          isNull(userProductsTable.expiresAt),
          gte(userProductsTable.expiresAt, now)
        )
      )
    );

  const entitlements = new Set<string>();
  for (const up of userProducts) {
    const keys = up.entitlementKeys as string[];
    if (Array.isArray(keys)) {
      for (const key of keys) {
        entitlements.add(key);
      }
    }
  }

  return entitlements;
}

export async function hasEntitlement(userId: number, key: string): Promise<boolean> {
  const entitlements = await getUserEntitlements(userId);
  return entitlements.has(key);
}

/**
 * Coaches and admins get full access to member features regardless of which
 * products they own. Entitlements are strictly product-derived (see
 * getUserEntitlements), so this role-based bypass is enforced separately at each
 * member-feature gate — mirroring the frontend (Sidebar + EntitlementRoute),
 * which grants the same bypass via `isAdminUser || isCoach`.
 *
 * Never fold this into getUserEntitlements: tier/label/commission math must stay
 * strictly product-derived (e.g. getHighestProductLabel, commission tiers).
 */
export async function hasMemberAccessBypass(userId: number): Promise<boolean> {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return !!user && (isAdminRole(user.role) || isCoachRole(user.role));
}

export async function getUserProducts(userId: number) {
  const now = new Date();

  return db
    .select({
      id: userProductsTable.id,
      productId: userProductsTable.productId,
      productSlug: productsTable.slug,
      productName: productsTable.name,
      productType: productsTable.type,
      purchasedAt: userProductsTable.purchasedAt,
      expiresAt: userProductsTable.expiresAt,
      status: userProductsTable.status,
      externalOrderId: userProductsTable.externalOrderId,
      externalSource: userProductsTable.externalSource,
    })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .where(eq(userProductsTable.userId, userId))
    .orderBy(productsTable.sortOrder);
}

/**
 * Canonical rank → human label map. Rank values mirror PRODUCT_RANK from
 * product-rank.ts. -1 is the sentinel for "no active products" (Free).
 * Both getHighestProductLabel and getProductLabelByRank reference this map so
 * the label strings can never diverge between the two code paths.
 */
export const RANK_LABEL_MAP: Record<number, string> = {
  [-1]: "Free",
  [0]: "Front-End Member",
  [1]: "LaunchPad",
  [2]: "3-Month Mentorship",
  [3]: "6-Month Mentorship",
  [4]: "1-Year Mentorship",
  [5]: "Lifetime Mentorship",
};

/**
 * Return a human-friendly tier label for a pre-computed product rank value.
 * rank = -1 means the member holds no active products ("Free").
 * rank = 0 means front-end only ("Front-End Member").
 * Ranks 1-5 correspond to paid tiers per PRODUCT_RANK in product-rank.ts.
 * Any rank not in the map falls back to "Free".
 */
export function getProductLabelByRank(rank: number): string {
  return RANK_LABEL_MAP[rank] ?? "Free";
}

export function getHighestProductLabel(entitlements: Set<string>): { name: string; slug: string } {
  if (entitlements.has("access:lifetime")) return { name: RANK_LABEL_MAP[5], slug: "lifetime" };
  if (entitlements.has("commissions:premium")) return { name: RANK_LABEL_MAP[4], slug: "1year" };
  if (entitlements.has("coaching:mastermind")) return { name: RANK_LABEL_MAP[3], slug: "6month" };
  if (entitlements.has("coaching:group")) return { name: RANK_LABEL_MAP[2], slug: "3month" };
  if (entitlements.has("content:advanced")) return { name: RANK_LABEL_MAP[1], slug: "launchpad" };
  if (entitlements.has("content:frontend")) return { name: RANK_LABEL_MAP[0], slug: "frontend" };
  return { name: RANK_LABEL_MAP[-1], slug: "free" };
}

export function getSupportTicketLimit(entitlements: Set<string>): number {
  if (entitlements.has("support:vip") || entitlements.has("support:unlimited")) return -1;
  if (entitlements.has("support:enhanced")) return 10;
  if (entitlements.has("support:standard")) return 5;
  if (entitlements.has("support:basic")) return 3;
  return 0;
}

export function getEntitlementsList(entitlements: Set<string>): string[] {
  return Array.from(entitlements).sort();
}

export async function getEditWindowMinutes(userId: number): Promise<number> {
  const entitlements = await getUserEntitlements(userId);
  if (entitlements.has("access:lifetime") || entitlements.has("commissions:premium")) {
    return 30;
  }
  return 15;
}

export function getTierBadgeColor(slug: string): string {
  switch (slug) {
    case "3month": return "blue";
    case "6month": return "orange";
    case "1year": return "purple";
    case "lifetime": return "gold";
    default: return "gray";
  }
}
