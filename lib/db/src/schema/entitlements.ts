import { pgTable, text, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const entitlementsTable = pgTable("entitlements", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  description: text("description").notNull(),
  category: text("category").notNull().default("general"),
});

export const insertEntitlementSchema = createInsertSchema(entitlementsTable).omit({ id: true });
export type InsertEntitlement = z.infer<typeof insertEntitlementSchema>;
export type Entitlement = typeof entitlementsTable.$inferSelect;
