import { db } from "@workspace/db";
import { productsTable, insertProductSchema } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

// Machine membership product (Task #1901). A cross-system Machine-side
// membership (The Machine — the AI-powered campaign engine) whose Portal
// product row exists for exactly one reason: recording who actually owns
// The Machine, so `isMachineMember` (pitch-resolver.ts) can suppress the
// MACHINE_PITCH / MACHINE_INTRO_PITCH email pitches for members who already
// hold it. Same design as the VIP Arbitrage product (Task #1854,
// seed-vip-arbitrage-product.ts).
//
// It deliberately carries NO entitlement keys — owning The Machine grants no
// portal content, coaching, or support tier (memberships/entitlements stay
// product-derived and this product derives nothing). It also has NO rank in
// PRODUCT_RANK (resolves to rank 0), so it never affects tier resolution,
// mentorship eligibility, or partner-assignment rank checks.
//
// NOTE: this is distinct from the Machine BRAND front-end products
// (backroad, offmarket, etc. — seed-machine-brand-products.ts). Those are
// $47–$97 info products sold THROUGH Machine funnels; buying one does not
// mean the member owns The Machine engine itself, so those buyers remain in
// the Machine pitch audience by design.
//
// Grants arrive via:
//   - POST /api/integrations/machine-purchase / grant-product with the
//     `machine` (or `the_machine`) product key (seeded mapping rows in
//     machine-product-key-mappings.ts), or
//   - a manual admin grant from the member detail Products tab.
//
// durationDays is null: Machine membership does not expire on a portal
// clock (a cancellation lands as a status change / expiresAt on the grant).
// No checkout path exists (thrivecartProductId/checkoutUrl null) — this is
// never sold through portal checkout.
//
// Idempotent: insert-if-missing on slug, never updates an existing row.
const MACHINE_MEMBERSHIP_PRODUCT = {
  slug: "machine",
  name: "The Machine",
  type: "backend",
  thrivecartProductId: null,
  entitlementKeys: [],
  durationDays: null,
  priceDisplay: null,
  sortOrder: 18,
};

export const MACHINE_MEMBERSHIP_PRODUCT_SLUG = MACHINE_MEMBERSHIP_PRODUCT.slug;

export async function seedMachineMembershipProduct(): Promise<void> {
  const [existing] = await db
    .select({ slug: productsTable.slug })
    .from(productsTable)
    .where(eq(productsTable.slug, MACHINE_MEMBERSHIP_PRODUCT.slug))
    .limit(1);

  if (existing) {
    console.log("[Seed] Machine membership product already seeded, skipping");
    return;
  }

  await db
    .insert(productsTable)
    .values(insertProductSchema.parse(MACHINE_MEMBERSHIP_PRODUCT));
  console.log("[Seed] Inserted Machine membership product");
}
