import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// Captures `portal_product_keys` entries that The Machine sent which have no
// row in `machineProductKeyMappingsTable`. Surfaced to admins so the mapping
// table can be extended — never silently dropped. We dedupe by machineKey
// (UNIQUE) and just bump `occurrences` + `lastSeenAt` on repeats, so this
// table stays bounded even under sustained traffic of a single bad key.
export const machineUnknownProductKeysTable = pgTable(
  "machine_unknown_product_keys",
  {
    id: serial("id").primaryKey(),
    machineKey: text("machine_key").notNull().unique(),
    occurrences: integer("occurrences").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastExternalOrderId: text("last_external_order_id"),
    lastExternalSource: text("last_external_source"),
    // Admins dismiss a row once they've added the corresponding mapping (or
    // confirmed it should stay unmapped). Dismissed rows stay in the table
    // for audit but are filtered out of the default admin view.
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    dismissedBy: text("dismissed_by"),
  },
  (table) => ({
    lastSeenAtIdx: index("machine_unknown_product_keys_last_seen_at_idx").on(
      table.lastSeenAt,
    ),
    dismissedAtIdx: index("machine_unknown_product_keys_dismissed_at_idx").on(
      table.dismissedAt,
    ),
  }),
);

export type MachineUnknownProductKey =
  typeof machineUnknownProductKeysTable.$inferSelect;
export type InsertMachineUnknownProductKey =
  typeof machineUnknownProductKeysTable.$inferInsert;

