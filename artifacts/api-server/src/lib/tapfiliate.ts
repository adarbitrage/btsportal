const TAPFILIATE_BASE = "https://api.tapfiliate.com/1.6";

export class TapfiliateConfigError extends Error {
  constructor() {
    super(
      "TAPFILIATE_API_KEY is not configured. Set the secret to enable Tapfiliate affiliate link resolution.",
    );
    this.name = "TapfiliateConfigError";
  }
}

export class TapfiliateApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(`Tapfiliate API error ${status}: ${message}`);
    this.name = "TapfiliateApiError";
  }
}

function getApiKey(): string {
  const key = process.env.TAPFILIATE_API_KEY;
  if (!key) throw new TapfiliateConfigError();
  return key;
}

async function tapRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const apiKey = getApiKey();
  const url = `${TAPFILIATE_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new TapfiliateApiError(res.status, text);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface TapfiliateAffiliate {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
}

export interface TapfiliateProgram {
  id: string;
  title: string;
}

export interface TapfiliateReferralLink {
  link: string;
  asset?: { id: string };
}

export async function findAffiliateByEmail(
  email: string,
): Promise<TapfiliateAffiliate | null> {
  const results = await tapRequest<TapfiliateAffiliate[]>(
    "GET",
    `/affiliates/?email=${encodeURIComponent(email)}`,
  );
  return results.length > 0 ? results[0] : null;
}

export async function createAffiliate(
  email: string,
  fullName: string,
): Promise<TapfiliateAffiliate> {
  const parts = fullName.trim().split(/\s+/);
  const firstname = parts[0] ?? "";
  const lastname = parts.slice(1).join(" ") || "-";
  return tapRequest<TapfiliateAffiliate>("POST", "/affiliates/", {
    email,
    firstname,
    lastname,
  });
}

export async function listPrograms(): Promise<TapfiliateProgram[]> {
  return tapRequest<TapfiliateProgram[]>("GET", "/programs/");
}

export async function enrollAffiliateInProgram(
  affiliateId: string,
  programId: string,
): Promise<void> {
  try {
    await tapRequest("POST", `/programs/${programId}/affiliates/`, {
      affiliate: { id: affiliateId },
    });
  } catch (err) {
    if (err instanceof TapfiliateApiError && err.status === 409) {
      return;
    }
    throw err;
  }
}

export async function getAffiliateReferralLinks(
  affiliateId: string,
  programId: string,
): Promise<TapfiliateReferralLink[]> {
  return tapRequest<TapfiliateReferralLink[]>(
    "GET",
    `/affiliates/${affiliateId}/programs/${programId}/referral-links/`,
  );
}
