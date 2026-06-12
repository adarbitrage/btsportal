/**
 * Probe additional GoHighLevel hosts for a "log in as user" / "mint login
 * URL" endpoint. The v2 Marketplace API probe lives in
 * `probe-flexy-sso.ts`; this script targets the legacy hosts that the GHL
 * agency UI itself talks to:
 *
 *   - services.msgsndr.com         (legacy app backend, agency apiKey Bearer)
 *   - rest.gohighlevel.com         (deprecated v1 API, agency apiKey Bearer)
 *   - backend.leadconnectorhq.com  (internal backend used by the agency UI)
 *
 * Read-only. Each candidate is a single request that, if it worked, would
 * just mint a one-time login token. Nothing is modified.
 *
 * Usage:
 *   STAFF_USER_ID=... LOCATION_ID=... \
 *     pnpm --filter @workspace/api-server exec tsx \
 *       src/scripts/probe-flexy-sso2.ts
 *
 * See `docs/flexy-sso-verification.md` for the full conclusion of the last
 * run (every candidate returned 404 or "switch to the new API token").
 */

// Require explicit identifiers — never fall back to baked-in defaults so we
// don't probe production staff users by accident.
const STAFF = process.env.STAFF_USER_ID;
const LOC = process.env.LOCATION_ID;
if (!STAFF || !LOC) {
  throw new Error(
    "STAFF_USER_ID and LOCATION_ID env vars are required. Set them to a real installed Flexy member's providerStaffUserId and providerLocationId.",
  );
}
const raw = process.env.GHL_CHERRINGTON_AGENCY_JWT;
if (!raw) {
  throw new Error("GHL_CHERRINGTON_AGENCY_JWT not set");
}
const decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as {
  apiKey: string;
  companyId: string;
  firebaseToken?: string;
  userId?: string;
};

console.log(
  `Decoded agency JWT: companyId=${decoded.companyId} userId=${decoded.userId ?? "n/a"} hasFirebase=${!!decoded.firebaseToken}`,
);

async function probe(
  base: string,
  method: string,
  path: string,
  bearer: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body && method !== "GET" ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text.slice(0, 800) };
  } catch (e) {
    return { status: 0, body: (e as Error).message };
  }
}

async function main(): Promise<void> {
  const APIKEY = decoded.apiKey;
  const FB = decoded.firebaseToken;
  const u = encodeURIComponent(STAFF!);

  type T = {
    label: string;
    base: string;
    method: string;
    path: string;
    bearer: string;
    body?: Record<string, unknown>;
  };

  const tries: T[] = [
    // services.msgsndr.com — legacy app backend; apiKey Bearer
    {
      label: "msgsndr POST /users/:id/login-token apiKey",
      base: "https://services.msgsndr.com",
      method: "POST",
      path: `/users/${u}/login-token`,
      bearer: APIKEY,
      body: { companyId: decoded.companyId, locationId: LOC },
    },
    {
      label: "msgsndr GET /users/:id/login-token apiKey",
      base: "https://services.msgsndr.com",
      method: "GET",
      path: `/users/${u}/login-token`,
      bearer: APIKEY,
    },
    {
      label: "msgsndr POST /users/:id/loginAsUser apiKey",
      base: "https://services.msgsndr.com",
      method: "POST",
      path: `/users/${u}/loginAsUser`,
      bearer: APIKEY,
      body: { companyId: decoded.companyId, locationId: LOC },
    },
    {
      label: "msgsndr POST /users/login-as apiKey",
      base: "https://services.msgsndr.com",
      method: "POST",
      path: `/users/login-as`,
      bearer: APIKEY,
      body: { companyId: decoded.companyId, userId: STAFF, locationId: LOC },
    },
    // Same paths via firebaseToken — only run if the JWT carries one
    ...(FB
      ? [
          {
            label: "msgsndr POST /users/:id/login-token firebase",
            base: "https://services.msgsndr.com",
            method: "POST",
            path: `/users/${u}/login-token`,
            bearer: FB,
            body: { companyId: decoded.companyId, locationId: LOC },
          } as T,
          {
            label: "msgsndr GET /users/:id/login-token firebase",
            base: "https://services.msgsndr.com",
            method: "GET",
            path: `/users/${u}/login-token`,
            bearer: FB,
          } as T,
          {
            label: "msgsndr POST /oauth/locationToken firebase",
            base: "https://services.msgsndr.com",
            method: "POST",
            path: `/oauth/locationToken`,
            bearer: FB,
            body: { companyId: decoded.companyId, locationId: LOC },
          } as T,
        ]
      : []),
    // rest.gohighlevel.com — deprecated v1 API
    {
      label: "rest v1 GET /v1/users/:id apiKey",
      base: "https://rest.gohighlevel.com",
      method: "GET",
      path: `/v1/users/${u}`,
      bearer: APIKEY,
    },
    {
      label: "rest v1 POST /v1/users/:id/login-token apiKey",
      base: "https://rest.gohighlevel.com",
      method: "POST",
      path: `/v1/users/${u}/login-token`,
      bearer: APIKEY,
      body: { companyId: decoded.companyId, locationId: LOC },
    },
    // backend.leadconnectorhq.com — internal backend the agency UI uses
    {
      label: "backend POST /users/:id/login-token apiKey",
      base: "https://backend.leadconnectorhq.com",
      method: "POST",
      path: `/users/${u}/login-token`,
      bearer: APIKEY,
      body: { companyId: decoded.companyId, locationId: LOC },
    },
    ...(FB
      ? [
          {
            label: "backend POST /users/:id/login-token firebase",
            base: "https://backend.leadconnectorhq.com",
            method: "POST",
            path: `/users/${u}/login-token`,
            bearer: FB,
            body: { companyId: decoded.companyId, locationId: LOC },
          } as T,
          {
            label: "backend GET /users/:id firebase",
            base: "https://backend.leadconnectorhq.com",
            method: "GET",
            path: `/users/${u}`,
            bearer: FB,
          } as T,
        ]
      : []),
  ];

  for (const t of tries) {
    const r = await probe(t.base, t.method, t.path, t.bearer, t.body);
    const tag = r.status >= 200 && r.status < 300 ? "OK   " : "FAIL ";
    console.log(`[${tag}] ${t.label} -> ${r.status}`);
    if (r.status !== 404 && r.body) console.log(`         ${r.body}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
