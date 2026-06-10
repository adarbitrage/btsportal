import { expect, type Page } from "@playwright/test";
import type { E2EFixture } from "./global-setup";

// Browser base (the dev-server / SPA host). The browser UI itself still goes
// through the proxy / baseURL fine; only the raw auth round-trip is flaky over
// it, which is why login is handled out-of-band below.
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:25265";

// Raw API calls (auth) go straight to the API server rather than through the
// dev-server proxy: the proxy's first call over the IPv4 loopback can stall for
// the request's whole timeout on a *successful* login (one that returns a
// Set-Cookie), whereas the API server answers in ~100ms. The access_token
// cookie it returns is host-agnostic, so it is still valid for the browser's
// BASE_URL origin once injected. See .agents/memory/e2e-loopback-proxy-hang.md
// for the full root-cause writeup.
export const AUTH_URL = process.env.E2E_AUTH_URL ?? "http://127.0.0.1:8080";

export interface LoginResult {
  ok: boolean;
  status: number;
  setCookies: string[];
}

// Authenticate against the live API. We use the Node runtime's global fetch
// (undici) rather than Playwright's `request` fixture: the fixture's HTTP client
// can stall for tens of seconds on a successful login (one that returns a
// Set-Cookie), whereas plain fetch handles the identical round-trip in a few
// hundred milliseconds.
export async function apiLogin(
  email: string,
  password: string,
): Promise<LoginResult> {
  let lastErr: unknown;
  // Retry once: the very first loopback connection after browser launch can be
  // slow to establish on this shared environment.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${AUTH_URL}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(15_000),
      });
      // Drain the body so the connection is released.
      await res.text().catch(() => undefined);
      return {
        ok: res.ok,
        status: res.status,
        setCookies: res.headers.getSetCookie?.() ?? [],
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// Parse the name/value pairs out of an array of Set-Cookie header strings.
export function parseSetCookies(
  setCookies: string[],
): { name: string; value: string }[] {
  return setCookies
    .map((raw) => {
      const [pair] = raw.split(";");
      const [name, ...valueParts] = pair.split("=");
      const value = valueParts.join("=");
      return name && value ? { name: name.trim(), value: value.trim() } : null;
    })
    .filter((c): c is { name: string; value: string } => c !== null);
}

// Build a `Cookie` request-header value from a login's Set-Cookie headers, for
// API-only specs that need to forward auth on a follow-up fetch.
export function cookieHeader(setCookies: string[]): string {
  return parseSetCookies(setCookies)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

// Log in as the given user and inject the returned access_token cookie into the
// browser context so the SPA's fetches are authenticated. Existing cookies are
// cleared first so a second login in the same context doesn't keep the previous
// user's session around.
export async function loginAs(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  const login = await apiLogin(email, password);
  expect(login.ok, `Login API call failed (HTTP ${login.status})`).toBe(true);
  expect(
    login.setCookies.length,
    "Login should return at least one Set-Cookie header",
  ).toBeGreaterThan(0);

  const cookies = parseSetCookies(login.setCookies);
  const baseUrlObj = new URL(BASE_URL);
  await page.context().clearCookies();
  await page.context().addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: baseUrlObj.hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    })),
  );
}

export async function loginAsAdmin(
  page: Page,
  fixture: E2EFixture,
): Promise<void> {
  await loginAs(page, fixture.adminEmail, fixture.adminPassword);
}
