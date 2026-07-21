import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  timestamp,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Native Creative Drive (Task #1943): a purpose-built, admin-managed file
// drive shown to members as a read-only browser. Deliberately separate from
// the dormant Resource Vault tables (vault-resources.ts) which have known
// schema drift.
//
// Folders nest via self-referencing parentId (NULL = root). Folder deletion
// is blocked at the API layer when the folder still contains files or
// subfolders, so the FKs never cascade in practice.
export const creativeDriveFoldersTable = pgTable(
  "creative_drive_folders",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    parentId: integer("parent_id").references(
      (): AnyPgColumn => creativeDriveFoldersTable.id,
      { onDelete: "cascade" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    parentIdx: index("creative_drive_folders_parent_idx").on(table.parentId),
  }),
);

// Files live in object storage under the private dir; `objectPath` is the
// normalized `/objects/...` path served through the authenticated
// creative-drive content endpoint (never a raw signed URL).
export const creativeDriveFilesTable = pgTable(
  "creative_drive_files",
  {
    id: serial("id").primaryKey(),
    folderId: integer("folder_id").references(
      () => creativeDriveFoldersTable.id,
      { onDelete: "cascade" },
    ),
    name: text("name").notNull(),
    objectPath: text("object_path").notNull(),
    mimeType: text("mime_type").notNull().default(""),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
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
    folderIdx: index("creative_drive_files_folder_idx").on(table.folderId),
  }),
);

export type CreativeDriveFolder = typeof creativeDriveFoldersTable.$inferSelect;
export type InsertCreativeDriveFolder = typeof creativeDriveFoldersTable.$inferInsert;
export type CreativeDriveFile = typeof creativeDriveFilesTable.$inferSelect;
export type InsertCreativeDriveFile = typeof creativeDriveFilesTable.$inferInsert;
