import { pgTable, text, serial, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tracksTable = pgTable("tracks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  requiredEntitlement: text("required_entitlement").notNull().default("content:frontend"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertTrackSchema = createInsertSchema(tracksTable).omit({ id: true });
export type InsertTrack = z.infer<typeof insertTrackSchema>;
export type Track = typeof tracksTable.$inferSelect;
