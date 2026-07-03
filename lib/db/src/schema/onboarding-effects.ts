import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Per-(member, effect) idempotency ledger for one-time onboarding side
// effects (Task #1642 / TB1) — e.g. the creation-time
// nurture_frontend_to_upgrade enrollment and the completion-time onboarding
// sequence cancellation. UNIQUE(user_id, effect) is the claim mechanism:
// claiming an effect is a plain insert with onConflictDoNothing, so
// concurrent/retried callers race safely.
export const onboardingEffectsTable = pgTable(
  "onboarding_effects",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    effect: text("effect").notNull(),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userEffectUnique: uniqueIndex("onboarding_effects_user_effect_uidx").on(table.userId, table.effect),
  }),
);

export type OnboardingEffect = typeof onboardingEffectsTable.$inferSelect;
