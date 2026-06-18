/**
 * Idempotent script: add "voice:access" to all product entitlementKeys that don't yet have it.
 * Safe to run multiple times — skips products that already include the key.
 *
 * Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/add-voice-entitlement.ts
 */
import { db, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function main() {
  const products = await db
    .select({ id: productsTable.id, slug: productsTable.slug, entitlementKeys: productsTable.entitlementKeys })
    .from(productsTable);

  let updated = 0;
  let skipped = 0;

  for (const product of products) {
    const keys: string[] = Array.isArray(product.entitlementKeys) ? (product.entitlementKeys as string[]) : [];
    if (keys.includes("voice:access")) {
      skipped++;
      continue;
    }

    await db
      .update(productsTable)
      .set({ entitlementKeys: [...keys, "voice:access"] })
      .where(eq(productsTable.id, product.id));

    console.log(`  + Added voice:access to ${product.slug}`);
    updated++;
  }

  console.log(`Done. Updated: ${updated}, Already had it: ${skipped}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
