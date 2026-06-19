import { useQuery } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

export interface AffiliateConversion {
  id: string;
  created_at: string;
  amount: string | number;
  commission_amount?: string | number;
  commission?: { amount: string | number } | null;
  status: string;
  program?: { id: string; title?: string } | null;
}

export interface AffiliateConversionsPage {
  items: AffiliateConversion[];
  hasNextPage: boolean;
  page: number;
}

export interface AffiliatePayout {
  id: string;
  created_at: string;
  amount: string | number;
  payment_method?: string | null;
  status: string;
}

export interface AffiliatePayoutsPage {
  items: AffiliatePayout[];
  hasNextPage: boolean;
  page: number;
}

export type ConversionStatusFilter = "pending" | "approved" | "disapproved";

export interface ConversionFilters {
  status?: ConversionStatusFilter;
  fromDate?: string;
  toDate?: string;
}

async function fetchPerformance<T>(
  dataset: "conversions" | "payouts",
  page: number,
  filters: ConversionFilters = {},
): Promise<T> {
  const params = new URLSearchParams();
  params.set("dataset", dataset);
  params.set("page", String(page));
  if (filters.status) params.set("status", filters.status);
  if (filters.fromDate) params.set("from_date", filters.fromDate);
  if (filters.toDate) params.set("to_date", filters.toDate);

  const res = await fetch(`${API_BASE}/affiliate/performance?${params.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { error?: string }).error ?? `Request failed with status ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

export function useAffiliateConversions(page: number, filters: ConversionFilters = {}) {
  return useQuery<AffiliateConversionsPage, Error>({
    queryKey: [
      "affiliate-performance",
      "conversions",
      page,
      filters.status ?? null,
      filters.fromDate ?? null,
      filters.toDate ?? null,
    ],
    queryFn: () => fetchPerformance<AffiliateConversionsPage>("conversions", page, filters),
    staleTime: 60_000,
  });
}

export function useAffiliatePayouts(page: number) {
  return useQuery<AffiliatePayoutsPage, Error>({
    queryKey: ["affiliate-performance", "payouts", page],
    queryFn: () => fetchPerformance<AffiliatePayoutsPage>("payouts", page),
    staleTime: 60_000,
  });
}
