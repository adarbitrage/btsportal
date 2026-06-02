import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  real,
  date,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const blitzPhasesTable = pgTable("blitz_phases", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
  color: text("color").notNull(),
});

export type BlitzPhase = typeof blitzPhasesTable.$inferSelect;

export const blitzEventsTable = pgTable(
  "blitz_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    courseId: text("course_id").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    videoPositionSeconds: integer("video_position_seconds"),
    scrollPositionPct: real("scroll_position_pct"),
  },
  (table) => [
    index("blitz_events_user_occurred_idx").on(table.userId, table.occurredAt),
    index("blitz_events_user_course_idx").on(
      table.userId,
      table.courseId,
      table.occurredAt,
    ),
  ],
);

export type BlitzEvent = typeof blitzEventsTable.$inferSelect;

export const blitzDailyActivityTable = pgTable(
  "blitz_daily_activity",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    activityDate: date("activity_date").notNull(),
    eventCount: integer("event_count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.activityDate] })],
);

export type BlitzDailyActivity = typeof blitzDailyActivityTable.$inferSelect;
