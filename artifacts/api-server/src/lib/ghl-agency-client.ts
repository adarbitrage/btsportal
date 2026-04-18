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

async function ghlAgencyRequest<T = unknown>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { apiKey } = decodeAgencyJwt();
  const url = `${GHL_API_BASE}${path}`;
  console.log(`[GHLAgency] ${method} ${url}`);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
  const remaining = getUserLocationIds(user).filter((id) => id !== locationId);
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
  const ids = new Set(getUserLocationIds(user));
  if (ids.has(locationId)) return;
  ids.add(locationId);
  await ghlAgencyRequest("PUT", `/users/${encodeURIComponent(staffUserId)}`, {
    locationIds: [...ids],
  });
}

export async function updateStaffUserPassword(
  staffUserId: string,
  newPassword: string,
): Promise<void> {
  await ghlAgencyRequest("PUT", `/users/${encodeURIComponent(staffUserId)}`, {
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
