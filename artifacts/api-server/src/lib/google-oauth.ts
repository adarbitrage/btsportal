import { createHmac, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

// Per-coach Google OAuth helper.
//
// Coaches connect their OWN Google account via the standard 3-legged OAuth code
// flow (no Workspace admin / domain-wide delegation needed). We request offline
// access so Google issues a refresh token, which we encrypt at rest and later
// trade for short-lived access tokens during recording ingest.

const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
// Free/busy only — we never read event titles or details, just the busy blocks
// needed to flag conflicts against a coach's group-call dates.
export const CALENDAR_FREEBUSY_SCOPE =
  "https://www.googleapis.com/auth/calendar.freebusy";

/**
 * True when a stored OAuth scope string already includes the calendar free/busy
 * scope. Connections made before the calendar scope was added additively will
 * lack it, so conflict detection silently returns nothing until the coach
 * re-grants access.
 */
export function scopeHasCalendarAccess(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).includes(CALENDAR_FREEBUSY_SCOPE);
}
export const GOOGLE_OAUTH_SCOPES = [
  DRIVE_READONLY_SCOPE,
  CALENDAR_FREEBUSY_SCOPE,
  "openid",
  "email",
];

const STATE_TTL_MS = 10 * 60 * 1000; // a connect attempt must finish within 10 min

export function getOAuthClientId(): string | undefined {
  return process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || undefined;
}

function getOAuthClientSecret(): string | undefined {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || undefined;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(getOAuthClientId() && getOAuthClientSecret());
}

/**
 * Public base URL of the deployment (no trailing slash). The portal and the API
 * share one domain via path-based routing, so the API lives at `<base>/api`.
 * Prefer an explicit override, then the configured portal URL, then the Replit
 * dev domain, and finally a localhost dev fallback.
 */
function resolvePublicBaseUrl(): string {
  const explicit = process.env.OAUTH_PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const portal = process.env.PORTAL_URL?.trim();
  if (portal) return portal.replace(/\/+$/, "");
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (dev) return `https://${dev.replace(/\/+$/, "")}`;
  return "http://localhost:8080";
}

/** The exact redirect URI that must be registered in the Google OAuth client. */
export function getRedirectUri(): string {
  return `${resolvePublicBaseUrl()}/api/coach/google/callback`;
}

/** Where the callback sends the coach's browser back to in the portal. */
export function getDashboardReturnUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${resolvePublicBaseUrl()}/coach/sessions${qs ? `?${qs}` : ""}`;
}

function buildClient(withRedirect: boolean): OAuth2Client {
  const clientId = getOAuthClientId();
  const clientSecret = getOAuthClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth is not configured");
  }
  return new OAuth2Client({
    clientId,
    clientSecret,
    ...(withRedirect ? { redirectUri: getRedirectUri() } : {}),
  });
}

// --- CSRF / identity state -------------------------------------------------
// The callback is a cross-site top-level redirect from accounts.google.com, so
// the SameSite=Strict auth cookie is NOT sent. We therefore bind the initiating
// user into an HMAC-signed, expiring `state` value and trust that on callback.

function stateKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET must be set to sign Google OAuth state");
  }
  return Buffer.from(secret, "utf8");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function signOAuthState(userId: number): string {
  const payload = b64url(
    Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + STATE_TTL_MS }), "utf8"),
  );
  const sig = b64url(createHmac("sha256", stateKey()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string | undefined): number | null {
  if (!state || typeof state !== "string") return null;
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = b64url(createHmac("sha256", stateKey()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(payload).toString("utf8")) as {
      uid?: number;
      exp?: number;
    };
    if (typeof parsed.uid !== "number" || typeof parsed.exp !== "number") return null;
    if (Date.now() > parsed.exp) return null;
    return parsed.uid;
  } catch {
    return null;
  }
}

// --- OAuth flow ------------------------------------------------------------

export function buildConsentUrl(state: string): string {
  const client = buildClient(true);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on re-consent
    include_granted_scopes: true,
    scope: GOOGLE_OAUTH_SCOPES,
    state,
  });
}

export interface ExchangedTokens {
  refreshToken: string | null;
  email: string | null;
  scope: string | null;
}

function decodeIdTokenEmail(idToken: string | null | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(b64urlDecode(parts[1]).toString("utf8")) as {
      email?: string;
    };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export async function exchangeCodeForTokens(code: string): Promise<ExchangedTokens> {
  const client = buildClient(true);
  const { tokens } = await client.getToken(code);
  return {
    refreshToken: tokens.refresh_token ?? null,
    email: decodeIdTokenEmail(tokens.id_token),
    scope: tokens.scope ?? null,
  };
}

/**
 * Trade a stored refresh token for a fresh access token. Throws on
 * `invalid_grant` (revoked / expired refresh token) so callers can mark the
 * connection dead.
 */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const client = buildClient(false);
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error("Google returned an empty access token");
  }
  return token;
}

// --- Calendar free/busy -----------------------------------------------------

export interface CalendarBusyBlock {
  start: string;
  end: string;
}

/**
 * Thrown when Google rejects the free/busy call for lack of the calendar scope
 * (a connection made before the calendar scope was added). Callers surface this
 * as "reconnect needed" rather than a hard error.
 */
export class CalendarScopeError extends Error {
  constructor(message = "Google Calendar access has not been granted") {
    super(message);
    this.name = "CalendarScopeError";
  }
}

/**
 * Read the busy blocks on a coach's PRIMARY Google Calendar between two
 * instants. Uses the free/busy endpoint so we only ever see busy intervals,
 * never event titles or attendees.
 */
export async function fetchCalendarBusy(
  accessToken: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarBusyBlock[]> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: "primary" }] }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new CalendarScopeError();
  }
  if (!res.ok) {
    throw new Error(`Google free/busy request failed with status ${res.status}`);
  }

  const data = (await res.json()) as {
    calendars?: { primary?: { busy?: Array<{ start?: string; end?: string }> } };
  };
  const busy = data.calendars?.primary?.busy ?? [];
  return busy
    .filter((b): b is { start: string; end: string } =>
      typeof b.start === "string" && typeof b.end === "string",
    )
    .map((b) => ({ start: b.start, end: b.end }));
}
