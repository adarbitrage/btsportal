/**
 * Boot seed for the Swipe Resource Bank taxonomy (Task #2104 Phase 1).
 *
 * Seeds the WordPress-era vertical → sub-vertical taxonomy. Angles arrive
 * with content (Phase 2) and are NOT seeded here.
 *
 * Rules (prod-parity boot-hook path):
 *   - advisory-locked transaction (concurrent boots can't double-seed);
 *   - insert-if-absent by exact name (admin renames/deletes always win —
 *     a deleted sub-vertical WILL be re-seeded only if an admin also renames
 *     nothing; matching is by name, so renamed rows are left alone and the
 *     original name would reappear — acceptable pre-launch, and admins can
 *     simply delete again post-launch content load);
 *   - never updates existing rows.
 */
import { sql, eq, and } from "drizzle-orm";
import {
  db,
  swipeBankVerticalsTable,
  swipeBankSubVerticalsTable,
} from "@workspace/db";

const LOCK_KEY_1 = 0x53574250; // "SWBP"
const LOCK_KEY_2 = 0x0001;

const TAXONOMY: Array<{ name: string; subVerticals: string[] }> = [
  {
    name: "Health",
    subVerticals: [
      "Diet/Weight Loss",
      "Skincare/Anti-Aging",
      "Blood Pressure",
      "Diabetes",
      "Muscle Building",
      "E.D.",
      "Vision",
      "Brain",
      "Other",
    ],
  },
  {
    name: "Wealth",
    subVerticals: [
      "Mortgage/Refinancing",
      "Auto/Insurance",
      "Casino/Gambling",
      "Lottery",
      "Business Opportunity",
      "Bitcoin",
      "Other",
    ],
  },
  { name: "Everything Else", subVerticals: [] },
];

export async function seedSwipeBankTaxonomy(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY_1}, ${LOCK_KEY_2})`);

    for (let vi = 0; vi < TAXONOMY.length; vi++) {
      const v = TAXONOMY[vi];
      const [existingV] = await tx
        .select({ id: swipeBankVerticalsTable.id })
        .from(swipeBankVerticalsTable)
        .where(eq(swipeBankVerticalsTable.name, v.name))
        .limit(1);
      let verticalId: number;
      if (existingV) {
        verticalId = existingV.id;
      } else {
        const [created] = await tx
          .insert(swipeBankVerticalsTable)
          .values({ name: v.name, sortOrder: vi })
          .returning({ id: swipeBankVerticalsTable.id });
        verticalId = created.id;
        console.log(`[Seed] Swipe Bank: created vertical "${v.name}"`);
      }

      for (let si = 0; si < v.subVerticals.length; si++) {
        const name = v.subVerticals[si];
        const [existingS] = await tx
          .select({ id: swipeBankSubVerticalsTable.id })
          .from(swipeBankSubVerticalsTable)
          .where(
            and(
              eq(swipeBankSubVerticalsTable.verticalId, verticalId),
              eq(swipeBankSubVerticalsTable.name, name),
            ),
          )
          .limit(1);
        if (existingS) continue;
        await tx
          .insert(swipeBankSubVerticalsTable)
          .values({ verticalId, name, sortOrder: si });
      }
    }
  });
}
