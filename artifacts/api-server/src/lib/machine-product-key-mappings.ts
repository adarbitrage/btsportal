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
];

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
  /** True iff the resolver fell back to the legacy ["yse_front_end"] grant. */
  usedFallback: boolean;
}

/**
 * Resolve a Machine `portal_product_keys` array onto Portal product slugs
 * using the admin-editable mapping table.
 *
 * Backward-compat fallback: if the resolved set is empty (no input keys, or
 * every input key was unknown), return ["yse_front_end"] so we preserve the
 * pre-#493 behaviour of always granting at least the front-end product. This
 * keeps the 201 / 200-merge / 200-deduped wire contract intact for senders
 * that haven't started emitting `portal_product_keys` yet.
 */
export function resolveMachineProductKeys(
  inputKeys: readonly string[],
  mappings: ReadonlyMap<string, string>,
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
    return {
      portalSlugs: ["yse_front_end"],
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
