/**
 * Probe the GoHighLevel "log in as user" endpoints on the v2 Marketplace
 * API (`services.leadconnectorhq.com`) against a real installed Flexy staff
 * user. Prints which (if any) candidate paths return a non-404 response so
 * we can pin down the right `GHL_LOGIN_TOKEN_PATH`.
 *
 * Read-only: each request just attempts to mint a one-time login token. No
 * sub-account or staff record is modified.
 *
 * Usage:
 *   STAFF_USER_ID=... LOCATION_ID=... \
 *     pnpm --filter @workspace/api-server exec tsx \
 *       src/scripts/probe-flexy-sso.ts
 *
 * Defaults to a known-installed staff user when not provided. See
 * `docs/flexy-sso-verification.md` for the full conclusion of the last run.
 */
import { getAgencyCompanyId, getStaffUserPublic } from "../lib/ghl-agency-client";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

async function getCompanyAccessToken(): Promise<string> {
  const raw = process.env.GHL_CHERRINGTON_AGENCY_JWT;
  if (!raw) throw new Error("GHL_CHERRINGTON_AGENCY_JWT not set");
  const decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as {
    apiKey: string;
    companyId: string;
  };
  const clientId = process.env.GHL_CHERRINGTON_CLIENT_ID;
  const clientSecret = process.env.GHL_CHERRINGTON_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GHL_CHERRINGTON_CLIENT_ID/SECRET not set");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    company_id: decoded.companyId,
    response_type: "code",
    redirect_uri:
      process.env.GHL_OAUTH_REDIRECT_URI ?? "https://theinvisibleaffiliate.com",
    scope:
      "companies.readonly locations.readonly locations.write users.readonly users.write",
    userType: "Company",
  });
  const authRes = await fetch(
    `https://services.msgsndr.com/oauth/authorize?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decoded.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );
  if (!authRes.ok) {
    throw new Error(`authorize HTTP ${authRes.status}: ${await authRes.text()}`);
  }
  const authData = (await authRes.json()) as { code?: string; redirectUrl?: string };
  let code = authData.code ?? null;
  if (!code && authData.redirectUrl) {
    code = new URL(authData.redirectUrl).searchParams.get("code");
  }
  if (!code) throw new Error(`no code returned: ${JSON.stringify(authData)}`);

  const tokRes = await fetch(`${GHL_API_BASE}/oauth/token`, {
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
  if (!tokRes.ok) {
    throw new Error(`token HTTP ${tokRes.status}: ${await tokRes.text()}`);
  }
  const tokData = (await tokRes.json()) as { access_token?: string };
  if (!tokData.access_token) {
    throw new Error(`token exchange returned no access_token`);
  }
  return tokData.access_token;
}

async function probe(
  accessToken: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; ok: boolean; body: string }> {
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
  return { status: res.status, ok: res.ok, body: text.slice(0, 1500) };
}

async function main(): Promise<void> {
  // Require explicit identifiers — never fall back to a baked-in default,
  // so we don't probe production staff users by accident. Run once against
  // a real installed Flexy member's `providerStaffUserId` /
  // `providerLocationId` from the DB.
  const STAFF_USER_ID = process.env.STAFF_USER_ID;
  const LOCATION_ID = process.env.LOCATION_ID;
  if (!STAFF_USER_ID || !LOCATION_ID) {
    throw new Error(
      "STAFF_USER_ID and LOCATION_ID env vars are required. Set them to a real installed Flexy member's providerStaffUserId and providerLocationId.",
    );
  }

  console.log(
    `Probing v2 Marketplace API login-token endpoints for staffUser=${STAFF_USER_ID} location=${LOCATION_ID}`,
  );

  const accessToken = await getCompanyAccessToken();
  console.log(`[ok] minted company access token (len=${accessToken.length})`);

  const staff = await getStaffUserPublic(STAFF_USER_ID);
  console.log(
    `[ok] staff user: email=${staff?.email} role=${staff?.role} locations=${staff?.locationIds.length ?? 0}`,
  );

  const companyId = getAgencyCompanyId();
  const u = encodeURIComponent(STAFF_USER_ID);

  const candidates: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [
    { method: "POST", path: `/users/${u}/login-token`, body: { companyId, locationId: LOCATION_ID } },
    { method: "POST", path: `/users/${u}/login-token` },
    { method: "GET", path: `/users/${u}/login-token` },
    { method: "POST", path: `/users/${u}/login`, body: { companyId, locationId: LOCATION_ID } },
    { method: "GET", path: `/users/${u}/login` },
    { method: "POST", path: `/users/${u}/login-link`, body: { companyId, locationId: LOCATION_ID } },
    { method: "GET", path: `/users/${u}/login-link` },
    { method: "POST", path: `/users/${u}/login-as`, body: { companyId, locationId: LOCATION_ID } },
    // /oauth/locationToken exists but mints a backend API JWT, not a browser session.
    { method: "POST", path: `/oauth/locationToken`, body: { companyId, locationId: LOCATION_ID } },
    { method: "POST", path: `/users/login-token`, body: { companyId, locationId: LOCATION_ID, userId: STAFF_USER_ID } },
  ];

  for (const c of candidates) {
    try {
      const r = await probe(accessToken, c.method, c.path, c.body);
      const tag = r.ok ? "OK   " : "FAIL ";
      console.log(`[${tag}] ${c.method.padEnd(4)} ${c.path}${c.body ? " (with body)" : ""} -> ${r.status}`);
      if (r.ok) {
        console.log(`         body: ${r.body}`);
      } else if (r.status !== 404) {
        console.log(`         body: ${r.body.slice(0, 400)}`);
      }
    } catch (e) {
      console.log(`[ERR  ] ${c.method} ${c.path}: ${(e as Error).message}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
