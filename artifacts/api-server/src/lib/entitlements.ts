import { db, userProductsTable, productsTable, usersTable } from "@workspace/db";
import { eq, and, or, isNull, gte } from "drizzle-orm";
import { isAdminRole, isCoachRole } from "@workspace/auth";

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

export function getHighestProductLabel(entitlements: Set<string>): { name: string; slug: string } {
  if (entitlements.has("access:lifetime")) return { name: "Lifetime Mentorship", slug: "lifetime" };
  if (entitlements.has("commissions:premium")) return { name: "1-Year Mentorship", slug: "1year" };
  if (entitlements.has("coaching:mastermind")) return { name: "6-Month Mentorship", slug: "6month" };
  if (entitlements.has("coaching:group")) return { name: "3-Month Mentorship", slug: "3month" };
  if (entitlements.has("content:advanced")) return { name: "LaunchPad", slug: "launchpad" };
  if (entitlements.has("content:frontend")) return { name: "Front-End Member", slug: "frontend" };
  return { name: "Free", slug: "free" };
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
