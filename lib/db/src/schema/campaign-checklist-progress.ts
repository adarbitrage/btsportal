import { pgTable, serial, integer, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Per-member state for the /blitz/campaign-checklist page.
 *
 * One row per member. `checkedIds` holds the stable checklist keys from
 * @workspace/campaign-roadmap — a step `id` for steps without substeps, or a
 * `substepId` for individual substeps. NEVER display text or array indexes.
 * `network` is the member's affiliate-network choice (step 3): "media-mavens"
 * or "clickbank"; null until chosen (steps 4-17 stay hidden client-side).
 */
export const campaignChecklistProgressTable = pgTable(
  "campaign_checklist_progress",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id),
    network: text("network"),
    checkedIds: jsonb("checked_ids").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("campaign_checklist_progress_user_idx").on(table.userId),
  ],
);

export type CampaignChecklistProgress = typeof campaignChecklistProgressTable.$inferSelect;
