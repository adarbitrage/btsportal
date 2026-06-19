import { pgTable, text, serial, integer, jsonb, boolean, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitlementKeySchema } from "../entitlement-registry";

export const productsTable = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    type: text("type").notNull().default("frontend"),
    thrivecartProductId: text("thrivecart_product_id"),
    entitlementKeys: jsonb("entitlement_keys").notNull().default([]),
    durationDays: integer("duration_days"),
    priceDisplay: text("price_display"),
    sortOrder: integer("sort_order").notNull().default(0),
    // Hosted checkout URL for upgrades from the /plans page. Stored per-product
    // so each tier can point at its own ThriveCart (or other provider) cart.
    // Nullable: products that aren't directly purchasable (or that we haven't
    // wired up a cart for yet) leave this blank and the API refuses to start
    // a checkout for them. The /members/me/checkout endpoint appends the
    // member's email/name and a return_url before redirecting.
    checkoutUrl: text("checkout_url"),
    // Plan presentation metadata surfaced on the public /plans page. Lives on
    // the products table (rather than a static map in code) so admins can
    // edit marketing copy without a code deploy via PATCH /admin/products/:id.
    // `tagline` is the short subtitle shown under the plan name, `highlights`
    // is the bullet list under the price, `durationLabel` is the human label
    // (e.g. "90 days", "Lifetime") shown next to the price, and `recommended`
    // controls the "Most popular" badge. See artifacts/api-server/src/lib/plans.ts.
    tagline: text("tagline"),
    durationLabel: text("duration_label"),
    highlights: jsonb("highlights").notNull().default([]),
    recommended: boolean("recommended").notNull().default(false),
  },
  (table) => ({
    // Pin the storage shape of `entitlement_keys` to a JSONB array. Without
    // this constraint, a stray `JSON.stringify([...])` on the way in lands
    // a JSONB string scalar (a serialized array stored as a string) — which
    // Drizzle silently re-parses on the way out, but breaks raw SQL JSONB
    // operators like `jsonb_array_elements_text`, `?`, and `@>` (see #329
    // for the original incident). Reject the bad shape at the database
    // layer so it can never come back. NOTE: this constraint will fail to
    // attach if any existing row is still a string scalar; the `0021`
    // data migration must have been applied first.
    entitlementKeysIsArray: check(
      "products_entitlement_keys_is_array",
      sql`jsonb_typeof(${table.entitlementKeys}) = 'array'`,
    ),
    // Same rationale as entitlement_keys: pin `highlights` to a JSONB array
    // so a stray `JSON.stringify([...])` on the way in is rejected at the DB
    // layer instead of silently producing a string scalar.
    highlightsIsArray: check(
      "products_highlights_is_array",
      sql`jsonb_typeof(${table.highlights}) = 'array'`,
    ),
  }),
);

export const insertProductSchema = createInsertSchema(productsTable)
  .omit({ id: true })
  .extend({
    entitlementKeys: z.array(entitlementKeySchema).default([]),
  });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
