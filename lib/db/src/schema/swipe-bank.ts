import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// Swipe Resource Bank (Task #2104, Phase 1): a gated member-facing creative
// swipe gallery sold as the `yse_swipe_resource_bank` funnel upsell.
//
// Taxonomy: vertical (Health / Wealth / Everything Else) → sub-vertical
// (Diet/Weight Loss, …) → marketing angle (arrives with content, Phase 2).
// Items (banner | advertorial) hang off a sub-vertical and optionally an
// angle. All assets live in private object storage and are served ONLY
// through the authed, `swipe-bank`-gated content proxy (Creative Drive
// pattern — never signed URLs, never public paths).
export const swipeBankVerticalsTable = pgTable("swipe_bank_verticals", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const swipeBankSubVerticalsTable = pgTable(
  "swipe_bank_sub_verticals",
  {
    id: serial("id").primaryKey(),
    verticalId: integer("vertical_id")
      .notNull()
      .references(() => swipeBankVerticalsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    verticalIdx: index("swipe_bank_sub_verticals_vertical_idx").on(
      table.verticalId,
    ),
  }),
);

export const swipeBankAnglesTable = pgTable(
  "swipe_bank_angles",
  {
    id: serial("id").primaryKey(),
    subVerticalId: integer("sub_vertical_id")
      .notNull()
      .references(() => swipeBankSubVerticalsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    subVerticalIdx: index("swipe_bank_angles_sub_vertical_idx").on(
      table.subVerticalId,
    ),
  }),
);

// `objectPath` / `thumbnailObjectPath` are normalized `/objects/...` paths
// under PRIVATE_OBJECT_DIR. Thumbnails are generated at upload time
// (originals never modified) and stored as separate objects.
export const swipeBankItemsTable = pgTable(
  "swipe_bank_items",
  {
    id: serial("id").primaryKey(),
    /** "banner" | "advertorial" (validated at the API layer). */
    itemType: text("item_type").notNull(),
    subVerticalId: integer("sub_vertical_id")
      .notNull()
      .references(() => swipeBankSubVerticalsTable.id, { onDelete: "cascade" }),
    angleId: integer("angle_id").references(() => swipeBankAnglesTable.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    /** Free-text provenance label shown on cards (e.g. original network). */
    sourceLabel: text("source_label").notNull().default(""),
    objectPath: text("object_path").notNull(),
    thumbnailObjectPath: text("thumbnail_object_path"),
    mimeType: text("mime_type").notNull().default(""),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Soft-disable: inactive items are hidden from members, kept for admins. */
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    subVerticalIdx: index("swipe_bank_items_sub_vertical_idx").on(
      table.subVerticalId,
    ),
    angleIdx: index("swipe_bank_items_angle_idx").on(table.angleId),
  }),
);

export type SwipeBankVertical = typeof swipeBankVerticalsTable.$inferSelect;
export type SwipeBankSubVertical = typeof swipeBankSubVerticalsTable.$inferSelect;
export type SwipeBankAngle = typeof swipeBankAnglesTable.$inferSelect;
export type SwipeBankItem = typeof swipeBankItemsTable.$inferSelect;
export type InsertSwipeBankItem = typeof swipeBankItemsTable.$inferInsert;
