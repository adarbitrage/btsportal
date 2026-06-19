import { db } from "@workspace/db";
import { productsTable, insertProductSchema } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";

// YSE (Your Second Engine) products granted via:
//   - POST /api/integrations/grant-product (legacy YSE/GHL caller)
//   - POST /api/integrations/machine-purchase (Machine caller, hard-coded to
//     grant yse_front_end on every successful purchase)
//
// These rows were historically only created by the dev-only seedDatabase()
// in src/seed.ts and so were never present in production. The
// /machine-purchase endpoint returns 500 INTERNAL_ERROR with UNKNOWN_SLUGS
// in the grant-handler when these slugs are missing. Running this seeder
// at startup is idempotent (insert-if-missing on slug) and ensures the
// integration works in any environment the api-server boots into.
const YSE_PRODUCTS = [
  {
    slug: "yse_front_end",
    name: "YSE Front End ($67)",
    type: "frontend",
    thrivecartProductId: null,
    entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
    priceDisplay: "$67",
    sortOrder: 9,
  },
  {
    slug: "yse_affiliate_cmo_bump",
    name: "YSE Affiliate CMO Bump ($47)",
    type: "frontend",
    thrivecartProductId: null,
    entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
    priceDisplay: "$47",
    sortOrder: 10,
  },
  {
    slug: "yse_21_day_blitz",
    name: "YSE 21-Day Blitz ($297)",
    type: "backend",
    thrivecartProductId: null,
    entitlementKeys: [
      "content:frontend",
      "content:advanced",
      "software:base",
      "support:standard",
      "chat:full",
    ],
    // durationDays intentionally NULL — the "21-day" name is marketing only;
    // access is permanent. Do NOT set durationDays here.
    priceDisplay: "$297",
    sortOrder: 11,
  },
  {
    slug: "yse_swipe_resource_bank",
    name: "YSE Swipe Resource Bank ($97)",
    type: "frontend",
    thrivecartProductId: null,
    entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
    priceDisplay: "$97",
    sortOrder: 12,
  },
  {
    slug: "yse_profit_maximizer_pass",
    name: "YSE Profit Maximizer Pass ($97)",
    type: "frontend",
    thrivecartProductId: null,
    entitlementKeys: [
      "content:frontend",
      "content:advanced",
      "support:standard",
      "chat:full",
    ],
    priceDisplay: "$97",
    sortOrder: 13,
  },
];

const REQUIRED_SLUGS = YSE_PRODUCTS.map((p) => p.slug);

export async function seedYseProducts(): Promise<void> {
  const existing = await db
    .select({ slug: productsTable.slug })
    .from(productsTable)
    .where(inArray(productsTable.slug, REQUIRED_SLUGS));
  const existingSlugs = new Set(existing.map((r) => r.slug));
  const toInsert = YSE_PRODUCTS.filter((p) => !existingSlugs.has(p.slug)).map(
    (p) => insertProductSchema.parse(p),
  );

  if (toInsert.length === 0) {
    console.log("[Seed] YSE products already seeded, skipping");
    return;
  }

  await db.insert(productsTable).values(toInsert);
  console.log(
    `[Seed] Inserted ${toInsert.length} YSE product(s): ${toInsert
      .map((p) => p.slug)
      .join(", ")}`,
  );
}
