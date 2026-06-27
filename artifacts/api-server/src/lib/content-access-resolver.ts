import {
  db,
  contentAccessMapTable,
  userProductsTable,
  productsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, or, isNull, gte } from "drizzle-orm";
import { isAdminRole, isCoachRole } from "@workspace/auth";
import {
  GATEABLE_PAGE_KEYS,
} from "@workspace/content-access-registry";

/**
 * Returns the set of page keys the given user may access.
 *
 * Semantics:
 *   - Admin/coach → all registry pages (bypass).
 *   - No row in content_access_map for a pageKey → page is OPEN (included).
 *   - Row with ≥1 product slug → GATED; included iff the user owns ≥1 product
 *     in that slug list and the grant is active/non-expired.
 *   - With the table empty every member gets every page (launch no-op).
 *
 * Express-free by design so a server-side route guard can call it later.
 */
export async function getAccessiblePageKeys(userId: number): Promise<string[]> {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (user && (isAdminRole(user.role) || isCoachRole(user.role))) {
    return [...GATEABLE_PAGE_KEYS];
  }

  const now = new Date();

  const [mapRows, userProductRows] = await Promise.all([
    db
      .select({
        pageKey: contentAccessMapTable.pageKey,
        productSlugs: contentAccessMapTable.productSlugs,
      })
      .from(contentAccessMapTable),
    db
      .select({ slug: productsTable.slug })
      .from(userProductsTable)
      .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
      .where(
        and(
          eq(userProductsTable.userId, userId),
          eq(userProductsTable.status, "active"),
          or(
            isNull(userProductsTable.expiresAt),
            gte(userProductsTable.expiresAt, now),
          ),
        ),
      ),
  ]);

  const ownedSlugs = new Set(userProductRows.map((r) => r.slug));

  const mapByKey = new Map<string, string[]>();
  for (const row of mapRows) {
    const slugs = row.productSlugs;
    if (Array.isArray(slugs) && slugs.length > 0) {
      mapByKey.set(row.pageKey, slugs);
    }
  }

  return GATEABLE_PAGE_KEYS.filter((pageKey) => {
    const slugs = mapByKey.get(pageKey);
    if (!slugs) {
      return true;
    }
    return slugs.some((s) => ownedSlugs.has(s));
  });
}
