import { db } from "@workspace/db";
import { productsTable, insertProductSchema } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

// VIP status product (Task #1660). A PURE status product, never sold
// standalone — an admin grants `vip` + `1year` together in one sitting via
// the member detail Products tab (a later `lifetime` grant is a separate
// upsell). Its two expiry clocks run fully independently: vip's 730-day
// term is never extended or shortened by the 1year term, and vice versa.
//
// `vip:status` is its ONLY entitlement key — the content-access matrix's
// `vip` column checkboxes are the sole mechanism by which any page would
// ever be gated VIP-specific (none are, by default). No checkout/ThriveCart
// path exists for this product; thrivecartProductId and checkoutUrl are null.
//
// This was historically only created by the dev-only seedDatabase() in
// src/seed.ts and so is never present in production without this boot
// seeder. Idempotent: insert-if-missing on slug.
const VIP_PRODUCT = {
  slug: "vip",
  name: "VIP",
  type: "backend",
  thrivecartProductId: null,
  entitlementKeys: ["vip:status"],
  durationDays: 730,
  priceDisplay: null,
  sortOrder: 14,
};

export async function seedVipProduct(): Promise<void> {
  const [existing] = await db
    .select({ slug: productsTable.slug })
    .from(productsTable)
    .where(eq(productsTable.slug, VIP_PRODUCT.slug))
    .limit(1);

  if (existing) {
    console.log("[Seed] VIP product already seeded, skipping");
    return;
  }

  await db.insert(productsTable).values(insertProductSchema.parse(VIP_PRODUCT));
  console.log("[Seed] Inserted VIP product");
}
