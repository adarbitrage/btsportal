import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function vaFetch(path: string, options?: RequestInit) {
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

export interface Va {
  id: number;
  name: string;
  bio: string | null;
  photoUrl: string | null;
  sortOrder: number;
}

export interface VaSlot {
  startTime: string;
}

export interface VaBusyBlock {
  start: string;
  end: string;
}

export interface VaBusyResponse {
  connected: boolean;
  busy: VaBusyBlock[];
}

// VA calls are free (no credit balance), but completed calls DO surface their
// Meet recording + Gemini notes/transcript (auto-linked by the shared
// recording-ingest). The recording fields are present only on completed calls.
export interface VaCall {
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
  recordingUrl?: string | null;
  summaryUrl?: string | null;
  transcriptUrl?: string | null;
}

// Step-3 intake captured at booking time. Currently captured + validated only;
// it is sent in the book payload for forward-compatibility but is NOT yet wired
// to GHL on the server (the appointment note still carries discussionTopic).
export interface VaCallIntake {
  typeOfRequest: string;
  concernArea: string;
  alreadyContacted: "yes" | "no";
  relatedTicket?: string;
  callDurationAck: boolean;
  scopeAck: boolean;
}

const ROOT_KEY = "/api/coaching/va-calls";

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === "string" && key.startsWith(ROOT_KEY);
    },
  });
}

// The VA roster is shared with the private-coaching engine endpoint, which
// already filters to VAs offering 1-on-1 calls (first-name display).
export function useVaList() {
  return useQuery<Va[]>({
    queryKey: ["/api/coaching/sessions/vas"],
    queryFn: () => vaFetch("/coaching/sessions/vas"),
  });
}

export function useVaSlots(vaId: number, startDate: string, endDate: string) {
  return useQuery<{ coachId: number; slots: VaSlot[] }>({
    queryKey: [`${ROOT_KEY}/slots`, vaId, startDate, endDate],
    queryFn: () =>
      vaFetch(
        `/coaching/va-calls/vas/${vaId}/slots?startDate=${startDate}&endDate=${endDate}`,
      ),
    enabled: vaId > 0 && !!startDate && !!endDate,
  });
}

export function useVaBusy(vaId: number, from: string, to: string) {
  return useQuery<VaBusyResponse>({
    queryKey: [`${ROOT_KEY}/calendar-busy`, vaId, from, to],
    queryFn: () =>
      vaFetch(
        `/coaching/va-calls/vas/${vaId}/calendar-busy?from=${encodeURIComponent(
          from,
        )}&to=${encodeURIComponent(to)}`,
      ),
    enabled: vaId > 0 && !!from && !!to,
  });
}

export function useMyVaCalls(params?: { status?: string; enabled?: boolean }) {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  const qs = search.toString();
  return useQuery<VaCall[]>({
    queryKey: [`${ROOT_KEY}/mine`, { status: params?.status }],
    queryFn: () => vaFetch(`/coaching/va-calls/mine${qs ? `?${qs}` : ""}`),
    enabled: params?.enabled ?? true,
  });
}

export function useBookVaCall() {
  const queryClient = useQueryClient();
  return useMutation<
    { booking: VaCall },
    Error,
    {
      coachId: number;
      startTime: string;
      discussionTopic?: string;
      intake?: VaCallIntake;
    }
  >({
    mutationFn: (data) =>
      vaFetch("/coaching/va-calls/book", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useCancelVaCall() {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean }, Error, { bookingId: number }>({
    mutationFn: ({ bookingId }) =>
      vaFetch(`/coaching/va-calls/${bookingId}/cancel`, { method: "PATCH" }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useRescheduleVaCall() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: boolean; booking: VaCall },
    Error,
    { bookingId: number; startTime: string }
  >({
    mutationFn: ({ bookingId, startTime }) =>
      vaFetch(`/coaching/va-calls/${bookingId}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify({ startTime }),
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}
