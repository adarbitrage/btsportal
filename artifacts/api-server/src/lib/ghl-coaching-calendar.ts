// GoHighLevel coaching-calendar service.
//
// Standalone, credit-based 1-on-1 booking writes/reads against the coach
// calendars that live in GHL sub-account JI6HzFwkNIr5VA2QUWUL (under the
// Cherrington/Flexy agency). One location-scoped OAuth token covers ALL
// coaches. The auth flow mirrors ghl-agency-client.ts but requests the
// contacts + calendar-events scopes (the agency client hardcodes a
// locations/users-only company scope), so it is kept as a focused, separate
// module rather than entangling the provisioning client.
//
// Verified end-to-end (read free-slots -> upsert contact -> create
// appointment with auto-attached Google Meet link -> cancel).

const GHL_AUTH_BASE = "https://services.msgsndr.com";
const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

// All four 1-on-1 coach calendars live in this single GHL sub-account.
export const COACHING_LOCATION_ID =
  process.env.GHL_COACHING_LOCATION_ID ?? "JI6HzFwkNIr5VA2QUWUL";

// Coach calendars are configured in Central time; GHL returns slot start
// times at this zone's offset.
export const COACHING_TIMEZONE = process.env.GHL_COACHING_TIMEZONE ?? "America/Chicago";

const COACHING_SCOPE =
  "contacts.readonly contacts.write calendars.readonly calendars/events.readonly calendars/events.write";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

interface AgencyJwt {
  apiKey: string;
  companyId: string;
}

let cachedJwt: AgencyJwt | null = null;

function decodeAgencyJwt(): AgencyJwt {
  if (cachedJwt) return cachedJwt;
  const raw = process.env.GHL_CHERRINGTON_AGENCY_JWT;
  if (!raw) {
    throw new Error(
      "GHL_CHERRINGTON_AGENCY_JWT is not configured (base64 JSON {apiKey, companyId}).",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    throw new Error("GHL_CHERRINGTON_AGENCY_JWT is not valid base64 JSON");
  }
  const obj = parsed as Partial<AgencyJwt>;
  if (!obj || typeof obj.apiKey !== "string" || typeof obj.companyId !== "string") {
    throw new Error("GHL_CHERRINGTON_AGENCY_JWT JSON must include `apiKey` and `companyId`");
  }
  cachedJwt = { apiKey: obj.apiKey, companyId: obj.companyId };
  return cachedJwt;
}

function getOAuthClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GHL_CHERRINGTON_CLIENT_ID;
  const clientSecret = process.env.GHL_CHERRINGTON_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GHL_CHERRINGTON_CLIENT_ID and GHL_CHERRINGTON_CLIENT_SECRET must be configured to mint GHL coaching tokens",
    );
  }
  return { clientId, clientSecret };
}

// ---------------------------------------------------------------------------
// Location token (cached)
// ---------------------------------------------------------------------------

interface TokenEntry {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: TokenEntry | null = null;
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000;

async function mintLocationToken(): Promise<{ accessToken: string; expiresIn: number }> {
  const { apiKey, companyId } = decodeAgencyJwt();
  const { clientId, clientSecret } = getOAuthClientCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    company_id: companyId,
    response_type: "code",
    redirect_uri: process.env.GHL_OAUTH_REDIRECT_URI ?? "https://theinvisibleaffiliate.com",
    scope: COACHING_SCOPE,
    userType: "Location",
    location_id: COACHING_LOCATION_ID,
  });

  const authorizeRes = await fetch(`${GHL_AUTH_BASE}/oauth/authorize?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  if (!authorizeRes.ok) {
    const text = await authorizeRes.text();
    throw new Error(`GHL coaching authorize failed: HTTP ${authorizeRes.status} — ${text}`);
  }
  const authorizeData = (await authorizeRes.json()) as { code?: string; redirectUrl?: string };
  let code: string | null = authorizeData.code ?? null;
  if (!code && typeof authorizeData.redirectUrl === "string") {
    try {
      code = new URL(authorizeData.redirectUrl).searchParams.get("code");
    } catch {
      /* code stays null */
    }
  }
  if (!code) {
    throw new Error(`GHL coaching authorize returned no code: ${JSON.stringify(authorizeData)}`);
  }

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
    throw new Error(`GHL coaching token exchange failed: HTTP ${tokenRes.status} — ${text}`);
  }
  const tokenData = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
  if (!tokenData.access_token) {
    throw new Error(`GHL coaching token exchange returned no access_token: ${JSON.stringify(tokenData)}`);
  }
  return {
    accessToken: tokenData.access_token,
    expiresIn: typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600,
  };
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > TOKEN_SAFETY_MARGIN_MS) {
    return cachedToken.accessToken;
  }
  const { accessToken, expiresIn } = await mintLocationToken();
  cachedToken = { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
  console.log(`[GHLCoaching] Minted location token (expires in ${expiresIn}s)`);
  return accessToken;
}

// ---------------------------------------------------------------------------
// Request helper (evict + retry once on 401)
// ---------------------------------------------------------------------------

interface GhlResult<T> {
  ok: boolean;
  status: number;
  text: string;
  data: T;
}

async function ghlRequestOnce<T>(
  method: string,
  path: string,
  accessToken: string,
  body?: Record<string, unknown>,
): Promise<GhlResult<T>> {
  const res = await fetch(`${GHL_API_BASE}${path}`, {
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
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, text, data: data as T };
}

async function ghlRequest<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  let token = await getAccessToken();
  let result = await ghlRequestOnce<T>(method, path, token, body);
  if (!result.ok && result.status === 401) {
    cachedToken = null;
    token = await getAccessToken();
    result = await ghlRequestOnce<T>(method, path, token, body);
  }
  if (!result.ok) {
    throw new Error(`GHL ${method} ${path} failed: HTTP ${result.status} — ${result.text}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FreeSlot {
  /** ISO-8601 start time with the calendar's zone offset, e.g. 2026-06-17T14:30:00-05:00 */
  startTime: string;
}

interface FreeSlotsResponse {
  [dateOrMeta: string]: { slots?: string[] } | string;
}

/**
 * Free 30-minute slots for a coach calendar in the window [startMs, endMs]
 * (epoch millis). GHL groups results by local date; we flatten to a sorted
 * list of ISO start times.
 */
export async function getFreeSlots(
  calendarId: string,
  startMs: number,
  endMs: number,
): Promise<FreeSlot[]> {
  const qs = new URLSearchParams({
    startDate: String(startMs),
    endDate: String(endMs),
    timezone: COACHING_TIMEZONE,
  });
  const data = await ghlRequest<FreeSlotsResponse>(
    "GET",
    `/calendars/${encodeURIComponent(calendarId)}/free-slots?${qs.toString()}`,
  );
  const slots: string[] = [];
  for (const value of Object.values(data)) {
    if (value && typeof value === "object" && Array.isArray(value.slots)) {
      slots.push(...value.slots);
    }
  }
  slots.sort();
  return slots.map((startTime) => ({ startTime }));
}

interface ContactResponse {
  contact?: { id?: string };
  id?: string;
}

/**
 * Idempotently resolve a GHL contact in the coaching sub-account for this
 * member's email. Returns the contactId.
 */
export async function upsertContact(input: {
  email: string;
  firstName?: string;
  lastName?: string;
}): Promise<string> {
  const data = await ghlRequest<ContactResponse>("POST", "/contacts/upsert", {
    locationId: COACHING_LOCATION_ID,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
  });
  const id = data.contact?.id ?? data.id;
  if (!id) {
    throw new Error(`GHL contact upsert returned no id: ${JSON.stringify(data)}`);
  }
  return id;
}

export interface CreatedAppointment {
  id: string;
  meetLink: string | null;
  startTime: string;
  endTime: string;
  status: string | null;
}

interface AppointmentResponse {
  id?: string;
  appointment?: { id?: string };
  event?: { id?: string };
  address?: string;
  startTime?: string;
  endTime?: string;
  appointmentStatus?: string;
  status?: string;
}

/**
 * Book an appointment on a coach calendar. GHL auto-attaches the coach's
 * Google Meet link (returned in `address`). `toNotify` controls whether GHL
 * fires its own confirmation notifications (default on for real bookings;
 * pass false for automated tests).
 */
export async function createAppointment(input: {
  calendarId: string;
  contactId: string;
  startTime: string;
  endTime: string;
  title: string;
  toNotify?: boolean;
}): Promise<CreatedAppointment> {
  const data = await ghlRequest<AppointmentResponse>("POST", "/calendars/events/appointments", {
    calendarId: input.calendarId,
    locationId: COACHING_LOCATION_ID,
    contactId: input.contactId,
    startTime: input.startTime,
    endTime: input.endTime,
    title: input.title,
    appointmentStatus: "confirmed",
    ignoreDateRange: true,
    toNotify: input.toNotify ?? true,
  });
  const id = data.id ?? data.appointment?.id ?? data.event?.id;
  if (!id) {
    throw new Error(`GHL createAppointment returned no id: ${JSON.stringify(data)}`);
  }
  const meetLink =
    typeof data.address === "string" && data.address.startsWith("http") ? data.address : null;
  return {
    id,
    meetLink,
    startTime: data.startTime ?? input.startTime,
    endTime: data.endTime ?? input.endTime,
    status: data.appointmentStatus ?? data.status ?? null,
  };
}

/**
 * Reschedule an existing appointment to a new time, keeping the same GHL event
 * id (and therefore the same booking + spent credit — a credit-neutral move).
 * Returns the (possibly refreshed) Google Meet link.
 */
export async function updateAppointment(input: {
  eventId: string;
  calendarId: string;
  startTime: string;
  endTime: string;
  title?: string;
  toNotify?: boolean;
}): Promise<{ meetLink: string | null }> {
  const data = await ghlRequest<AppointmentResponse>(
    "PUT",
    `/calendars/events/appointments/${encodeURIComponent(input.eventId)}`,
    {
      calendarId: input.calendarId,
      startTime: input.startTime,
      endTime: input.endTime,
      ...(input.title ? { title: input.title } : {}),
      appointmentStatus: "confirmed",
      ignoreDateRange: true,
      toNotify: input.toNotify ?? true,
    },
  );
  const meetLink =
    typeof data.address === "string" && data.address.startsWith("http") ? data.address : null;
  return { meetLink };
}

/** Cancel/delete an appointment by its GHL event id. */
export async function cancelAppointment(eventId: string): Promise<void> {
  await ghlRequest("DELETE", `/calendars/events/${encodeURIComponent(eventId)}`);
}

/**
 * Add a note to a contact in the coaching sub-account. The contact is the one
 * tied to the appointment, so this is visible from the appointment's contact
 * record (same GHL location). The location is implied by the location-scoped
 * token, so no locationId is sent.
 */
export async function addContactNote(contactId: string, body: string): Promise<void> {
  await ghlRequest("POST", `/contacts/${encodeURIComponent(contactId)}/notes`, { body });
}
