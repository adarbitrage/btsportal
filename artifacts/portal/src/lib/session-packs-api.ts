import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function sessionFetch(path: string, options?: RequestInit) {
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
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export interface SessionCoach {
  id: number;
  name: string;
  bio: string | null;
  photoUrl: string | null;
  sortOrder: number;
}

export interface SessionSlot {
  startTime: string;
}

export interface SessionBooking {
  id: number;
  coachId: number;
  coachName: string;
  coachPhotoUrl: string | null;
  scheduledAt: string;
  endAt: string;
  durationMinutes: number;
  meetLink: string | null;
  status: string;
  title: string | null;
  discussionTopic: string | null;
  cancelledAt: string | null;
  createdAt: string;
  // Recording-ingest outputs. Only present on completed sessions; the API
  // strips them on every other status (and never returns coach-only notes).
  recordingUrl?: string | null;
  summaryUrl?: string | null;
  transcriptUrl?: string | null;
}

const ROOT_KEY = "/api/coaching/sessions";

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === "string" && key.startsWith(ROOT_KEY);
    },
  });
}

export function useSessionBalance() {
  return useQuery<{ balance: number }>({
    queryKey: [`${ROOT_KEY}/balance`],
    queryFn: () => sessionFetch("/coaching/sessions/balance"),
  });
}

export function useSessionCoaches() {
  return useQuery<SessionCoach[]>({
    queryKey: [`${ROOT_KEY}/coaches`],
    queryFn: () => sessionFetch("/coaching/sessions/coaches"),
  });
}

export function useSessionCoachSlots(coachId: number, startDate: string, endDate: string) {
  return useQuery<{ coachId: number; slots: SessionSlot[] }>({
    queryKey: [`${ROOT_KEY}/slots`, coachId, startDate, endDate],
    queryFn: () =>
      sessionFetch(
        `/coaching/sessions/coaches/${coachId}/slots?startDate=${startDate}&endDate=${endDate}`,
      ),
    enabled: coachId > 0 && !!startDate && !!endDate,
  });
}

export function useMySessionBookings(params?: { status?: string }) {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  const qs = search.toString();
  return useQuery<SessionBooking[]>({
    queryKey: [`${ROOT_KEY}/mine`, params],
    queryFn: () => sessionFetch(`/coaching/sessions/mine${qs ? `?${qs}` : ""}`),
  });
}

export function useBookSessionPack() {
  const queryClient = useQueryClient();
  return useMutation<
    { booking: SessionBooking; balance: number },
    Error,
    { coachId: number; startTime: string; discussionTopic?: string }
  >({
    mutationFn: (data) =>
      sessionFetch("/coaching/sessions/book", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useCancelSessionBooking() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: boolean; refunded: boolean; balance: number },
    Error,
    { bookingId: number }
  >({
    mutationFn: ({ bookingId }) =>
      sessionFetch(`/coaching/sessions/${bookingId}/cancel`, { method: "PATCH" }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useRescheduleSessionBooking() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: boolean; booking: SessionBooking },
    Error,
    { bookingId: number; startTime: string }
  >({
    mutationFn: ({ bookingId, startTime }) =>
      sessionFetch(`/coaching/sessions/${bookingId}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify({ startTime }),
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}
