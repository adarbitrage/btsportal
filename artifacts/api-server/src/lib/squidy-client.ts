const SQUIDY_BASE_URL =
  process.env.SQUIDY_BASE_URL ?? "https://squidy.diytrax.app";

export const APP_DOMAINS: Record<string, string> = {
  diytrax: "diytrax.app",
  pixelpress: "pixelpress.app",
  gifster: "gifster.app",
  metricmover: "metricmover.app",
  noescape: "noescape.app",
};

export interface SquidyCreateInstancePayload {
  app_name: string;
  domain: string;
  source: string;
  user_id: number;
  extra_data: {
    app_uuid: string;
    username: string;
    email: string;
  };
}

export interface SquidyInstance {
  id?: string;
  domain: string;
  status: string;
  sub_status: string | null;
  [key: string]: unknown;
}

export interface SquidyCreateInstanceResponse {
  instance?: SquidyInstance;
  [key: string]: unknown;
}

export interface SquidyLookupResponse {
  instances?: SquidyInstance[];
  [key: string]: unknown;
}

export interface SquidyRetryResponse {
  [key: string]: unknown;
}

function getSquidyHeaders(): Record<string, string> {
  const apiKey = process.env.SQUIDY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SQUIDY_API_KEY environment variable is required to call the Squidy API",
    );
  }
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

export async function squidyCreateInstance(
  payload: SquidyCreateInstancePayload,
): Promise<SquidyCreateInstanceResponse> {
  const url = `${SQUIDY_BASE_URL}/api/v1/instances`;
  console.log(`[Squidy] POST ${url} app=${payload.app_name} domain=${payload.domain}`);
  const res = await fetch(url, {
    method: "POST",
    headers: getSquidyHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  console.log(`[Squidy] createInstance response status=${res.status}`, JSON.stringify(data));
  if (!res.ok) {
    throw new Error(
      `Squidy createInstance failed: HTTP ${res.status} — ${JSON.stringify(data)}`,
    );
  }
  return data as SquidyCreateInstanceResponse;
}

export async function squidyLookup(domains: string[]): Promise<SquidyLookupResponse> {
  const url = `${SQUIDY_BASE_URL}/api/v1/instances/lookup`;
  console.log(`[Squidy] POST ${url} domains=${domains.join(",")}`);
  const res = await fetch(url, {
    method: "POST",
    headers: getSquidyHeaders(),
    body: JSON.stringify({ domains }),
  });
  const data = await res.json().catch(() => ({}));
  console.log(`[Squidy] lookup response status=${res.status}`, JSON.stringify(data));
  if (!res.ok) {
    throw new Error(
      `Squidy lookup failed: HTTP ${res.status} — ${JSON.stringify(data)}`,
    );
  }
  if (Array.isArray(data)) {
    return { instances: data as SquidyInstance[] };
  }
  if (data && typeof data === "object" && Array.isArray((data as { instances?: unknown }).instances)) {
    return data as SquidyLookupResponse;
  }
  return { instances: [] };
}

export async function squidyDelete(instanceId: string): Promise<void> {
  const url = `${SQUIDY_BASE_URL}/api/v1/instances/${encodeURIComponent(instanceId)}`;
  console.log(`[Squidy] DELETE ${url}`);
  const res = await fetch(url, {
    method: "DELETE",
    headers: getSquidyHeaders(),
  });
  const text = await res.text().catch(() => "");
  console.log(`[Squidy] delete response status=${res.status}`, text);
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Squidy delete failed: HTTP ${res.status} — ${text}`,
    );
  }
}

function getAppSsoBearer(appName: string): string {
  const envKey = `SSO_TOKEN_${appName.toUpperCase()}`;
  const token = process.env[envKey];
  if (!token) {
    throw new Error(`${envKey} environment variable is required to call ${appName} SSO endpoint`);
  }
  return token;
}

export async function fetchAppSsoToken(appName: string, domain: string): Promise<string> {
  const url = `https://${domain}/api/sso/generate-token`;
  console.log(`[Squidy] GET ${url}`);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${getAppSsoBearer(appName)}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  console.log(`[Squidy] sso-token response status=${res.status}`, JSON.stringify(data));
  if (!res.ok) {
    throw new Error(`SSO token request failed: HTTP ${res.status} — ${JSON.stringify(data)}`);
  }
  const token = (data as { token?: unknown }).token;
  if (typeof token !== "string" || !token) {
    throw new Error("SSO token response missing token");
  }
  return token;
}

export function buildSsoRedirectUrl(
  appName: string,
  domain: string,
  token: string,
): string {
  const t = encodeURIComponent(token);
  switch (appName) {
    case "diytrax":
      return `https://${domain}/manage#!/login?token=${t}`;
    case "metricmover":
    case "pixelpress":
      return `https://${domain}/#!/login?token=${t}`;
    case "gifster":
      return `https://${domain}/auth/loginByToken?token=${t}`;
    case "noescape":
      return `https://${domain}/#?token=${t}`;
    default:
      throw new Error(`Unknown app for SSO redirect: ${appName}`);
  }
}

export async function squidyRetry(domain: string): Promise<SquidyRetryResponse> {
  const url = `${SQUIDY_BASE_URL}/api/v1/instances/retry`;
  console.log(`[Squidy] POST ${url} domain=${domain}`);
  const res = await fetch(url, {
    method: "POST",
    headers: getSquidyHeaders(),
    body: JSON.stringify({ domain }),
  });
  const data = await res.json().catch(() => ({}));
  console.log(`[Squidy] retry response status=${res.status}`, JSON.stringify(data));
  if (!res.ok) {
    throw new Error(
      `Squidy retry failed: HTTP ${res.status} — ${JSON.stringify(data)}`,
    );
  }
  return data as SquidyRetryResponse;
}
