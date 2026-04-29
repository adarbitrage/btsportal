import { db, productsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

// Static, non-editable presentation metadata for the public /plans page.
// These attributes (tagline, highlights, the "recommended" flag, the upgrade
// rank, and the human-readable durationLabel) are not stored in the
// `products` table because the admin product editor does not currently let
// admins change them. The plan name, priceDisplay, durationDays, and
// entitlement keys all come from the DB so admin product edits propagate to
// /plans automatically.
//
// Only slugs listed here are surfaced as upgradeable plans; front-end-only
// products (e.g. reserve_income, backroad, offmarket) are intentionally
// omitted.
export type PlanStaticMetadata = {
  tagline: string;
  durationLabel: string;
  highlights: string[];
  recommended?: boolean;
  rank: number;
};

export const PLAN_STATIC_METADATA: Record<string, PlanStaticMetadata> = {
  launchpad: {
    tagline: "Get the BTS app suite and start building.",
    durationLabel: "One-time",
    rank: 1,
    highlights: [
      "Full BTS app suite",
      "Compliance review submissions",
      "Standard support",
      "Full chat assistant access",
    ],
  },
  "3month": {
    tagline: "Group coaching, community, and commissions kick in.",
    durationLabel: "90 days",
    rank: 2,
    highlights: [
      "Everything in LaunchPad",
      "Live group coaching calls",
      "Member community access",
      "Entry-tier commissions",
      "Enhanced support",
    ],
  },
  "6month": {
    tagline: "Expanded software and mastermind coaching.",
    durationLabel: "180 days",
    rank: 3,
    highlights: [
      "Everything in 3-Month",
      "Expanded software access",
      "Mastermind coaching",
      "Mid-tier commissions",
      "Unlimited support",
    ],
  },
  "1year": {
    tagline: "Adds private monthly 1-on-1 coaching.",
    durationLabel: "365 days",
    rank: 4,
    recommended: true,
    highlights: [
      "Everything in 6-Month",
      "Monthly 1-on-1 coaching",
      "Premium-tier commissions",
      "Unlimited support",
    ],
  },
  lifetime: {
    tagline: "Weekly 1-on-1 coaching and lifetime access.",
    durationLabel: "Lifetime",
    rank: 5,
    highlights: [
      "Everything in 1-Year",
      "Weekly 1-on-1 coaching",
      "Top-tier commissions",
      "VIP support",
      "Custom chat assistant",
      "No expiration",
    ],
  },
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

// Coerce the JSONB `entitlement_keys` column into a string[]. The column is
// stored as a JSON array but Drizzle types it as `unknown` since we use
// `jsonb().default([])` without a generic. Anything that isn't an array of
// strings (e.g. a corrupted row) is dropped rather than thrown over so the
// public /plans endpoint never 500s on bad seed data.
function coerceEntitlements(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

export async function listUpgradeablePlans(): Promise<Plan[]> {
  const slugs = Object.keys(PLAN_STATIC_METADATA);
  if (slugs.length === 0) return [];

  const rows = await db
    .select({
      slug: productsTable.slug,
      name: productsTable.name,
      priceDisplay: productsTable.priceDisplay,
      durationDays: productsTable.durationDays,
      entitlementKeys: productsTable.entitlementKeys,
    })
    .from(productsTable)
    .where(inArray(productsTable.slug, slugs));

  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const plans: Plan[] = [];
  for (const slug of slugs) {
    const meta = PLAN_STATIC_METADATA[slug];
    const row = bySlug.get(slug);
    if (!row) continue;
    plans.push({
      slug,
      name: row.name,
      tagline: meta.tagline,
      priceDisplay: row.priceDisplay,
      durationDays: row.durationDays,
      durationLabel: meta.durationLabel,
      highlights: meta.highlights,
      entitlements: coerceEntitlements(row.entitlementKeys),
      recommended: meta.recommended ?? false,
      rank: meta.rank,
    });
  }

  plans.sort((a, b) => a.rank - b.rank);
  return plans;
}
