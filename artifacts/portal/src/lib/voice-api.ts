import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function voiceFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    const err: any = new Error(data.message || data.error || `Request failed with status ${res.status}`);
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export interface VoiceStatus {
  has_access: boolean;
  daily_cap_seconds: number;
  seconds_used_today: number;
  seconds_remaining: number;
}

export interface WebCallResponse {
  access_token: string;
  call_id: string;
}

export interface VoiceCallRecord {
  id: number;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  summary: string | null;
  transcript: string | null;
  disconnect_reason: string | null;
}

export interface VoiceCallsResponse {
  calls: VoiceCallRecord[];
  limit: number;
  offset: number;
  has_more: boolean;
}

export function useVoiceStatus() {
  return useQuery<VoiceStatus>({
    queryKey: ["voice", "status"],
    queryFn: () => voiceFetch("/voice/status"),
    staleTime: 30_000,
  });
}

export type VoiceCallsRange = "7d" | "30d" | "all";

export interface VoiceCallsCustomRange {
  from?: string;
  to?: string;
}

export function useVoiceCalls(
  limit = 10,
  offset = 0,
  q = "",
  range: VoiceCallsRange = "all",
  custom: VoiceCallsCustomRange = {},
) {
  const from = custom.from ?? "";
  const to = custom.to ?? "";
  const hasCustom = from !== "" || to !== "";
  return useQuery<VoiceCallsResponse>({
    queryKey: ["voice", "calls", limit, offset, q, range, from, to],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (q) params.set("q", q);
      if (hasCustom) {
        if (from) params.set("from", from);
        if (to) params.set("to", to);
      } else if (range !== "all") {
        params.set("range", range);
      }
      return voiceFetch(`/voice/calls?${params.toString()}`);
    },
    staleTime: 30_000,
  });
}

export function useStartWebCall() {
  const queryClient = useQueryClient();
  return useMutation<WebCallResponse, Error>({
    mutationFn: () =>
      voiceFetch("/voice/web-call", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voice", "status"] });
    },
  });
}
