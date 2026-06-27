/**
 * Idempotent backfill: set users.sourceProduct for every user from their
 * earliest active front-end product grant (products.type = 'frontend').
 * Users with no active front-end grant receive "bts" (platform default).
 *
 * Running this script twice produces identical values the second time and
 * changes no user_products or entitlement rows — only users.sourceProduct.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/backfill-source-product.ts
 */
import { db, usersTable, userProductsTable, productsTable } from "@workspace/db";
import { eq, and, or, isNull, gte, asc, sql } from "drizzle-orm";

async function main() {
  const now = new Date();

  console.log("Fetching all users...");
  const allUsers = await db
    .select({ id: usersTable.id, sourceProduct: usersTable.sourceProduct })
    .from(usersTable);

  console.log(`Total users: ${allUsers.length}`);

  // One bulk query: earliest active front-end grant per user.
  // DISTINCT ON (user_id) ordered by created_at ASC gives the entry offer.
  const rows = await db.execute<{ user_id: number; slug: string }>(sql`
    SELECT DISTINCT ON (up.user_id) up.user_id, p.slug
    FROM user_products up
    JOIN products p ON up.product_id = p.id
    WHERE up.status = 'active'
      AND p.type = 'frontend'
      AND (up.expires_at IS NULL OR up.expires_at >= ${now})
    ORDER BY up.user_id, up.created_at ASC
  `);

  const brandByUser = new Map<number, string>();
  for (const row of rows.rows) {
    brandByUser.set(Number(row.user_id), row.slug);
  }

  let updated = 0;
  let alreadyCorrect = 0;
  let setToBts = 0;

  for (const user of allUsers) {
    const expected = brandByUser.get(user.id) ?? "bts";
    if (user.sourceProduct === expected) {
      alreadyCorrect++;
      continue;
    }

    await db
      .update(usersTable)
      .set({ sourceProduct: expected })
      .where(eq(usersTable.id, user.id));

    const wasBts = expected === "bts";
    if (wasBts) setToBts++;
    updated++;

    console.log(
      `  userId=${user.id}: ${user.sourceProduct ?? "(null)"} → ${expected}`,
    );
  }

  console.log(
    `\nDone. Updated: ${updated} (${setToBts} set to "bts"), already correct: ${alreadyCorrect}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
