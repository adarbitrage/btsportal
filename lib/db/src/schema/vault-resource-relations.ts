import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vaultResourcesTable } from "./vault-resources";

export const vaultResourceRelationsTable = pgTable("vault_resource_relations", {
  id: serial("id").primaryKey(),
  resourceId: integer("resource_id").notNull().references(() => vaultResourcesTable.id),
  relatedResourceId: integer("related_resource_id").notNull().references(() => vaultResourcesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVaultResourceRelationSchema = createInsertSchema(vaultResourceRelationsTable).omit({ id: true, createdAt: true });
export type InsertVaultResourceRelation = z.infer<typeof insertVaultResourceRelationSchema>;
export type VaultResourceRelation = typeof vaultResourceRelationsTable.$inferSelect;
