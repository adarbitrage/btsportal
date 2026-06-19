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
  const all: TapfiliateProgram[] = [];
  const seen = new Set<string>();
  const maxPages = 100;
  for (let page = 1; page <= maxPages; page++) {
    const batch = await tapRequest<TapfiliateProgram[]>(
      "GET",
      `/programs/?page=${page}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    let added = 0;
    for (const program of batch) {
      if (!seen.has(program.id)) {
        seen.add(program.id);
        all.push(program);
        added++;
      }
    }
    if (added === 0) break;
  }
  return all;
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
    if (err instanceof TapfiliateApiError) {
      // Tapfiliate signals an already-enrolled affiliate inconsistently: a 409,
      // or a 400 whose body says "Affiliate already member of program". Both
      // mean the affiliate is enrolled, which is the desired end state.
      if (
        err.status === 409 ||
        (err.status === 400 && /already member of program/i.test(err.message))
      ) {
        return;
      }
    }
    throw err;
  }
}

interface TapfiliateAffiliateInProgram {
  id: string;
  referral_link?: {
    link: string;
    asset_id?: string;
    source_id?: string;
  };
}

export interface TapfiliateConversion {
  id: string;
  created_at: string;
  amount: string | number;
  commission_amount?: string | number;
  commission?: { amount: string | number } | null;
  status: string;
  program?: { id: string; title?: string } | null;
}

export interface TapfiliateConversionsPage {
  items: TapfiliateConversion[];
  hasNextPage: boolean;
}

export type ConversionStatusFilter = "pending" | "approved" | "disapproved";

export interface ConversionFilters {
  /** Restrict to a single conversion status. */
  status?: ConversionStatusFilter;
  /** Inclusive lower bound on conversion date, formatted YYYY-MM-DD. */
  fromDate?: string;
  /** Inclusive upper bound on conversion date, formatted YYYY-MM-DD. */
  toDate?: string;
}

export async function getAffiliateConversions(
  affiliateId: string,
  page: number,
  filters: ConversionFilters = {},
): Promise<TapfiliateConversionsPage> {
  const params = new URLSearchParams();
  params.set("affiliate_id", affiliateId);
  params.set("page", String(page));
  // Tapfiliate expresses status as mutually-exclusive boolean flags rather than
  // a single status param, so map the chosen status onto the matching flag.
  if (filters.status) params.set(filters.status, "true");
  if (filters.fromDate) params.set("from_date", filters.fromDate);
  if (filters.toDate) params.set("to_date", filters.toDate);

  const items = await tapRequest<TapfiliateConversion[]>(
    "GET",
    `/conversions/?${params.toString()}`,
  );
  const list = Array.isArray(items) ? items : [];
  return { items: list, hasNextPage: list.length >= 25 };
}

export interface TapfiliatePayout {
  id: string;
  created_at: string;
  amount: string | number;
  payment_method?: string | null;
  status: string;
}

export interface TapfiliatePayoutsPage {
  items: TapfiliatePayout[];
  hasNextPage: boolean;
}

export async function getAffiliatePayouts(
  affiliateId: string,
  page: number,
): Promise<TapfiliatePayoutsPage> {
  const items = await tapRequest<TapfiliatePayout[]>(
    "GET",
    `/affiliates/${encodeURIComponent(affiliateId)}/payouts/?page=${page}`,
  );
  const list = Array.isArray(items) ? items : [];
  return { items: list, hasNextPage: list.length >= 25 };
}

export async function getAffiliateReferralLinks(
  affiliateId: string,
  programId: string,
): Promise<TapfiliateReferralLink[]> {
  const affiliateInProgram = await tapRequest<TapfiliateAffiliateInProgram>(
    "GET",
    `/programs/${programId}/affiliates/${affiliateId}/`,
  );
  const referral = affiliateInProgram.referral_link;
  if (!referral?.link) return [];
  return [
    {
      link: referral.link,
      asset: referral.asset_id ? { id: referral.asset_id } : undefined,
    },
  ];
}
