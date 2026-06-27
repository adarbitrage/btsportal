import { pgTable, text, serial, jsonb, timestamp, index } from "drizzle-orm/pg-core";

// Maps a page key from the content-access registry to the set of product slugs
// that unlock it. One row per gated page.
//
// Semantics:
//   - No row for a page → page is OPEN to any authenticated member.
//   - Row with ≥1 product slug → page is GATED; member must own ≥1 product in
//     the slug list (or be admin/coach) to access it.
//   - An upsert that results in an empty slug array deletes the row, reverting
//     the page to OPEN — empty arrays are never persisted.
//
// Admin/coach bypass is enforced by the resolver (getAccessiblePageKeys), not
// by this table. Admins see all pages regardless of mappings.
export const contentAccessMapTable = pgTable(
  "content_access_map",
  {
    id: serial("id").primaryKey(),
    pageKey: text("page_key").notNull().unique(),
    productSlugs: jsonb("product_slugs").$type<string[]>().notNull().default([]),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    pageKeyIdx: index("content_access_map_page_key_idx").on(table.pageKey),
  }),
);

export type ContentAccessMap = typeof contentAccessMapTable.$inferSelect;
export type InsertContentAccessMap = typeof contentAccessMapTable.$inferInsert;
