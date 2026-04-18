import { db } from "@workspace/db";
import { ghlOauthTokensTable } from "@workspace/db/schema";
import { eq, and, isNotNull, isNull } from "drizzle-orm";

const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

export const FLEXY_PORTAL_URL = process.env.FLEXY_PORTAL_URL ?? "https://dashboard.getflexy.app";

function getOAuthCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GHL_CHERRINGTON_CLIENT_ID;
  const clientSecret = process.env.GHL_CHERRINGTON_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GHL_CHERRINGTON_CLIENT_ID and GHL_CHERRINGTON_CLIENT_SECRET environment variables are required for Flexy",
    );
  }
  return { clientId, clientSecret };
}

interface GhlTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  userType?: string;
  companyId?: string;
  locationId?: string;
}

async function exchangeToken(params: Record<string, string>): Promise<GhlTokenResponse> {
  const { clientId, clientSecret } = getOAuthCreds();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    ...params,
  });
  console.log(`[GHLAgency] POST ${GHL_TOKEN_URL} grant_type=${params.grant_type}`);
  const res = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GHL token exchange failed: HTTP ${res.status} — ${JSON.stringify(data)}`);
  }
  return data as GhlTokenResponse;
}

export async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
  createdById?: number,
): Promise<{ companyId: string }> {
  const tok = await exchangeToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    user_type: "Company",
  });
  if (!tok.companyId) {
    throw new Error("GHL token exchange did not return a companyId; ensure agency-level scopes are requested");
  }
  const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000);
  await db
    .delete(ghlOauthTokensTable)
    .where(and(eq(ghlOauthTokensTable.scope, "agency"), isNull(ghlOauthTokensTable.locationId)));
  await db.insert(ghlOauthTokensTable).values({
    scope: "agency",
    companyId: tok.companyId,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt,
    userType: tok.userType ?? "Company",
    scopes: tok.scope ?? null,
    createdById: createdById ?? null,
  });
  return { companyId: tok.companyId };
}

async function getAgencyAccessToken(): Promise<{ accessToken: string; companyId: string }> {
  const [row] = await db
    .select()
    .from(ghlOauthTokensTable)
    .where(and(eq(ghlOauthTokensTable.scope, "agency"), isNull(ghlOauthTokensTable.locationId)))
    .limit(1);
  if (!row) {
    throw new Error(
      "No GHL agency OAuth token found. Complete the one-time install at /api/admin/flexy/oauth/install first.",
    );
  }
  if (!row.companyId) {
    throw new Error("GHL agency OAuth row missing companyId");
  }
  if (row.accessToken && row.expiresAt && row.expiresAt.getTime() > Date.now() + 30_000) {
    return { accessToken: row.accessToken, companyId: row.companyId };
  }
  const tok = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: row.refreshToken,
    user_type: "Company",
  });
  const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000);
  await db
    .update(ghlOauthTokensTable)
    .set({
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? row.refreshToken,
      expiresAt,
      companyId: tok.companyId ?? row.companyId,
      scopes: tok.scope ?? row.scopes,
    })
    .where(eq(ghlOauthTokensTable.id, row.id));
  return { accessToken: tok.access_token, companyId: tok.companyId ?? row.companyId };
}

async function ghlAgencyRequest<T = unknown>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { accessToken } = await getAgencyAccessToken();
  const url = `${GHL_API_BASE}${path}`;
  console.log(`[GHLAgency] ${method} ${url}`);
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
  if (!res.ok) {
    throw new Error(`GHL ${method} ${path} failed: HTTP ${res.status} — ${text}`);
  }
  return data as T;
}

export interface CreateLocationInput {
  name: string;
  email: string;
  timezone?: string;
  country?: string;
}

export async function createLocation(input: CreateLocationInput): Promise<string> {
  // NOTE: do NOT reuse locations by display name. Two members may legitimately
  // share a name (e.g. "John Smith"), and reusing a location across members
  // would break tenant isolation. Member-scoped idempotency lives in the DB
  // (providerLocationId on member_app_instances) — callers must not invoke
  // createLocation when a providerLocationId is already persisted.
  const { companyId } = await getAgencyAccessToken();
  const body: Record<string, unknown> = {
    companyId,
    name: input.name,
    email: input.email,
    country: input.country ?? "US",
    timezone: input.timezone ?? "America/New_York",
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

export async function findExistingStaffUser(
  email: string,
  locationId: string,
): Promise<string | null> {
  const { companyId } = await getAgencyAccessToken();
  try {
    const data = await ghlAgencyRequest<{ users?: Array<{ id: string; email?: string; locationIds?: string[] }> }>(
      "GET",
      `/users/?companyId=${encodeURIComponent(companyId)}&locationId=${encodeURIComponent(locationId)}`,
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
  phone?: string;
}

export async function createStaffUser(input: CreateStaffUserInput): Promise<string> {
  const { companyId } = await getAgencyAccessToken();
  const password = generateRandomPassword();
  const body: Record<string, unknown> = {
    companyId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    password,
    phone: input.phone ?? "",
    type: "account",
    role: "admin",
    locationIds: [input.locationId],
    permissions: {
      campaignsEnabled: true,
      campaignsReadOnly: false,
      contactsEnabled: true,
      workflowsEnabled: true,
      workflowsReadOnly: false,
      triggersEnabled: true,
      funnelsEnabled: true,
      websitesEnabled: true,
      opportunitiesEnabled: true,
      dashboardStatsEnabled: true,
      bulkRequestsEnabled: true,
      appointmentsEnabled: true,
      reviewsEnabled: true,
      onlineListingsEnabled: true,
      phoneCallEnabled: true,
      conversationsEnabled: true,
      assignedDataOnly: false,
      adwordsReportingEnabled: true,
      membershipEnabled: true,
      facebookAdsReportingEnabled: true,
      attributionsReportingEnabled: true,
      settingsEnabled: true,
      tagsEnabled: true,
      leadValueEnabled: true,
      marketingEnabled: true,
    },
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

export async function deleteStaffUser(userId: string): Promise<void> {
  await ghlAgencyRequest("DELETE", `/users/${encodeURIComponent(userId)}`);
}

interface GhlUser {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  locationIds?: string[];
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
 * Non-destructive disable: removes the staff user from the given location so
 * they can no longer log in to it. Other location memberships (if any) are
 * preserved. Throws on failure so callers can surface the problem instead of
 * silently marking the app as uninstalled while access lingers.
 */
export async function disableStaffUserForLocation(
  staffUserId: string,
  locationId: string,
): Promise<void> {
  const user = await getStaffUser(staffUserId);
  const remaining = (user.locationIds ?? []).filter((id) => id !== locationId);
  await ghlAgencyRequest("PUT", `/users/${encodeURIComponent(staffUserId)}`, {
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
  const user = await getStaffUser(staffUserId);
  const ids = new Set(user.locationIds ?? []);
  if (ids.has(locationId)) return;
  ids.add(locationId);
  await ghlAgencyRequest("PUT", `/users/${encodeURIComponent(staffUserId)}`, {
    locationIds: [...ids],
  });
}

export async function mintLoginUrl(locationId: string, userId: string): Promise<string> {
  const { accessToken, companyId } = await getAgencyAccessToken();
  const res = await fetch(`${GHL_API_BASE}/oauth/locationToken`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ companyId, locationId }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    userId?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(`GHL locationToken failed: HTTP ${res.status} — ${JSON.stringify(data)}`);
  }
  const token = encodeURIComponent(data.access_token);
  const u = encodeURIComponent(userId);
  return `${FLEXY_PORTAL_URL}/?token=${token}&userId=${u}&locationId=${encodeURIComponent(locationId)}`;
}

export function locationExists(locationId: string): Promise<boolean> {
  return ghlAgencyRequest<{ id?: string; location?: { id?: string } }>(
    "GET",
    `/locations/${encodeURIComponent(locationId)}`,
  )
    .then((d) => !!(d.id ?? d.location?.id))
    .catch(() => false);
}

export async function isAgencyTokenConfigured(): Promise<boolean> {
  const [row] = await db
    .select({ id: ghlOauthTokensTable.id })
    .from(ghlOauthTokensTable)
    .where(
      and(
        eq(ghlOauthTokensTable.scope, "agency"),
        isNotNull(ghlOauthTokensTable.refreshToken),
      ),
    )
    .limit(1);
  return !!row;
}

function generateRandomPassword(): string {
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
