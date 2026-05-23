import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";

// Maps a `portal_product_keys` entry sent by The Machine (e.g. "yse_front_end",
// "yse_cmo_bump") onto a Portal product slug that the grant pipeline can
// resolve in `productsTable.slug`. One mapping row per Machine key; the same
// Portal slug may be referenced by many Machine keys. Admins edit this table
// via the admin panel — see `/api/admin/integrations/machine-product-key-mappings`.
export const machineProductKeyMappingsTable = pgTable(
  "machine_product_key_mappings",
  {
    id: serial("id").primaryKey(),
    machineKey: text("machine_key").notNull().unique(),
    portalSlug: text("portal_slug").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedBy: text("updated_by"),
  },
  (table) => ({
    portalSlugIdx: index("machine_product_key_mappings_portal_slug_idx").on(
      table.portalSlug,
    ),
  }),
);

export type MachineProductKeyMapping =
  typeof machineProductKeyMappingsTable.$inferSelect;
export type InsertMachineProductKeyMapping =
  typeof machineProductKeyMappingsTable.$inferInsert;
