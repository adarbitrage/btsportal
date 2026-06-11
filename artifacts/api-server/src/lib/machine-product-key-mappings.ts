import {
  db,
  machineProductKeyMappingsTable,
  machineUnknownProductKeysTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";

// Default mappings seeded at startup. These reflect the agreed-upon
// translation captured during the two-week joint audit between the Portal
// and Machine teams (see task #493). New keys discovered after launch land
// in `machine_unknown_product_keys` and admins extend the mapping via the
// admin panel — there's no need to ship a code change to add a new key.
//
// `machine_key` is the snake_case-ish identifier The Machine sends in
// `portal_product_keys`. `portal_slug` is the row in `products.slug` the
// grant pipeline should resolve to.
export const DEFAULT_MACHINE_PRODUCT_KEY_MAPPINGS: ReadonlyArray<{
  machineKey: string;
  portalSlug: string;
  notes: string;
}> = [
  {
    machineKey: "yse_front_end",
    portalSlug: "yse_front_end",
    notes: "Front-end YSE offer ($67). Always granted by default.",
  },
  {
    machineKey: "yse_affiliate_cmo_bump",
    portalSlug: "yse_affiliate_cmo_bump",
    notes: "Affiliate CMO bump ($47). Verbatim Machine→Portal slug.",
  },
  {
    machineKey: "yse_cmo_bump",
    portalSlug: "yse_affiliate_cmo_bump",
    notes: "Short alias the Machine team uses for the CMO bump upsell.",
  },
  {
    machineKey: "yse_21_day_blitz",
    portalSlug: "yse_21_day_blitz",
    notes: "21-Day Blitz backend upsell ($297).",
  },
  {
    machineKey: "yse_swipe_resource_bank",
    portalSlug: "yse_swipe_resource_bank",
    notes: "Swipe Resource Bank front-end upsell ($97).",
  },
  {
    machineKey: "yse_profit_maximizer",
    portalSlug: "yse_profit_maximizer_pass",
    notes: "Profit Maximizer Pass ($97).",
  },
  {
    machineKey: "yse_profit_maximizer_pass",
    portalSlug: "yse_profit_maximizer_pass",
    notes: "Profit Maximizer Pass ($97). Verbatim Machine→Portal slug.",
  },
  // ── Machine front-end brand products (identity mapping: key = slug) ──────
  {
    machineKey: "backroad",
    portalSlug: "backroad",
    notes: "Backroad System front-end offer. Identity mapping per Dispatch 2.",
  },
  {
    machineKey: "offmarket",
    portalSlug: "offmarket",
    notes: "Off-Market Affiliate front-end offer. Identity mapping per Dispatch 2.",
  },
  {
    machineKey: "reserve_income",
    portalSlug: "reserve_income",
    notes: "Reserve Income front-end offer. Identity mapping per Dispatch 2.",
  },
  {
    machineKey: "silent_partner",
    portalSlug: "silent_partner",
    notes: "Silent Partner front-end offer. Identity mapping per Dispatch 2.",
  },
  {
    machineKey: "test_like_mad",
    portalSlug: "test_like_mad",
    notes: "Test Like Mad front-end offer. Identity mapping per Dispatch 2.",
  },
];

/**
 * Canonical funnel-slug → Portal product slug mapping covering all 13 accepted
 * Machine funnel slugs (12 verbatim from Dispatch 2 + the legacy
 * "your-second-engine" slug).  YSE funnels → "yse_front_end"; each brand's
 * two funnels → that brand's portal product slug.
 *
 * This map is the single source of truth for funnel-derived fallback grants:
 * when `portal_product_keys` resolve to an empty set, the receiver uses this
 * map to derive the correct product from `funnel_slug` instead of always
 * falling back to "yse_front_end".
 *
 * Drift guard: every slug accepted by the MACHINE_FUNNEL_SLUGS validator in
 * integrations.ts MUST have exactly one entry here. The guard test in
 * machine-product-key-mappings.test.ts enforces this at CI time.
 */
export const FUNNEL_SLUG_TO_PRODUCT: Readonly<Record<string, string>> = {
  "yse-workshop": "yse_front_end",
  "yse-ebook": "yse_front_end",
  "your-second-engine": "yse_front_end",
  "backroad-system-workshop": "backroad",
  "backroad-system-ebook": "backroad",
  "off-market-affiliate-workshop": "offmarket",
  "off-market-affiliate-ebook": "offmarket",
  "reserve-income-workshop": "reserve_income",
  "reserve-income-ebook": "reserve_income",
  "silent-partner-workshop": "silent_partner",
  "silent-partner-ebook": "silent_partner",
  "test-like-mad-workshop": "test_like_mad",
  "test-like-mad-ebook": "test_like_mad",
};

/**
 * Insert the default mapping rows if they're missing. Idempotent: existing
 * rows are left as-is so admin edits are never clobbered on a restart.
 * Safe to call on every cold start.
 */
export async function seedMachineProductKeyMappings(): Promise<void> {
  if (DEFAULT_MACHINE_PRODUCT_KEY_MAPPINGS.length === 0) return;
  await db
    .insert(machineProductKeyMappingsTable)
    .values(
      DEFAULT_MACHINE_PRODUCT_KEY_MAPPINGS.map((m) => ({
        machineKey: m.machineKey,
        portalSlug: m.portalSlug,
        notes: m.notes,
        updatedBy: "system:bootstrap",
      })),
    )
    .onConflictDoNothing({
      target: machineProductKeyMappingsTable.machineKey,
    });
}

/**
 * Return the current Machine-key → Portal-slug mapping as a Map for fast
 * lookups. Always reads from the DB so admin edits take effect on the next
 * webhook delivery without a process restart. Volume is tiny (one row per
 * known Machine product key) so caching isn't worth the consistency hazard.
 */
export async function getMachineProductKeyMappings(): Promise<
  Map<string, string>
> {
  const rows = await db
    .select({
      machineKey: machineProductKeyMappingsTable.machineKey,
      portalSlug: machineProductKeyMappingsTable.portalSlug,
    })
    .from(machineProductKeyMappingsTable);
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.machineKey, r.portalSlug);
  return map;
}

export interface MachineKeyResolution {
  /** The Portal product slugs to grant, deduped and in input order. */
  portalSlugs: string[];
  /** Machine keys that have no mapping row — captured for admin review. */
  unknownKeys: string[];
  /** True iff the resolver fell back to a derived/legacy grant. */
  usedFallback: boolean;
}

/**
 * Resolve a Machine `portal_product_keys` array onto Portal product slugs
 * using the admin-editable mapping table.
 *
 * Fallback behaviour: if the resolved set is empty (no input keys, or every
 * input key was unknown), derive the fallback product from `funnelSlug` via
 * FUNNEL_SLUG_TO_PRODUCT. This ensures brand buyers always receive their own
 * product instead of "yse_front_end". Only genuine YSE funnels fall back to
 * "yse_front_end". When no funnelSlug is provided (e.g. in pure unit tests),
 * "yse_front_end" is used as the ultimate backstop.
 *
 * This keeps the 201 / 200-merge / 200-deduped wire contract intact for
 * senders that haven't started emitting `portal_product_keys` yet.
 */
export function resolveMachineProductKeys(
  inputKeys: readonly string[],
  mappings: ReadonlyMap<string, string>,
  funnelSlug?: string,
): MachineKeyResolution {
  const portalSlugs: string[] = [];
  const seen = new Set<string>();
  const unknownKeys: string[] = [];
  const seenUnknown = new Set<string>();

  for (const key of inputKeys) {
    const slug = mappings.get(key);
    if (slug) {
      if (!seen.has(slug)) {
        seen.add(slug);
        portalSlugs.push(slug);
      }
    } else if (!seenUnknown.has(key)) {
      seenUnknown.add(key);
      unknownKeys.push(key);
    }
  }

  if (portalSlugs.length === 0) {
    const fallbackSlug =
      (funnelSlug !== undefined ? FUNNEL_SLUG_TO_PRODUCT[funnelSlug] : undefined) ??
      "yse_front_end";
    return {
      portalSlugs: [fallbackSlug],
      unknownKeys,
      usedFallback: true,
    };
  }

  return { portalSlugs, unknownKeys, usedFallback: false };
}

/**
 * Persist a batch of unknown Machine keys to the surfaced-to-admins table.
 * Each row is upserted on (machine_key): occurrences bumps by 1 and the
 * "last seen" columns advance. Failures are swallowed and logged — the
 * grant flow must succeed even if this audit-trail write fails.
 */
export async function recordUnknownMachineProductKeys(
  keys: readonly string[],
  externalSource: string,
  externalOrderId: string,
): Promise<void> {
  if (keys.length === 0) return;
  try {
    await db
      .insert(machineUnknownProductKeysTable)
      .values(
        keys.map((k) => ({
          machineKey: k,
          occurrences: 1,
          lastExternalOrderId: externalOrderId,
          lastExternalSource: externalSource,
        })),
      )
      .onConflictDoUpdate({
        target: machineUnknownProductKeysTable.machineKey,
        set: {
          occurrences: sql`${machineUnknownProductKeysTable.occurrences} + 1`,
          lastSeenAt: new Date(),
          lastExternalOrderId: externalOrderId,
          lastExternalSource: externalSource,
          dismissedAt: null,
          dismissedBy: null,
        },
      });
  } catch (err) {
    console.error(
      "[MachineProductKeyMappings] Failed to record unknown keys:",
      err,
    );
  }
}
