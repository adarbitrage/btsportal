import { db } from "@workspace/db";
import { productsTable } from "@workspace/db/schema";
import { ENTITLEMENT_KEYS } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// Additive key-merge targets.
// For each slug, the listed keys are ADDED to whatever the product already has.
// No existing key is ever removed. Re-running is a no-op.
const KEY_GRANTS: { slug: string; keys: (typeof ENTITLEMENT_KEYS)[number][] }[] = [
  { slug: "reserve_income",          keys: ["content:reserve_income"] },
  { slug: "backroad",                keys: ["content:backroad"] },
  { slug: "offmarket",               keys: ["content:offmarket"] },
  { slug: "silent_partner",          keys: ["content:silent_partner"] },
  { slug: "test_like_mad",           keys: ["content:test_like_mad"] },
  { slug: "yse_front_end",           keys: ["content:yse"] },
  { slug: "yse_affiliate_cmo_bump",  keys: ["offer:cmo_bump"] },
  { slug: "yse_21_day_blitz",        keys: ["offer:21_day_blitz"] },
  { slug: "yse_swipe_resource_bank", keys: ["offer:swipe_bank"] },
  { slug: "yse_profit_maximizer_pass", keys: ["offer:profit_maximizer"] },
];

// Display-name renames (slug stays identical).
const NAME_RENAMES: { slug: string; name: string }[] = [
  { slug: "yse_affiliate_cmo_bump",    name: "CMO Bump" },
  { slug: "yse_21_day_blitz",          name: "21-Day Blitz" },
  { slug: "yse_swipe_resource_bank",   name: "Swipe Resource Bank" },
  { slug: "yse_profit_maximizer_pass", name: "Profit Maximizer Pass" },
];

/**
 * Idempotent: merges brand/offer entitlement keys into existing product rows
 * and optionally renames 4 offer-product display names.
 * Runs at boot via bootstrapCriticalPrerequisites.
 */
export async function reconcileEntitlementKeys(): Promise<void> {
  let keyMerges = 0;
  let renames = 0;

  for (const { slug, keys } of KEY_GRANTS) {
    // Build a JSONB array literal of just the additive keys so we can use
    // the array union expression without the Drizzle ANY(array) cast pitfall.
    const addKeysJson = JSON.stringify(keys);

    // UPDATE … SET entitlement_keys = (existing ∪ new) WHERE slug = ?
    // jsonb_agg(DISTINCT value) unions the two arrays element-by-element.
    // Uses a lateral unnest so it works with any Postgres version >= 9.4.
    const result = await db.execute(
      sql`UPDATE products
          SET entitlement_keys = (
            SELECT jsonb_agg(DISTINCT val ORDER BY val)
            FROM (
              SELECT jsonb_array_elements_text(entitlement_keys) AS val
              UNION
              SELECT jsonb_array_elements_text(${addKeysJson}::jsonb)
            ) sub
          )
          WHERE slug = ${slug}
            AND NOT (entitlement_keys @> ${addKeysJson}::jsonb)
          RETURNING slug`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (result as any).rows ?? result;
    if (Array.isArray(rows) && rows.length > 0) {
      console.log(`[Reconcile] Granted keys ${keys.join(", ")} → ${slug}`);
      keyMerges++;
    }
  }

  for (const { slug, name } of NAME_RENAMES) {
    const result = await db.execute(
      sql`UPDATE products
          SET name = ${name}
          WHERE slug = ${slug} AND name != ${name}
          RETURNING slug`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (result as any).rows ?? result;
    if (Array.isArray(rows) && rows.length > 0) {
      console.log(`[Reconcile] Renamed product ${slug} → "${name}"`);
      renames++;
    }
  }

  if (keyMerges === 0 && renames === 0) {
    console.log("[Reconcile] entitlement-key reconcile: no changes (already up-to-date)");
  } else {
    console.log(`[Reconcile] entitlement-key reconcile done: ${keyMerges} key-merges, ${renames} renames`);
  }
}
