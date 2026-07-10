import { db } from "@workspace/db";
import { productsTable, insertProductSchema } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

// VIP Arbitrage product (Task #1854). A cross-system Machine-side program
// (Reg D 506(c) securities offering — the managed media-buying investment)
// whose Portal product row exists for exactly one reason: recording who has
// actually purchased it, so `isVipArbitrageMember` (pitch-resolver.ts) can
// suppress the VIP Arbitrage email pitch for members who already hold it.
//
// It deliberately carries NO entitlement keys — holding VIP Arbitrage grants
// no portal content, coaching, or support tier (memberships/entitlements stay
// product-derived and this product derives nothing). It also has NO rank in
// PRODUCT_RANK (resolves to rank 0), so it never affects tier resolution,
// mentorship eligibility, or partner-assignment rank checks.
//
// Grants arrive via:
//   - POST /api/integrations/machine-purchase / grant-product with the
//     `vip_arbitrage` product key (seeded mapping row in
//     machine-product-key-mappings.ts), or
//   - a manual admin grant from the member detail Products tab.
//
// durationDays is null: an investment holding does not expire on a clock.
// No checkout path exists (thrivecartProductId/checkoutUrl null) — this is
// never sold through portal checkout.
//
// Idempotent: insert-if-missing on slug, never updates an existing row.
const VIP_ARBITRAGE_PRODUCT = {
  slug: "vip_arbitrage",
  name: "VIP Arbitrage",
  type: "backend",
  thrivecartProductId: null,
  entitlementKeys: [],
  durationDays: null,
  priceDisplay: null,
  sortOrder: 17,
};

export async function seedVipArbitrageProduct(): Promise<void> {
  const [existing] = await db
    .select({ slug: productsTable.slug })
    .from(productsTable)
    .where(eq(productsTable.slug, VIP_ARBITRAGE_PRODUCT.slug))
    .limit(1);

  if (existing) {
    console.log("[Seed] VIP Arbitrage product already seeded, skipping");
    return;
  }

  await db
    .insert(productsTable)
    .values(insertProductSchema.parse(VIP_ARBITRAGE_PRODUCT));
  console.log("[Seed] Inserted VIP Arbitrage product");
}
