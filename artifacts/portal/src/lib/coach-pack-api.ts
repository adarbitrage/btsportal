import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AdminPackBooking,
  AdminPackSessionsResponse,
  AdminPackSessionFilters,
  PackActionItem,
} from "@/lib/session-coaching-admin-api";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function coachFetch(path: string, options?: RequestInit) {
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
    const message =
      typeof data?.error === "string"
        ? data.error
        : data?.error?.message || `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return res.json();
}

const ROOT_KEY = "/api/coach/dashboard/pack";

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === "string" && key.startsWith(ROOT_KEY);
    },
  });
}

// ---------------------------------------------------------------------------
// Sessions list (coach-facing; reuses the admin booking + response shapes)
// ---------------------------------------------------------------------------

export function useCoachPackSessions(filters: AdminPackSessionFilters = {}) {
  const search = new URLSearchParams();
  if (filters.status) search.set("status", filters.status);
  if (filters.coachId) search.set("coachId", String(filters.coachId));
  if (filters.q) search.set("q", filters.q);
  if (filters.from) search.set("from", filters.from);
  if (filters.to) search.set("to", filters.to);
  if (filters.limit) search.set("limit", String(filters.limit));
  if (filters.offset) search.set("offset", String(filters.offset));
  const qs = search.toString();
  return useQuery<AdminPackSessionsResponse>({
    queryKey: [`${ROOT_KEY}/sessions`, filters],
    queryFn: () => coachFetch(`/coach/dashboard/pack/sessions${qs ? `?${qs}` : ""}`),
  });
}

// ---------------------------------------------------------------------------
// Member cross-coach history
// ---------------------------------------------------------------------------

export interface CoachPackMemberSession {
  id: number;
  coachId: number;
  coachName: string;
  scheduledAt: string;
  endAt: string;
  durationMinutes: number;
  status: string;
  title: string | null;
  coachNotes: string | null;
  actionItems: PackActionItem[];
  recordingUrl: string | null;
  summaryUrl: string | null;
  transcriptUrl: string | null;
  recordingIngestStatus: string;
  outcomeAt: string | null;
  createdAt: string;
}

export interface CoachPackMemberHistory {
  member: { id: number; name: string; email: string };
  sessions: CoachPackMemberSession[];
}

export function useCoachPackMemberHistory(memberId: number | null) {
  return useQuery<CoachPackMemberHistory>({
    queryKey: [`${ROOT_KEY}/member`, memberId],
    queryFn: () => coachFetch(`/coach/dashboard/pack/member/${memberId}`),
    enabled: !!memberId && memberId > 0,
  });
}

// ---------------------------------------------------------------------------
// Save notes / action items for a booking
// ---------------------------------------------------------------------------

export function useCoachSavePackNotes() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: boolean; booking: AdminPackBooking },
    Error,
    { bookingId: number; coachNotes?: string; actionItems?: PackActionItem[] }
  >({
    mutationFn: ({ bookingId, coachNotes, actionItems }) =>
      coachFetch(`/coach/dashboard/pack/sessions/${bookingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(coachNotes !== undefined ? { coachNotes } : {}),
          ...(actionItems !== undefined ? { actionItems } : {}),
        }),
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

// ---------------------------------------------------------------------------
// Manually attach (or clear) recording / summary / transcript links when
// auto-matching missed. Coach/admin only; never shown to members.
// ---------------------------------------------------------------------------

export interface CoachManualRecordingInput {
  bookingId: number;
  recordingUrl?: string | null;
  summaryUrl?: string | null;
  transcriptUrl?: string | null;
}

export function useCoachSetRecording() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: boolean; booking: AdminPackBooking },
    Error,
    CoachManualRecordingInput
  >({
    mutationFn: ({ bookingId, ...links }) =>
      coachFetch(`/coach/dashboard/pack/sessions/${bookingId}/recording`, {
        method: "PATCH",
        body: JSON.stringify(links),
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}
