import { db, productsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

// Slugs surfaced as upgradeable plans on the public /plans page. Front-end-
// only products (e.g. reserve_income, backroad, offmarket) are intentionally
// omitted. The list lives here (rather than being inferred from a column on
// `products`) because not every purchasable product belongs on the upgrade
// ladder, and the rank ordering below is what the /plans page sorts by.
//
// All other plan presentation fields (name, priceDisplay, durationDays,
// entitlementKeys, tagline, durationLabel, highlights, recommended) come
// from the products table so admin edits via PATCH /admin/products/:id
// propagate to /plans automatically without a code deploy.
const PLAN_SLUG_RANKS: Record<string, number> = {
  launchpad: 1,
  "3month": 2,
  "6month": 3,
  "1year": 4,
  lifetime: 5,
};

export type Plan = {
  slug: string;
  name: string;
  tagline: string;
  priceDisplay: string | null;
  durationDays: number | null;
  durationLabel: string;
  highlights: string[];
  entitlements: string[];
  recommended: boolean;
  rank: number;
};

// Coerce the JSONB `entitlement_keys` / `highlights` column into a string[].
// The columns are stored as JSON arrays but Drizzle types them as `unknown`
// since we use `jsonb().default([])` without a generic. Anything that isn't
// an array of strings (e.g. a corrupted row) is dropped rather than thrown
// over so the public /plans endpoint never 500s on bad seed data.
function coerceStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

export async function listUpgradeablePlans(): Promise<Plan[]> {
  const slugs = Object.keys(PLAN_SLUG_RANKS);
  if (slugs.length === 0) return [];

  const rows = await db
    .select({
      slug: productsTable.slug,
      name: productsTable.name,
      priceDisplay: productsTable.priceDisplay,
      durationDays: productsTable.durationDays,
      entitlementKeys: productsTable.entitlementKeys,
      tagline: productsTable.tagline,
      durationLabel: productsTable.durationLabel,
      highlights: productsTable.highlights,
      recommended: productsTable.recommended,
    })
    .from(productsTable)
    .where(inArray(productsTable.slug, slugs));

  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const plans: Plan[] = [];
  for (const slug of slugs) {
    const rank = PLAN_SLUG_RANKS[slug];
    const row = bySlug.get(slug);
    if (!row) continue;
    plans.push({
      slug,
      name: row.name,
      // `tagline` and `durationLabel` are nullable on the products row (a
      // freshly-inserted product without admin-supplied marketing copy has
      // no tagline yet). Fall back to empty strings so the /plans response
      // stays type-correct and the UI just renders a blank line.
      tagline: row.tagline ?? "",
      priceDisplay: row.priceDisplay,
      durationDays: row.durationDays,
      durationLabel: row.durationLabel ?? "",
      highlights: coerceStringArray(row.highlights),
      entitlements: coerceStringArray(row.entitlementKeys),
      recommended: row.recommended === true,
      rank,
    });
  }

  plans.sort((a, b) => a.rank - b.rank);
  return plans;
}
