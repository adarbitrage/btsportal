/**
 * Storage and retrieval for the tenant-facing portal base URL used to build
 * branded links sent to members (e.g. the "Start a new email change" CTA in
 * the admin-cancellation email).
 *
 * Each tenant's portal lives at a different domain (e.g.
 * `portal.acme.example`, `members.foo.example`), so a single global env-var
 * default isn't safe — it would email one tenant's members a link to another
 * tenant's portal. This module sources the value, in order of preference:
 *
 *   1. `system_settings` row at key `branding.portal_url` (the per-tenant
 *      override an admin can save from the Settings UI).
 *   2. `process.env.PORTAL_URL` (the operational fallback for deployments
 *      that haven't migrated to the DB-backed setting yet).
 *   3. `http://localhost:5000` — but ONLY when `NODE_ENV !== "production"`,
 *      so unit tests / `pnpm dev` keep working without manual setup. In
 *      production the function returns `null` if neither (1) nor (2) is set,
 *      and callers are expected to skip emails that need a portal link
 *      rather than ship a broken `https://portal.buildtestscale.com` URL
 *      to a tenant on a completely different domain.
 *
 * Saves are validated to require an absolute http/https URL — the value is
 * pasted into emails and we don't want to ship `javascript:` payloads or
 * relative paths. A short in-process cache (~10s) keeps the per-cancel read
 * off the hot path; the writer invalidates the cache synchronously.
 */

import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const PORTAL_URL_SETTING_KEY = "branding.portal_url" as const;

const ENV_VAR = "PORTAL_URL" as const;

const CATEGORY = "branding" as const;

const DESCRIPTION =
  "Per-tenant portal base URL used to build branded links in member emails (e.g. the restart-email-change CTA in admin cancellation notices). Must be an absolute http/https URL.";

// Local-dev convenience default. Intentionally NOT a production-looking host
// so a misconfigured prod deployment doesn't silently ship a real URL that
// happens to point somewhere wrong.
const DEV_DEFAULT = "http://localhost:5000";

export type PortalUrlSource = "db" | "env" | "dev_default";

export interface PortalUrlStatus {
  /** The resolved portal URL, or null if nothing is configured. */
  portalUrl: string | null;
  /** Where the resolved value came from, or null when nothing is set. */
  source: PortalUrlSource | null;
}

interface CachedStatus {
  loadedAt: number;
  status: PortalUrlStatus;
}

const CACHE_TTL_MS = 10 * 1000;
let cached: CachedStatus | null = null;

export function __invalidatePortalUrlCacheForTests(): void {
  cached = null;
}

export function isPortalUrlSettingKey(key: string): boolean {
  return key === PORTAL_URL_SETTING_KEY;
}

/**
 * Validate that `value` is an absolute http(s) URL. Trims trailing slashes
 * for storage so callers don't have to think about whether to append one.
 * Returns either the normalized URL or an error message describing the
 * specific failure (so the route can surface it to the admin).
 */
export function normalizePortalUrl(
  value: unknown,
): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "Portal URL must be a string" };
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return { ok: false, error: "Portal URL must not be empty" };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Portal URL must be an absolute URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Portal URL must use http or https" };
  }
  if (!parsed.host) {
    return { ok: false, error: "Portal URL must include a host" };
  }
  // Strip trailing slashes to keep stored values canonical. We don't strip
  // path/query/fragment — a tenant might genuinely host their portal at a
  // sub-path and we should preserve that.
  const normalized = trimmed.replace(/\/+$/, "");
  return { ok: true, url: normalized };
}

function readEnv(): string | null {
  const raw = process.env[ENV_VAR];
  if (!raw || raw.trim() === "") return null;
  const normalized = normalizePortalUrl(raw);
  if (!normalized.ok) {
    console.error(
      `[PortalUrlSettings] Ignoring invalid ${ENV_VAR} env var: ${normalized.error}`,
    );
    return null;
  }
  return normalized.url;
}

async function readDb(): Promise<string | null> {
  const [row] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY))
    .limit(1);
  if (!row) return null;
  // The generic settings endpoint stores arbitrary jsonb. We accept either
  // a bare JSON string ("https://...") or a `{ url: "..." }` wrapper so the
  // dedicated setter (below) and the generic endpoint can both write here
  // without confusing the read path.
  const raw = row.value;
  let candidate: unknown;
  if (typeof raw === "string") {
    candidate = raw;
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    candidate = (raw as Record<string, unknown>).url;
  } else {
    candidate = null;
  }
  const normalized = normalizePortalUrl(candidate);
  if (!normalized.ok) {
    console.error(
      `[PortalUrlSettings] Ignoring invalid ${PORTAL_URL_SETTING_KEY} row: ${normalized.error}`,
    );
    return null;
  }
  return normalized.url;
}

/**
 * Resolve the portal URL with provenance. Falls back from DB → env → dev
 * default → null exactly as documented at the top of the file. A bad row
 * (wrong type, malformed URL) is treated as "not set" so a single corrupt
 * setting cannot silently disable every cancellation email.
 *
 * Result is cached for `CACHE_TTL_MS`. The writer invalidates the cache
 * synchronously, so an admin save is reflected on the very next read.
 */
export async function getPortalUrlStatus(): Promise<PortalUrlStatus> {
  const now = Date.now();
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.status;
  }
  let dbValue: string | null = null;
  try {
    dbValue = await readDb();
  } catch (err) {
    // Degrade to env / dev default rather than block the cancellation
    // notification when the settings table is unreachable.
    console.error("[PortalUrlSettings] Failed to load portal URL from DB:", err);
  }
  let status: PortalUrlStatus;
  if (dbValue) {
    status = { portalUrl: dbValue, source: "db" };
  } else {
    const envValue = readEnv();
    if (envValue) {
      status = { portalUrl: envValue, source: "env" };
    } else if (process.env.NODE_ENV !== "production") {
      status = { portalUrl: DEV_DEFAULT, source: "dev_default" };
    } else {
      status = { portalUrl: null, source: null };
    }
  }
  cached = { loadedAt: now, status };
  return status;
}

/**
 * Convenience accessor for callers that only need the resolved URL. Returns
 * `null` when nothing is configured in production — callers are expected to
 * gracefully skip the link/email rather than ship a wrong-tenant URL.
 */
export async function getPortalUrl(): Promise<string | null> {
  return (await getPortalUrlStatus()).portalUrl;
}

/**
 * Persist the per-tenant portal URL. Returns the normalized stored value or
 * an error describing why the input was rejected. Pass `null` to delete the
 * row so the read path falls back to the env / dev default.
 */
export async function setPortalUrl(
  value: string | null,
  updatedBy: string | null,
): Promise<{ ok: true; portalUrl: string | null } | { ok: false; error: string }> {
  if (value === null) {
    await db
      .delete(systemSettingsTable)
      .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
    cached = null;
    return { ok: true, portalUrl: null };
  }
  const normalized = normalizePortalUrl(value);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }
  const existing = await db
    .select({ id: systemSettingsTable.id })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(systemSettingsTable)
      .set({ value: normalized.url, updatedBy: updatedBy ?? undefined })
      .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
  } else {
    await db.insert(systemSettingsTable).values({
      key: PORTAL_URL_SETTING_KEY,
      value: normalized.url,
      category: CATEGORY,
      description: DESCRIPTION,
      updatedBy: updatedBy ?? undefined,
    });
  }
  cached = null;
  return { ok: true, portalUrl: normalized.url };
}
