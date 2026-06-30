import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { productsTable } from "./products";
import { paymentMethodsTable } from "./payment-methods";

export const subscriptionsTable = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    paymentMethodId: integer("payment_method_id")
      .notNull()
      .references(() => paymentMethodsTable.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("active"),
    interval: text("interval").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    nextChargeAt: timestamp("next_charge_at", { withTimezone: true }),
    retryCount: integer("retry_count").notNull().default(0),
    lastChargeAttemptAt: timestamp("last_charge_attempt_at", { withTimezone: true }),
    lastFailureReason: text("last_failure_reason"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    /**
     * Tier 6.2b: dunning — when the next past_due retry should be attempted.
     * Null when the subscription is active, canceled, or unpaid. Set to
     * now+3d on the first decline (attempt #1) and advanced to now+4d (→ +7d
     * from original failure) after the second decline (attempt #2). Cleared
     * on recovery or final failure.
     */
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index("subscriptions_user_id_idx").on(table.userId),
    statusIdx: index("subscriptions_status_idx").on(table.status),
    nextChargeAtIdx: index("subscriptions_next_charge_at_idx").on(table.nextChargeAt),
    nextRetryAtIdx: index("subscriptions_next_retry_at_idx").on(table.nextRetryAt),
    statusCheck: check(
      "subscriptions_status_check",
      sql`${table.status} IN ('active', 'past_due', 'canceled', 'unpaid')`,
    ),
    intervalCheck: check(
      "subscriptions_interval_check",
      sql`${table.interval} IN ('monthly', 'yearly')`,
    ),
  }),
);

export type Subscription = typeof subscriptionsTable.$inferSelect;
export type InsertSubscription = typeof subscriptionsTable.$inferInsert;
