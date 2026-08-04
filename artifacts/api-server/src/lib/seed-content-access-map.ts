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
import { GATEABLE_PAGE_KEYS, MAPPABLE_PRODUCTS } from "@workspace/content-access-registry";

const FRONTEND_SLUGS = MAPPABLE_PRODUCTS.filter((p) => p.group === "frontend").map(
  (p) => p.slug,
);

// The five mentorship tiers (deliberately excludes `vip` — it is a badge-only
// status product; VIP-specific gating is an explicit admin decision).
const MENTORSHIP_TIER_SLUGS = ["launchpad", "3month", "6month", "1year", "lifetime"];

const BLITZ_OWNER_SLUGS = ["yse_21_day_blitz", ...MENTORSHIP_TIER_SLUGS];

export function defaultSlugsForPageKey(pageKey: string): string[] {
  if (pageKey === "blitz") return [...BLITZ_OWNER_SLUGS];
  return [...FRONTEND_SLUGS, ...MENTORSHIP_TIER_SLUGS];
}

export async function ensureContentAccessMapSeed(): Promise<void> {
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
