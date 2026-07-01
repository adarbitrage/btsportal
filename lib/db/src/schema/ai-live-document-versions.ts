import { pgTable, text, serial, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { aiLiveDocumentsTable } from "./ai-live-documents";

// ── Live AI Document version history (Synthesis Engine Part 3) ────────────────
// Every time an approved revision SUPERSEDES a published Live AI Document, the
// prior published content is snapshotted here BEFORE the live row is overwritten.
// This preserves the version + provenance history the task requires, so a doc's
// lineage survives repeated updates and the assistant always cites the current
// (live) version while the superseded versions remain auditable.
export const aiLiveDocumentVersionsTable = pgTable(
  "ai_live_document_versions",
  {
    id: serial("id").primaryKey(),
    // The live doc this snapshot belongs to. Cascade so history dies with the doc.
    docId: integer("doc_id")
      .notNull()
      .references(() => aiLiveDocumentsTable.id, { onDelete: "cascade" }),
    // 1-based version number of THIS snapshot (the content that was live before
    // the supersede). Successive supersedes number 1, 2, 3, …
    versionNumber: integer("version_number").notNull(),
    // Snapshot of the superseded published content + taxonomy.
    title: text("title").notNull(),
    content: text("content").notNull(),
    docClass: text("doc_class"),
    homeRoot: text("home_root"),
    node: text("node"),
    // The prior version's verification stamp (its own citable gate at the time).
    lastVerified: timestamp("last_verified", { withTimezone: true }),
    // Snapshot of the provenance rows that traced the superseded version back to
    // its source(s): [{ sourceId, chunkRef, relation }].
    provenance: jsonb("provenance").$type<
      { sourceId: number | null; chunkRef: string | null; relation: string }[]
    >(),
    // The kb_staging_docs revision draft that superseded this version (soft link).
    supersededByStagingDocId: integer("superseded_by_staging_doc_id"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ai_live_doc_versions_doc_idx").on(table.docId)],
);

export type AiLiveDocumentVersion = typeof aiLiveDocumentVersionsTable.$inferSelect;
export type InsertAiLiveDocumentVersion = typeof aiLiveDocumentVersionsTable.$inferInsert;
