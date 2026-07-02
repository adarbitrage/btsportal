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
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text);
}

export interface RefundRateBaseline {
  baselinePercent: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface MonthlyRatePoint {
  month: string;
  cohortSize: number;
  membersWithEvent: number;
  refundCount: number;
  chargebackCount: number;
  ratePercent: number | null;
}

export interface RefundCohortTrendResponse {
  trend: MonthlyRatePoint[];
  baseline: RefundRateBaseline;
  cohortSize: number;
  cohortAvailable: boolean;
}

export interface PollRunResult {
  windowStart: string;
  windowEnd: string;
  transactionsSeen: number;
  eventsClassified: number;
  eventsInserted: number;
  eventsMatched: number;
  eventsUnmatched: number;
  error: string | null;
}

export interface NmiRefundPollerStatus {
  lastRanAt: string | null;
  lastResult: PollRunResult | null;
  lastError: { at: string; message: string } | null;
}

export function useRefundRateBaseline() {
  return useQuery({
    queryKey: ["refund-metrics", "baseline"],
    queryFn: () => adminFetch<{ baseline: RefundRateBaseline }>("/admin/refund-metrics/baseline"),
  });
}

export function useSetRefundRateBaseline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (baselinePercent: number) =>
      adminFetch<{ baseline: RefundRateBaseline }>("/admin/refund-metrics/baseline", {
        method: "PUT",
        body: JSON.stringify({ baselinePercent }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["refund-metrics"] });
    },
  });
}

export function useRefundCohortTrend(months: number) {
  return useQuery({
    queryKey: ["refund-metrics", "trend", months],
    queryFn: () => adminFetch<RefundCohortTrendResponse>(`/admin/refund-metrics/trend?months=${months}`),
  });
}

export function usePollerStatus() {
  return useQuery({
    queryKey: ["refund-metrics", "poller-status"],
    queryFn: () => adminFetch<NmiRefundPollerStatus>("/admin/refund-metrics/poller-status"),
  });
}

export function usePollNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => adminFetch("/admin/refund-metrics/poll-now", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["refund-metrics"] });
    },
  });
}
