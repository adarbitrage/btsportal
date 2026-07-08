// GoHighLevel coaching-calendar service.
//
// Standalone, credit-based private booking writes/reads against the coach
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

// All four private coach calendars live in this single GHL sub-account.
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

// Cross-company arbitration means we may write to more than one GHL location
// (a coach's Booking Calendar in one company + their Conflict Calendar in the
// other). Tokens are location-scoped, so cache one per locationId rather than a
// single global token. Single-location callers (everything pre-arbiter) just
// use the COACHING_LOCATION_ID entry, so behavior is unchanged.
const tokenCache = new Map<string, TokenEntry>();
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000;

async function mintLocationToken(
  locationId: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const { apiKey, companyId } = decodeAgencyJwt();
  const { clientId, clientSecret } = getOAuthClientCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    company_id: companyId,
    response_type: "code",
    redirect_uri: process.env.GHL_OAUTH_REDIRECT_URI ?? "https://theinvisibleaffiliate.com",
    scope: COACHING_SCOPE,
    userType: "Location",
    location_id: locationId,
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

async function getAccessToken(locationId: string): Promise<string> {
  const cached = tokenCache.get(locationId);
  if (cached && cached.expiresAt - Date.now() > TOKEN_SAFETY_MARGIN_MS) {
    return cached.accessToken;
  }
  const { accessToken, expiresIn } = await mintLocationToken(locationId);
  tokenCache.set(locationId, { accessToken, expiresAt: Date.now() + expiresIn * 1000 });
  console.log(`[GHLCoaching] Minted location token for ${locationId} (expires in ${expiresIn}s)`);
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
  locationId: string = COACHING_LOCATION_ID,
): Promise<T> {
  let token = await getAccessToken(locationId);
  let result = await ghlRequestOnce<T>(method, path, token, body);
  if (!result.ok && result.status === 401) {
    tokenCache.delete(locationId);
    token = await getAccessToken(locationId);
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
  locationId: string = COACHING_LOCATION_ID,
): Promise<FreeSlot[]> {
  const qs = new URLSearchParams({
    startDate: String(startMs),
    endDate: String(endMs),
    timezone: COACHING_TIMEZONE,
  });
  const data = await ghlRequest<FreeSlotsResponse>(
    "GET",
    `/calendars/${encodeURIComponent(calendarId)}/free-slots?${qs.toString()}`,
    undefined,
    locationId,
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

// ---------------------------------------------------------------------------
// Calendar events (busy intervals)
// ---------------------------------------------------------------------------

/** A real appointment/block on a calendar, as an absolute busy interval. */
export interface BusyEvent {
  startMs: number;
  endMs: number;
}

interface RawCalendarEvent {
  startTime?: string;
  endTime?: string;
  appointmentStatus?: string;
  status?: string;
  deleted?: boolean;
}

interface CalendarEventsResponse {
  events?: RawCalendarEvent[];
}

/**
 * Pure mapping from a GHL calendar-events payload to busy intervals.
 * Cancelled events are excluded (a cancelled appointment must not keep
 * blocking time); events with unparseable/absent times are skipped.
 * Exported for unit testing.
 */
export function extractBusyEvents(data: CalendarEventsResponse): BusyEvent[] {
  const events = Array.isArray(data.events) ? data.events : [];
  const busy: BusyEvent[] = [];
  for (const ev of events) {
    // Live GHL payloads carry a `deleted` boolean alongside appointmentStatus
    // (confirmed via probe against the Cherrington conflict calendar).
    if (ev.deleted === true) continue;
    const status = (ev.appointmentStatus ?? ev.status ?? "").toLowerCase();
    if (status === "cancelled" || status === "canceled") continue;
    const startMs = ev.startTime ? Date.parse(ev.startTime) : NaN;
    const endMs = ev.endTime ? Date.parse(ev.endTime) : NaN;
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) continue;
    busy.push({ startMs, endMs });
  }
  return busy;
}

/**
 * List a calendar's REAL events (appointments + block slots) in the window
 * [startMs, endMs] as absolute busy intervals, excluding cancelled events.
 * Unlike free-slots, this is independent of the calendar's configured
 * availability schedule — it reports only actual bookings. Used to subtract
 * the other company's real appointments from BTS availability. Throws on any
 * fetch failure so callers never silently treat conflicted times as free.
 */
export async function listCalendarBusyEvents(
  calendarId: string,
  startMs: number,
  endMs: number,
  locationId: string = COACHING_LOCATION_ID,
): Promise<BusyEvent[]> {
  const qs = new URLSearchParams({
    locationId,
    calendarId,
    startTime: String(startMs),
    endTime: String(endMs),
  });
  const data = await ghlRequest<CalendarEventsResponse>(
    "GET",
    `/calendars/events?${qs.toString()}`,
    undefined,
    locationId,
  );
  if (process.env.GHL_DEBUG_EVENTS === "1") {
    console.log(`[GHLCoaching] raw /calendars/events payload for ${calendarId}:`, JSON.stringify(data));
  }
  return extractBusyEvents(data);
}

interface CalendarConfigResponse {
  calendar?: {
    slotDuration?: number;
    slotDurationUnit?: string;
    slotInterval?: number;
    slotIntervalUnit?: string;
    calendarType?: string;
    locationId?: string;
  };
  slotDuration?: number;
  slotDurationUnit?: string;
  slotInterval?: number;
  slotIntervalUnit?: string;
  calendarType?: string;
  locationId?: string;
}

export interface CalendarDetails {
  calendarType: string | undefined;
  slotDuration: number | undefined;
  slotDurationUnit: string | undefined;
  slotInterval: number | undefined;
  slotIntervalUnit: string | undefined;
  locationId: string | undefined;
}

/**
 * Read-only fetch of a GHL calendar's raw configuration (type, duration,
 * interval, owning location). Used to verify a relayed calendar ID before
 * arming a coach roster row with it — never writes anything.
 */
export async function getCalendarDetails(
  calendarId: string,
  locationId: string = COACHING_LOCATION_ID,
): Promise<CalendarDetails> {
  const data = await ghlRequest<CalendarConfigResponse>(
    "GET",
    `/calendars/${encodeURIComponent(calendarId)}`,
    undefined,
    locationId,
  );
  const cal = data.calendar ?? data;
  return {
    calendarType: cal.calendarType,
    slotDuration: cal.slotDuration,
    slotDurationUnit: cal.slotDurationUnit,
    slotInterval: cal.slotInterval,
    slotIntervalUnit: cal.slotIntervalUnit,
    locationId: cal.locationId,
  };
}

interface CalendarDurationCacheEntry {
  minutes: number;
  expiresAt: number;
}

// Short-lived (calendars are edited rarely, but never trust a value forever)
// per-calendar cache so booking + availability calls made moments apart don't
// each round-trip to GHL for the same config.
const calendarDurationCache = new Map<string, CalendarDurationCacheEntry>();
const CALENDAR_DURATION_CACHE_TTL_MS = 5 * 60 * 1000;

function slotDurationToMinutes(slotDuration: number, unit: string | undefined): number {
  const normalizedUnit = (unit ?? "mins").toLowerCase();
  if (normalizedUnit.startsWith("hour")) return slotDuration * 60;
  if (normalizedUnit.startsWith("day")) return slotDuration * 24 * 60;
  return slotDuration;
}

/**
 * Fetch a calendar's configured meeting duration (NOT the slot interval —
 * `slotDuration` on GHL calendars is the actual appointment length; the
 * bookable-start-time spacing is a separate `slotInterval` field that must
 * never be used to infer duration). Throws explicitly if the calendar config
 * can't be fetched or has no usable slotDuration — callers must fail the
 * booking rather than silently defaulting.
 */
export async function getCalendarDurationMinutes(
  calendarId: string,
  locationId: string = COACHING_LOCATION_ID,
): Promise<number> {
  const cacheKey = `${locationId}:${calendarId}`;
  const cached = calendarDurationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.minutes;
  }
  const data = await ghlRequest<CalendarConfigResponse>(
    "GET",
    `/calendars/${encodeURIComponent(calendarId)}`,
    undefined,
    locationId,
  );
  const cal = data.calendar ?? data;
  const slotDuration = cal.slotDuration;
  if (typeof slotDuration !== "number" || slotDuration <= 0) {
    throw new Error(
      `GHL calendar ${calendarId} returned no usable slotDuration: ${JSON.stringify(data)}`,
    );
  }
  const minutes = slotDurationToMinutes(slotDuration, cal.slotDurationUnit);
  calendarDurationCache.set(cacheKey, { minutes, expiresAt: Date.now() + CALENDAR_DURATION_CACHE_TTL_MS });
  return minutes;
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
  locationId?: string;
}): Promise<string> {
  const locationId = input.locationId ?? COACHING_LOCATION_ID;
  const data = await ghlRequest<ContactResponse>(
    "POST",
    "/contacts/upsert",
    {
      locationId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
    },
    locationId,
  );
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
  locationId?: string;
}): Promise<CreatedAppointment> {
  const locationId = input.locationId ?? COACHING_LOCATION_ID;
  const data = await ghlRequest<AppointmentResponse>(
    "POST",
    "/calendars/events/appointments",
    {
      calendarId: input.calendarId,
      locationId,
      contactId: input.contactId,
      startTime: input.startTime,
      endTime: input.endTime,
      title: input.title,
      appointmentStatus: "confirmed",
      ignoreDateRange: true,
      toNotify: input.toNotify ?? true,
    },
    locationId,
  );
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
  locationId?: string;
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
    input.locationId ?? COACHING_LOCATION_ID,
  );
  const meetLink =
    typeof data.address === "string" && data.address.startsWith("http") ? data.address : null;
  return { meetLink };
}

/** Cancel/delete an appointment by its GHL event id. */
export async function cancelAppointment(
  eventId: string,
  locationId: string = COACHING_LOCATION_ID,
): Promise<void> {
  await ghlRequest(
    "DELETE",
    `/calendars/events/${encodeURIComponent(eventId)}`,
    undefined,
    locationId,
  );
}

interface BlockSlotResponse {
  id?: string;
  event?: { id?: string };
}

/**
 * Write a "busy block" (a calendar reservation that is NOT a member-facing
 * appointment) onto a calendar, so that calendar's own booking widget treats
 * the window as taken. Used by the cross-company arbiter to mirror a BTS
 * booking into the coach's Conflict Calendar (the other company's calendar).
 * Returns the created block's GHL event id, tracked on the booking so it can be
 * removed/moved on cancel/reschedule.
 */
export async function createBlockSlot(input: {
  calendarId: string;
  locationId: string;
  startTime: string;
  endTime: string;
  title: string;
}): Promise<{ id: string }> {
  const data = await ghlRequest<BlockSlotResponse>(
    "POST",
    "/calendars/events/block-slots",
    {
      calendarId: input.calendarId,
      locationId: input.locationId,
      startTime: input.startTime,
      endTime: input.endTime,
      title: input.title,
    },
    input.locationId,
  );
  const id = data.id ?? data.event?.id;
  if (!id) {
    throw new Error(`GHL createBlockSlot returned no id: ${JSON.stringify(data)}`);
  }
  return { id };
}

/** Delete a block slot (or any calendar event) by its GHL event id. */
export async function deleteBlockSlot(
  eventId: string,
  locationId: string = COACHING_LOCATION_ID,
): Promise<void> {
  await ghlRequest(
    "DELETE",
    `/calendars/events/${encodeURIComponent(eventId)}`,
    undefined,
    locationId,
  );
}

/**
 * Add an internal note to a GHL appointment (calendar event). This populates the
 * "Internal Note(s)" section of the appointment detail view; GHL also mirrors the
 * note onto the linked Contact/Opportunity/Conversation records automatically.
 * The location is implied by the location-scoped token. Verified against the
 * coaching sub-account with the existing Version header (note body <= 5000 chars).
 */
export async function createAppointmentNote(appointmentId: string, body: string): Promise<void> {
  await ghlRequest("POST", `/calendars/appointments/${encodeURIComponent(appointmentId)}/notes`, {
    body,
  });
}
