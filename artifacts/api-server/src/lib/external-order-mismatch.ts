/**
 * Shared helpers for deciding whether an external-integration order's
 * actually-granted products line up with what the upstream told us to
 * grant. Originally lived inside `routes/admin-panel.ts` next to the
 * `/admin/integrations/yse/orders` endpoint (task #492) but is now also
 * consumed by the background mismatch alerter (task #494) which can't
 * import from a route module without dragging in the whole express app
 * surface at startup.
 *
 * Keep the two consumers in sync: any heuristic change here flows into
 * both the admin UI (per-row flag + page summary + CSV export) and the
 * on-call page volume, so changes should be deliberate.
 */

// portal_product_keys comes back from SQL as a JSON-array-shaped text (we
// have to cast jsonb → text to use max() over it). Defensively parse: bad
// or missing values collapse to [] rather than throwing.
export function parsePortalProductKeys(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.filter((k): k is string => typeof k === "string");
  }
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((k): k is string => typeof k === "string")
      : [];
  } catch {
    return [];
  }
}

// A Machine order "mismatches" when the set of product slugs we actually
// granted doesn't equal the set of portal_product_keys The Machine told us
// to grant — either we missed one (under-grant) or granted something extra
// (over-grant). Only meaningful when:
//   - source is "machine" (other sources don't send portal_product_keys), AND
//   - portal_product_keys was captured on the webhook (pre-task-491 rows
//     have nothing to compare against and stay "not flagged").
export function computeOrderMismatch(
  externalSource: string,
  grantedSlugs: string[],
  portalProductKeys: string[],
): boolean {
  if (externalSource !== "machine") return false;
  if (portalProductKeys.length === 0) return false;
  const granted = new Set(grantedSlugs.filter((s) => !!s));
  const expected = new Set(portalProductKeys);
  if (granted.size !== expected.size) return true;
  for (const s of granted) if (!expected.has(s)) return true;
  for (const k of expected) if (!granted.has(k)) return true;
  return false;
}
