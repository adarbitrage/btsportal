const GHL_AUTH_BASE = "https://services.msgsndr.com";
const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

export const FLEXY_PORTAL_URL = process.env.FLEXY_PORTAL_URL ?? "https://dashboard.getflexy.app";
export const FLEXY_SNAPSHOT_ID = process.env.GHL_FLEXY_SNAPSHOT_ID ?? "";

interface AgencyJwt {
  apiKey: string;
  firebaseToken?: string;
  userId?: string;
  companyId: string;
}

let cachedJwt: AgencyJwt | null = null;

function decodeAgencyJwt(): AgencyJwt {
  if (cachedJwt) return cachedJwt;
  const raw = process.env.GHL_CHERRINGTON_AGENCY_JWT;
  if (!raw) {
    throw new Error(
      "GHL_CHERRINGTON_AGENCY_JWT is not configured. Set it to the base64-encoded JSON {apiKey, firebaseToken, userId, companyId} from your Flexy/Cherrington agency dashboard.",
    );
  }
  let json: string;
  try {
    json = Buffer.from(raw, "base64").toString("utf8");
  } catch {
    throw new Error("GHL_CHERRINGTON_AGENCY_JWT is not valid base64");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("GHL_CHERRINGTON_AGENCY_JWT did not decode to valid JSON");
  }
  const obj = parsed as Partial<AgencyJwt>;
  if (!obj || typeof obj.apiKey !== "string" || typeof obj.companyId !== "string") {
    throw new Error("GHL_CHERRINGTON_AGENCY_JWT JSON must include `apiKey` and `companyId`");
  }
  cachedJwt = {
    apiKey: obj.apiKey,
    companyId: obj.companyId,
    firebaseToken: obj.firebaseToken,
    userId: obj.userId,
  };
  return cachedJwt;
}

// ---------------------------------------------------------------------------
// OAuth token cache
// ---------------------------------------------------------------------------

interface TokenEntry {
  accessToken: string;
  refreshToken: string | null;
  locationId: string | null;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenEntry>();
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min before expiry

const COMPANY_SCOPE =
  "companies.readonly locations.readonly locations.write users.readonly users.write";

function getOAuthClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GHL_CHERRINGTON_CLIENT_ID;
  const clientSecret = process.env.GHL_CHERRINGTON_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GHL_CHERRINGTON_CLIENT_ID and GHL_CHERRINGTON_CLIENT_SECRET must be configured to mint GHL access tokens",
    );
  }
  return { clientId, clientSecret };
}

/**
 * Mint a GHL JWT access token for the given scope using the two-step
 * private OAuth flow:
 *   1. POST /oauth/authorize on services.msgsndr.com with the agency apiKey
 *      to get an authorization code.
 *   2. POST /oauth/token on services.leadconnectorhq.com to exchange it for
 *      a real JWT access token.
 */
async function mintAccessToken(
  scope: "company" | { location: string },
): Promise<{ accessToken: string; refreshToken: string | null; locationId: string | null; expiresIn: number }> {
  const { apiKey, companyId } = decodeAgencyJwt();
  const { clientId, clientSecret } = getOAuthClientCredentials();

  // Build the authorize URL query string. `redirect_uri` is required by GHL's
  // private OAuth endpoint even though no actual redirect happens — the code
  // is returned in the JSON response. Any valid URL works.
  const params = new URLSearchParams({
    client_id: clientId,
    company_id: companyId,
    response_type: "code",
    redirect_uri: process.env.GHL_OAUTH_REDIRECT_URI ?? "https://theinvisibleaffiliate.com",
    scope: COMPANY_SCOPE,
  });
  if (scope === "company") {
    params.set("userType", "Company");
  } else {
    params.set("userType", "Location");
    params.set("location_id", scope.location);
  }

  const authorizeUrl = `${GHL_AUTH_BASE}/oauth/authorize?${params.toString()}`;
  console.log(`[GHLAgency] Minting OAuth code via POST ${GHL_AUTH_BASE}/oauth/authorize`);

  const authorizeRes = await fetch(authorizeUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (!authorizeRes.ok) {
    const text = await authorizeRes.text();
    if (authorizeRes.status === 401 || authorizeRes.status === 403) {
      throw new Error(
        `Flexy agency token rejected by GHL — refresh \`GHL_CHERRINGTON_AGENCY_JWT\` \`apiKey\` (authorize HTTP ${authorizeRes.status}: ${text})`,
      );
    }
    throw new Error(
      `GHL OAuth authorize failed: HTTP ${authorizeRes.status} — ${text}`,
    );
  }

  const authorizeData = (await authorizeRes.json()) as {
    redirectUrl?: string;
    code?: string;
  };

  let code: string | null = null;
  if (typeof authorizeData.code === "string" && authorizeData.code) {
    code = authorizeData.code;
  } else if (typeof authorizeData.redirectUrl === "string") {
    try {
      const redirectUrl = new URL(authorizeData.redirectUrl);
      code = redirectUrl.searchParams.get("code");
    } catch {
      // fall through — code remains null
    }
  }

  if (!code) {
    throw new Error(
      `GHL OAuth authorize did not return a code: ${JSON.stringify(authorizeData)}`,
    );
  }

  // Exchange the authorization code for an access token
  console.log(`[GHLAgency] Exchanging OAuth code for access token`);
  const tokenRes = await fetch(`${GHL_API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    if (tokenRes.status === 401 || tokenRes.status === 403) {
      throw new Error(
        `Flexy agency token rejected by GHL — refresh \`GHL_CHERRINGTON_AGENCY_JWT\` \`apiKey\` (token exchange HTTP ${tokenRes.status}: ${text})`,
      );
    }
    throw new Error(
      `GHL OAuth token exchange failed: HTTP ${tokenRes.status} — ${text}`,
    );
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    locationId?: string;
  };

  if (!tokenData.access_token) {
    throw new Error(
      `GHL OAuth token exchange returned no access_token: ${JSON.stringify(tokenData)}`,
    );
  }

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    locationId: tokenData.locationId ?? null,
    expiresIn: typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600,
  };
}

/**
 * Resolve a valid GHL JWT access token for the given scope, using the
 * in-memory cache and re-minting when the token is about to expire.
 */
async function resolveAccessToken(
  scope: "company" | { location: string },
): Promise<string> {
  const cacheKey = scope === "company" ? "company" : `location:${scope.location}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > TOKEN_SAFETY_MARGIN_MS) {
    return cached.accessToken;
  }

  const { accessToken, refreshToken, locationId, expiresIn } = await mintAccessToken(scope);
  tokenCache.set(cacheKey, {
    accessToken,
    refreshToken,
    locationId,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  console.log(
    `[GHLAgency] Minted new access token for scope="${cacheKey}" (expires in ${expiresIn}s, locationId=${locationId ?? "n/a"})`,
  );
  return accessToken;
}

// ---------------------------------------------------------------------------
// Core request helper
// ---------------------------------------------------------------------------

async function ghlAgencyRequestOnce<T = unknown>(
  method: string,
  path: string,
  accessToken: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; text: string; data: T }> {
  const url = `${GHL_API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body && method !== "GET" ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, text, data: data as T };
}

async function ghlAgencyRequest<T = unknown>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  console.log(`[GHLAgency] ${method} ${GHL_API_BASE}${path}`);
  let accessToken = await resolveAccessToken("company");
  let result = await ghlAgencyRequestOnce<T>(method, path, accessToken, body);

  if (!result.ok && result.status === 401) {
    // Token may have been invalidated server-side — evict cache and retry once
    console.warn(`[GHLAgency] 401 on ${method} ${path}; evicting token and retrying`);
    tokenCache.delete("company");
    accessToken = await resolveAccessToken("company");
    result = await ghlAgencyRequestOnce<T>(method, path, accessToken, body);
    if (!result.ok && result.status === 401) {
      throw new Error(
        `Flexy agency token rejected by GHL — refresh \`GHL_CHERRINGTON_AGENCY_JWT\` \`apiKey\` (GHL ${method} ${path} HTTP 401: ${result.text})`,
      );
    }
  }

  if (!result.ok) {
    throw new Error(`GHL ${method} ${path} failed: HTTP ${result.status} — ${result.text}`);
  }
  return result.data;
}

export function getAgencyCompanyId(): string {
  return decodeAgencyJwt().companyId;
}

export interface CreateLocationInput {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  timezone?: string;
}

export async function createLocation(input: CreateLocationInput): Promise<string> {
  // NOTE: do NOT reuse locations by display name. Two members may legitimately
  // share a name (e.g. "John Smith"), and reusing a location across members
  // would break tenant isolation. Member-scoped idempotency lives in the DB
  // (providerLocationId on member_app_instances) — callers must not invoke
  // createLocation when a providerLocationId is already persisted.
  if (!FLEXY_SNAPSHOT_ID) {
    throw new Error("GHL_FLEXY_SNAPSHOT_ID is not configured");
  }
  const { companyId } = decodeAgencyJwt();
  const body: Record<string, unknown> = {
    companyId,
    name: input.name,
    timezone: input.timezone ?? "US/Central",
    prospectInfo: {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
    },
    snapshotId: FLEXY_SNAPSHOT_ID,
  };
  const data = await ghlAgencyRequest<{ id?: string; location?: { id?: string } }>(
    "POST",
    "/locations/",
    body,
  );
  const id = data.id ?? data.location?.id;
  if (!id) throw new Error(`GHL createLocation returned no id: ${JSON.stringify(data)}`);
  return id;
}

interface GhlUser {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  roles?: { locationIds?: string[] };
  locationIds?: string[];
}

function getUserLocationIds(u: GhlUser): string[] {
  return u.roles?.locationIds ?? u.locationIds ?? [];
}

/**
 * Look up a GHL user by email at the agency (company) level. Mirrors the
 * legacy plugin's `getUserByEmail` — needed because a member's email may
 * already exist as a staff user on a previously deleted/abandoned location.
 */
export async function findExistingStaffUser(
  email: string,
  _locationId: string,
): Promise<string | null> {
  const { companyId } = decodeAgencyJwt();
  try {
    const data = await ghlAgencyRequest<{ users?: GhlUser[] }>(
      "GET",
      `/users/search?companyId=${encodeURIComponent(companyId)}&query=${encodeURIComponent(email)}`,
    );
    const match = (data.users ?? []).find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    return match?.id ?? null;
  } catch (err) {
    console.warn("[GHLAgency] findExistingStaffUser lookup failed:", err);
    return null;
  }
}

export interface CreateStaffUserInput {
  locationId: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export async function createStaffUser(input: CreateStaffUserInput): Promise<string> {
  const { companyId } = decodeAgencyJwt();
  const body: Record<string, unknown> = {
    companyId,
    type: "account",
    role: "admin",
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    password: input.password,
    locationIds: [input.locationId],
  };
  const data = await ghlAgencyRequest<{ id?: string; user?: { id?: string } }>(
    "POST",
    "/users/",
    body,
  );
  const id = data.id ?? data.user?.id;
  if (!id) throw new Error(`GHL createStaffUser returned no id: ${JSON.stringify(data)}`);
  return id;
}

async function getStaffUser(userId: string): Promise<GhlUser> {
  const data = await ghlAgencyRequest<{ id?: string; user?: GhlUser } & GhlUser>(
    "GET",
    `/users/${encodeURIComponent(userId)}`,
  );
  const u = (data.user ?? (data as GhlUser)) as GhlUser;
  if (!u || !u.id) {
    throw new Error(`GHL getStaffUser returned no user: ${JSON.stringify(data)}`);
  }
  return u;
}

/**
 * Public read-only accessor for a staff user record. Used by the live
 * provisioning verification script to confirm role + locationIds after each
 * install/uninstall step. Returns `null` if the user no longer exists (e.g.
 * full delete after their last location was removed).
 */
export async function getStaffUserPublic(staffUserId: string): Promise<{
  id: string;
  email?: string;
  type?: string;
  role?: string;
  roles?: { type?: string; role?: string; locationIds?: string[] };
  locationIds: string[];
} | null> {
  try {
    const data = await ghlAgencyRequest<
      { id?: string; user?: GhlUser } & GhlUser & {
          type?: string;
          role?: string;
          roles?: { type?: string; role?: string; locationIds?: string[] };
        }
    >("GET", `/users/${encodeURIComponent(staffUserId)}`);
    const u = (data.user ?? data) as GhlUser & {
      type?: string;
      role?: string;
      roles?: { type?: string; role?: string; locationIds?: string[] };
    };
    if (!u || !u.id) return null;
    return {
      id: u.id,
      email: u.email,
      type: u.type ?? u.roles?.type,
      role: u.role ?? u.roles?.role,
      roles: u.roles,
      locationIds: getUserLocationIds(u),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("HTTP 404")) return null;
    throw err;
  }
}

/**
 * Look up agency sub-accounts whose `name` exactly matches `name`. Used by
 * the verification script to confirm that reinstall does NOT create a
 * duplicate `Flexy - {member name}` location. Returns the matched ids and
 * names (case-insensitive exact match on the trimmed name).
 *
 * GHL's `/locations/search` returns a `locations` array; we filter
 * client-side because the `query` param matches loosely.
 */
export async function searchAgencyLocationsByName(
  name: string,
): Promise<Array<{ id: string; name: string }>> {
  const { companyId } = decodeAgencyJwt();
  const target = name.trim().toLowerCase();
  const params = new URLSearchParams({
    companyId,
    query: name,
    limit: "100",
  });
  const data = await ghlAgencyRequest<{
    locations?: Array<{ id?: string; name?: string }>;
  }>("GET", `/locations/search?${params.toString()}`);
  return (data.locations ?? [])
    .filter((l): l is { id: string; name: string } =>
      typeof l.id === "string" &&
      typeof l.name === "string" &&
      l.name.trim().toLowerCase() === target,
    )
    .map((l) => ({ id: l.id, name: l.name }));
}

/**
 * Non-destructive disable: removes the staff user from the given location so
 * they can no longer log in to it. Other location memberships (if any) are
 * preserved. Throws on failure so callers can surface the problem instead of
 * silently marking the app as uninstalled while access lingers.
 */
export async function disableStaffUserForLocation(
  staffUserId: string,
  locationId: string,
): Promise<void> {
  const { companyId } = decodeAgencyJwt();
  const user = await getStaffUser(staffUserId);
  const remaining = getUserLocationIds(user).filter((id) => id !== locationId);
  if (remaining.length === 0) {
    // GHL rejects PUT /users with an empty locationIds array. When this was
    // the user's only location, delete the staff record outright so they
    // truly lose access on uninstall.
    await ghlAgencyRequest(
      "DELETE",
      `/users/${encodeURIComponent(staffUserId)}?companyId=${encodeURIComponent(companyId)}`,
    );
    return;
  }
  await ghlAgencyRequest("PUT", `/users/${encodeURIComponent(staffUserId)}`, {
    companyId,
    locationIds: remaining,
  });
}

/**
 * Inverse of disableStaffUserForLocation: re-grants the staff user access to
 * the given location. Used on reinstall so the same staff record (preserving
 * audit history) becomes active again.
 */
export async function reactivateStaffUserForLocation(
  staffUserId: string,
  locationId: string,
): Promise<void> {
  const { companyId } = decodeAgencyJwt();
  const user = await getStaffUser(staffUserId);
  const ids = new Set(getUserLocationIds(user));
  if (ids.has(locationId)) return;
  ids.add(locationId);
  await ghlAgencyRequest("PUT", `/users/${encodeURIComponent(staffUserId)}`, {
    companyId,
    locationIds: [...ids],
  });
}

export async function updateStaffUserPassword(
  staffUserId: string,
  newPassword: string,
): Promise<void> {
  const { companyId } = decodeAgencyJwt();
  await ghlAgencyRequest("PUT", `/users/${encodeURIComponent(staffUserId)}`, {
    companyId,
    password: newPassword,
  });
}

export function locationExists(locationId: string): Promise<boolean> {
  return ghlAgencyRequest<{ id?: string; location?: { id?: string } }>(
    "GET",
    `/locations/${encodeURIComponent(locationId)}`,
  )
    .then((d) => !!(d.id ?? d.location?.id))
    .catch(() => false);
}

// ---------------------------------------------------------------------------
// One-time SSO login URL minting
// ---------------------------------------------------------------------------
//
// GHL's white-label SaaS dashboard has a "log in as user" feature in the
// agency UI. We hoped to reuse that to drop members straight into Flexy
// without showing the email/password screen.
//
// Verification (Apr 2026, see docs/flexy-sso-verification.md):
//   - Probed every plausible path with a real installed staff user against
//     the live Cherrington agency. All variants on
//     `services.leadconnectorhq.com` (Marketplace API v2021-07-28),
//     `services.msgsndr.com` (legacy app backend),
//     `backend.leadconnectorhq.com`, and `rest.gohighlevel.com` (v1) returned
//     404 or "switch to the new API token". The only adjacent endpoint that
//     responded was `/oauth/locationToken`, which mints a *backend* API JWT
//     for a sub-account — it is not a browser SSO link.
//   - Conclusion: GHL does not expose a public "mint browser login URL"
//     endpoint. Flexy's existing white-label login page is the only path.
//
// The mint code is therefore *disabled by default*: with no override the
// helper short-circuits and returns null without making any HTTP call, and
// the caller falls back to the standard login-page redirect immediately.
// We keep the env var hook (`GHL_LOGIN_TOKEN_PATH`) so that if GHL ever ships
// a public endpoint, an operator can plug it in without a code change.
//
// To re-probe after a GHL API update, run:
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/probe-flexy-sso.ts
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/probe-flexy-sso2.ts

const LOGIN_TOKEN_PATH_TEMPLATE = process.env.GHL_LOGIN_TOKEN_PATH ?? "";

interface MintLoginUrlOptions {
  staffUserId: string;
  locationId: string;
}

interface LoginTokenResponse {
  loginUrl?: string;
  url?: string;
  redirectUrl?: string;
  token?: string;
  loginToken?: string;
}

function pickLoginUrl(data: LoginTokenResponse, locationId: string): string | null {
  if (typeof data.loginUrl === "string" && data.loginUrl) return data.loginUrl;
  if (typeof data.url === "string" && data.url) return data.url;
  if (typeof data.redirectUrl === "string" && data.redirectUrl) return data.redirectUrl;
  // Some variants return just a token; build the dashboard URL ourselves.
  const token = (typeof data.token === "string" && data.token)
    || (typeof data.loginToken === "string" && data.loginToken)
    || null;
  if (token) {
    const base = FLEXY_PORTAL_URL.replace(/\/+$/, "");
    return `${base}/v2/location/${encodeURIComponent(locationId)}/dashboard?token=${encodeURIComponent(token)}`;
  }
  return null;
}

export async function mintFlexyLoginUrl(
  opts: MintLoginUrlOptions,
): Promise<string | null> {
  const { staffUserId, locationId } = opts;
  if (!staffUserId) return null;

  // No `GHL_LOGIN_TOKEN_PATH` configured → mint is disabled (default since
  // the live probe confirmed no public GHL endpoint works). Skip the network
  // call entirely so we don't waste a round-trip and emit a noisy warn on
  // every "Open Flexy" click.
  if (!LOGIN_TOKEN_PATH_TEMPLATE) return null;

  const { companyId } = decodeAgencyJwt();
  const path = LOGIN_TOKEN_PATH_TEMPLATE.replace(
    "{userId}",
    encodeURIComponent(staffUserId),
  );

  let accessToken: string;
  try {
    accessToken = await resolveAccessToken("company");
  } catch (err) {
    console.warn(
      `[GHLAgency] mintFlexyLoginUrl: cannot resolve company token, falling back to login page:`,
      err,
    );
    return null;
  }

  const body: Record<string, unknown> = { companyId, locationId };
  console.log(`[GHLAgency] Minting Flexy login URL via POST ${GHL_API_BASE}${path}`);
  let result;
  try {
    result = await ghlAgencyRequestOnce<LoginTokenResponse>(
      "POST",
      path,
      accessToken,
      body,
    );
  } catch (err) {
    console.warn(`[GHLAgency] mintFlexyLoginUrl network failure, falling back:`, err);
    return null;
  }

  // Match the 401-eviction-and-retry behavior of `ghlAgencyRequest`: a
  // server-side token invalidation shouldn't permanently suppress SSO until
  // the cached token's TTL expires.
  if (!result.ok && result.status === 401) {
    console.warn(
      `[GHLAgency] mintFlexyLoginUrl got 401; evicting cached company token and retrying once`,
    );
    tokenCache.delete("company");
    try {
      accessToken = await resolveAccessToken("company");
      result = await ghlAgencyRequestOnce<LoginTokenResponse>(
        "POST",
        path,
        accessToken,
        body,
      );
    } catch (err) {
      console.warn(`[GHLAgency] mintFlexyLoginUrl retry failed, falling back:`, err);
      return null;
    }
  }

  if (!result.ok) {
    // Non-fatal: operator may have an outdated GHL_LOGIN_TOKEN_PATH or this
    // staff user may not be eligible. Log at warn and let caller fall back.
    console.warn(
      `[GHLAgency] mintFlexyLoginUrl failed: HTTP ${result.status} — ${result.text}. Falling back to login page.`,
    );
    return null;
  }

  const url = pickLoginUrl(result.data ?? {}, locationId);
  if (!url) {
    console.warn(
      `[GHLAgency] mintFlexyLoginUrl returned no usable URL/token: ${JSON.stringify(result.data)}. Falling back.`,
    );
    return null;
  }
  console.log(`[GHLAgency] Minted Flexy login URL for staff=${staffUserId} location=${locationId}`);
  return url;
}

export function generateRandomPassword(): string {
  const charsets = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%^&*",
  ];
  const all = charsets.join("");
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let pw = charsets.map(pick).join("");
  for (let i = 0; i < 16; i++) pw += pick(all);
  return pw;
}
