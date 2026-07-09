import { pgTable, text, serial, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Durable per-node synthesis state (Task #1534, Synthesis Engine Part 2).
 *
 * Records, for each taxonomy node, WHEN it was last synthesized and from WHICH
 * source documents — the "last synthesized from which sources" marker. This is
 * what makes incremental runs real: comparing a node's currently-linked source
 * set (kb_source_node_links) against `sourceDocIds` here tells us whether new
 * material has landed since the last synthesis, so only genuinely affected nodes
 * are re-synthesized instead of the whole taxonomy.
 *
 * One row per node (unique). Additive/nullable — nothing depends on a row
 * existing; a node with no row has simply never been synthesized. The `node` /
 * `homeRoot` vocabularies are plain text owned by the kb-taxonomy registry (no
 * pg enums) so the taxonomy can grow without a schema migration.
 */
export const kbNodeSynthesisStateTable = pgTable("kb_node_synthesis_state", {
  id: serial("id").primaryKey(),
  // Taxonomy node slug — one row per node (unique).
  node: text("node").notNull(),
  // Home root slug (denormalized for shelf-level grouping).
  homeRoot: text("home_root").notNull(),
  // When this node was last synthesized into a truth-doc draft.
  lastSynthesizedAt: timestamp("last_synthesized_at", { withTimezone: true }).notNull().defaultNow(),
  // The source_doc ids that were linked to this node at the time of the last
  // synthesis. Comparing the live link set against this detects new material.
  sourceDocIds: jsonb("source_doc_ids").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  // How many sources fed the last synthesis (== sourceDocIds.length; kept for
  // cheap display without parsing the jsonb).
  sourceCount: integer("source_count").notNull().default(0),
  // The main truth-doc draft the last synthesis created (nullable — a run can
  // legitimately produce no draft when there was no usable material).
  lastDraftId: integer("last_draft_id"),
  // Honest failure state (synthesis hardening): when the last synthesis ATTEMPT
  // for this node failed, the reason lands here (cleared on the next success).
  // getAffectedNodes() treats a node with lastError set as affected, so
  // incremental reruns self-heal failed nodes.
  lastError: text("last_error"),
  // When the node was last ATTEMPTED (success or failure). lastSynthesizedAt
  // only moves on success.
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("kb_node_synthesis_state_node_uniq").on(table.node),
  index("kb_node_synthesis_state_home_root_idx").on(table.homeRoot),
]);

export const insertKbNodeSynthesisStateSchema = createInsertSchema(kbNodeSynthesisStateTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKbNodeSynthesisState = z.infer<typeof insertKbNodeSynthesisStateSchema>;
export type KbNodeSynthesisState = typeof kbNodeSynthesisStateTable.$inferSelect;
