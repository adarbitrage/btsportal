/**
 * Boot seed: populate the Content Access Map with the ownership-gated
 * navigation defaults (Task: ownership-gated nav + Blitz server enforcement).
 *
 * Policy seeded here:
 *   - `blitz` → owned by the 21-Day Blitz upsell + all five mentorship tiers.
 *   - Every other gateable page → all six front-end offers + all five
 *     mentorship tiers.
 *   - No page key remains unmapped/open.
 *
 * Idempotent and admin-respecting: INSERT … ON CONFLICT (page_key) DO NOTHING,
 * so once a row exists (seeded or admin-edited) it is never overwritten.
 * Admin edits always win.
 */
import { db, contentAccessMapTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
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

const BLITZ_OWNER_SLUGS = ["yse_21_day_blitz", ...MENTORSHIP_TIER_SLUGS];

// Pitch/partner surfaces the business wants visible to LaunchPad-and-above
// only (front-end/funnel buyers excluded).
const LAUNCHPAD_PLUS_PAGE_KEYS = new Set([
  "partner-tools",
  "prime-corporate",
  "ad-credit",
  "become-a-coach",
]);

export function defaultSlugsForPageKey(pageKey: string): string[] {
  if (pageKey === "blitz") return [...BLITZ_OWNER_SLUGS];
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
}
