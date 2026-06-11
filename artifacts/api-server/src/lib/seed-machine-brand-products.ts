import { db } from "@workspace/db";
import { productsTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";

// Machine front-end brand products granted via:
//   - POST /api/integrations/grant-product (slug-direct)
//   - POST /api/integrations/machine-purchase (Machine caller, portal_product_keys mapping)
//
// backroad, offmarket, and reserve_income were historically only created by
// the dev-only seedDatabase() in src/seed.ts and so were never present in
// production — /grant-product returns UNKNOWN_SLUGS for them in prod without
// this seeder. silent_partner and test_like_mad are net-new products added
// for The Machine's 5-brand launch.
//
// thrivecartProductId is null for all 5: these are Machine-path products
// provisioned via portal_product_keys, not ThriveCart webhooks. The dev seed
// (seed.ts) carries placeholder thrivecart IDs for the 3 legacy brands for
// local testing; this boot seeder inserts them null in production, which is
// correct for grant-product (matches on slug, NOT thrivecart_product_id).
//
// Running this seeder at startup is idempotent (insert-if-missing on slug) and
// ensures /grant-product works in any environment the api-server boots into.
const MACHINE_BRAND_PRODUCTS = [
  {
    slug: "backroad",
    name: "The Backroad System",
    type: "frontend",
    thrivecartProductId: null,
    entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
    priceDisplay: "$47–$97",
    sortOrder: 2,
  },
  {
    slug: "offmarket",
    name: "The Off-Market Affiliate System",
    type: "frontend",
    thrivecartProductId: null,
    entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
    priceDisplay: "$47–$97",
    sortOrder: 3,
  },
  {
    slug: "reserve_income",
    name: "The Reserve Income System",
    type: "frontend",
    thrivecartProductId: null,
    entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
    priceDisplay: "$47–$97",
    sortOrder: 14,
  },
  {
    slug: "silent_partner",
    name: "The Silent Partner System",
    type: "frontend",
    thrivecartProductId: null,
    entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
    priceDisplay: null,
    sortOrder: 15,
  },
  {
    slug: "test_like_mad",
    name: "Test Like Mad",
    type: "frontend",
    thrivecartProductId: null,
    entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
    priceDisplay: null,
    sortOrder: 16,
  },
];

const REQUIRED_SLUGS = MACHINE_BRAND_PRODUCTS.map((p) => p.slug);

export async function seedMachineBrandProducts(): Promise<void> {
  const existing = await db
    .select({ slug: productsTable.slug })
    .from(productsTable)
    .where(inArray(productsTable.slug, REQUIRED_SLUGS));
  const existingSlugs = new Set(existing.map((r) => r.slug));
  const toInsert = MACHINE_BRAND_PRODUCTS.filter(
    (p) => !existingSlugs.has(p.slug),
  );

  if (toInsert.length === 0) {
    console.log("[Seed] Machine brand products already seeded, skipping");
    return;
  }

  await db.insert(productsTable).values(toInsert);
  console.log(
    `[Seed] Inserted ${toInsert.length} Machine brand product(s): ${toInsert
      .map((p) => p.slug)
      .join(", ")}`,
  );
}
