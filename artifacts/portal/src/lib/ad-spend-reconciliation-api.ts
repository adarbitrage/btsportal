import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function adminFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const data: { error?: unknown } = await res.json().catch(() => ({ error: "Request failed" }));
    const message =
      typeof data.error === "string"
        ? data.error
        : data.error && typeof data.error === "object" && typeof (data.error as { message?: unknown }).message === "string"
          ? (data.error as { message: string }).message
          : `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text);
}

export interface AdSpendReconciliationRow {
  orderNumber: string;
  chargedCents: number;
  currency: string | null;
  createdAt: string | null;
  userId: number | null;
  email: string | null;
  name: string | null;
  transactionId: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  creditedCents: number | null;
}

export interface AdSpendReconciliationListResponse {
  reconciliations: AdSpendReconciliationRow[];
  openCount: number;
}

export interface AdSpendResolveResponse {
  outcome: "resolved";
  orderNumber: string;
  creditedCents: number;
  feeCents: number;
  chargedCents: number;
  creditInserted: boolean;
}

export function useAdSpendReconciliations(includeResolved: boolean) {
  return useQuery({
    queryKey: ["ad-spend-reconciliations", includeResolved],
    queryFn: () =>
      adminFetch<AdSpendReconciliationListResponse>(
        `/admin/ad-spend/reconciliations${includeResolved ? "?includeResolved=1" : ""}`,
      ),
  });
}

export function useResolveAdSpendReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderNumber: string) =>
      adminFetch<AdSpendResolveResponse>(
        `/admin/ad-spend/reconciliations/${encodeURIComponent(orderNumber)}/resolve`,
        { method: "POST" },
      ),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["ad-spend-reconciliations"] });
    },
  });
}
