/**
 * Boot seed: populate the Content Access Map with the ownership-gated
 * navigation defaults (Task: ownership-gated nav + Blitz server enforcement).
 *
 * Policy seeded here:
 *   - `blitz` → owned by ALL six front-end offers + the 21-Day Blitz upsell +
 *     every mentorship tier including vip (all member levels see The Blitz).
 *   - LaunchPad+ pages (resource-hub, partner-tools, …) → mentorship tiers only.
 *   - Every other gateable page → all six front-end offers + all five
 *     mentorship tiers.
 *   - No page key remains unmapped/open.
 *
 * Idempotent and admin-respecting: INSERT … ON CONFLICT (page_key) DO NOTHING,
 * so once a row exists (seeded or admin-edited) it is never overwritten.
 * Admin edits always win.
 */
import { db, contentAccessMapTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { GATEABLE_PAGE_KEYS, MAPPABLE_PRODUCTS } from "@workspace/content-access-registry";

const FRONTEND_SLUGS = MAPPABLE_PRODUCTS.filter((p) => p.group === "frontend").map(
  (p) => p.slug,
);

const FUNNEL_SLUGS = MAPPABLE_PRODUCTS.filter((p) => p.group === "funnel").map(
  (p) => p.slug,
);

// The five mentorship tiers (deliberately excludes `vip` — it is a badge-only
// status product; VIP-specific gating is an explicit admin decision).
const MENTORSHIP_TIER_SLUGS = ["launchpad", "3month", "6month", "1year", "lifetime"];

/**
 * The Blitz is available to EVERY member level: all six front-end offers, the
 * 21-Day Blitz funnel upsell, and every mentorship tier. `vip` is included
 * here deliberately (aligned with the sidebar's PURCHASE_OWNER_SLUGS.blitz,
 * which uses ALL mentorship slugs including vip) so a vip-only grant never
 * loses Blitz visibility.
 */
export const BLITZ_OWNER_SLUGS = [
  ...FRONTEND_SLUGS,
  "yse_21_day_blitz",
  ...MENTORSHIP_TIER_SLUGS,
  "vip",
];

// Pitch/partner surfaces the business wants visible to LaunchPad-and-above
// only (front-end/funnel buyers excluded).
const LAUNCHPAD_PLUS_PAGE_KEYS = new Set([
  "resource-hub",
  "partner-tools",
  "prime-corporate",
  "ad-credit",
  "become-a-coach",
]);

/**
 * Swipe Resource Bank (Task #2104): sold as the `yse_swipe_resource_bank`
 * funnel upsell; mentorship tiers get it included. Front-end-only buyers
 * WITHOUT the bank are deliberately excluded.
 */
export const SWIPE_BANK_OWNER_SLUGS = [
  "yse_swipe_resource_bank",
  ...MENTORSHIP_TIER_SLUGS,
];

export function defaultSlugsForPageKey(pageKey: string): string[] {
  if (pageKey === "blitz") return [...BLITZ_OWNER_SLUGS];
  if (pageKey === "swipe-bank") return [...SWIPE_BANK_OWNER_SLUGS];
  // Front-End Welcome landing: front-ends + funnel products + tiers. Tiers
  // are included deliberately — ROUTING decides who lands here; a tier
  // member following a direct link must not be hard-blocked.
  if (pageKey === "frontend-welcome")
    return [...FRONTEND_SLUGS, ...FUNNEL_SLUGS, ...MENTORSHIP_TIER_SLUGS];
  if (LAUNCHPAD_PLUS_PAGE_KEYS.has(pageKey)) return [...MENTORSHIP_TIER_SLUGS];
  return [...FRONTEND_SLUGS, ...MENTORSHIP_TIER_SLUGS];
}

/**
 * Page keys retired from the registry whose stale map rows must be removed
 * (a lingering row is harmless to the resolver — it filters by the registry —
 * but it would confuse forensics and any future re-registration).
 */
const RETIRED_PAGE_KEYS = ["affiliate-networks"];

/**
 * Idempotent, ADDITIVE-ONLY boot repair for the `blitz` map row.
 *
 * The seed above is ON CONFLICT DO NOTHING, so environments where the Blitz
 * row was already seeded (shared dev DB, prod) would never pick up the
 * expanded default owner set. This repair unions the current default
 * BLITZ_OWNER_SLUGS into the existing row:
 *   - never removes any slug (admin additions always survive);
 *   - no-op when every default slug is already present (idempotent);
 *   - no-op when the row does not exist (the seed insert covers that case).
 */
export async function ensureBlitzOwnerSlugsRepair(): Promise<void> {
  const [row] = await db
    .select({
      productSlugs: contentAccessMapTable.productSlugs,
    })
    .from(contentAccessMapTable)
    .where(eq(contentAccessMapTable.pageKey, "blitz"))
    .limit(1);

  if (!row) return;

  const existing = Array.isArray(row.productSlugs) ? row.productSlugs : [];
  const missing = BLITZ_OWNER_SLUGS.filter((s) => !existing.includes(s));
  if (missing.length === 0) return;

  await db
    .update(contentAccessMapTable)
    .set({
      productSlugs: [...existing, ...missing],
      updatedBy: "boot-repair-blitz-all-levels",
      updatedAt: new Date(),
    })
    .where(eq(contentAccessMapTable.pageKey, "blitz"));
  console.log(
    `[Seed] Content Access Map: added missing Blitz owner slugs: ${missing.join(", ")}`,
  );
}

export async function ensureContentAccessMapSeed(): Promise<void> {
  await db
    .delete(contentAccessMapTable)
    .where(inArray(contentAccessMapTable.pageKey, RETIRED_PAGE_KEYS));

  const values = GATEABLE_PAGE_KEYS.map((pageKey) => ({
    pageKey,
    productSlugs: defaultSlugsForPageKey(pageKey),
    updatedBy: "boot-seed",
  }));

  await db
    .insert(contentAccessMapTable)
    .values(values)
    .onConflictDoNothing({ target: contentAccessMapTable.pageKey });

  // Additive repair for pre-existing Blitz rows (see doc comment above).
  await ensureBlitzOwnerSlugsRepair();
}
