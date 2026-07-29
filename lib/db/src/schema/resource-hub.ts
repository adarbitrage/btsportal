import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { creativeDriveFilesTable } from "./creative-drive";

// Resource Hub curation layer (Task #2028). A thin, admin-editable curation
// model rendered by the member /resource-hub page, layered OVER the existing
// creative-drive storage (which is deliberately left untouched).
//
// Item kinds:
//   - "file":     references a creative_drive_files row (fileId set).
//   - "external": an external link (externalUrl set), e.g. the P&L Tracker.
//   - "group":    a grouping card (no file/url); children reference it via
//                 parentId and may carry a subGroupLabel (e.g. "Swipe Files").
export const resourceHubItemsTable = pgTable(
  "resource_hub_items",
  {
    id: serial("id").primaryKey(),
    /** Stable seed key so boot seeding is idempotent; admin-created rows get a generated slug. */
    slug: text("slug").notNull(),
    /** 'foundations' | 'working_documents' | 'templates_assets' */
    section: text("section").notNull(),
    /** 'file' | 'external' | 'group' */
    kind: text("kind").notNull(),
    fileId: integer("file_id").references(() => creativeDriveFilesTable.id, {
      onDelete: "cascade",
    }),
    externalUrl: text("external_url"),
    parentId: integer("parent_id").references(
      (): AnyPgColumn => resourceHubItemsTable.id,
      { onDelete: "cascade" },
    ),
    subGroupLabel: text("sub_group_label"),
    displayTitle: text("display_title").notNull(),
    blurb: text("blurb").notNull().default(""),
    /** Optional note line shown at the top of an expanded group. */
    noteLine: text("note_line"),
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
    slugUnq: uniqueIndex("resource_hub_items_slug_unq").on(table.slug),
    sectionIdx: index("resource_hub_items_section_idx").on(table.section),
    parentIdx: index("resource_hub_items_parent_idx").on(table.parentId),
  }),
);

// Resource Hub glossary (Task #2028). Definitions are DRAFTED by AI from the
// ai_live_documents corpus and only served to members once a human reviewer
// approves them. Reviewer edits always win over generated text.
export const resourceHubGlossaryTable = pgTable(
  "resource_hub_glossary",
  {
    id: serial("id").primaryKey(),
    term: text("term").notNull(),
    definition: text("definition").notNull().default(""),
    /** 'draft' | 'approved' | 'rejected' */
    status: text("status").notNull().default("draft"),
    /** Set when a generation pass last wrote the definition. */
    lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    termUnq: uniqueIndex("resource_hub_glossary_term_unq").on(table.term),
    statusIdx: index("resource_hub_glossary_status_idx").on(table.status),
  }),
);

export type ResourceHubItem = typeof resourceHubItemsTable.$inferSelect;
export type NewResourceHubItem = typeof resourceHubItemsTable.$inferInsert;
export type ResourceHubGlossaryTerm = typeof resourceHubGlossaryTable.$inferSelect;
export type NewResourceHubGlossaryTerm = typeof resourceHubGlossaryTable.$inferInsert;
