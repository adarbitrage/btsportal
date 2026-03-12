import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function coachingFetch(path: string, options?: RequestInit) {
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

export interface CoachAvailabilitySlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface OneOnOneCoach {
  id: number;
  name: string;
  bio: string;
  photoUrl: string | null;
  specialties: string;
  timezone: string;
  averageRating: number | null;
  totalRatings: number;
  availability: CoachAvailabilitySlot[];
}

export interface OneOnOneSession {
  id: number;
  coachId: number;
  coachName: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  meetLink: string | null;
  createdAt: string;
}

export interface SessionDetail extends OneOnOneSession {
  coachPhotoUrl: string | null;
  memberId: number;
  memberNotes: string | null;
  coachNotes: string | null;
  actionItems: ActionItem[] | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  creditReturned: boolean | null;
  rescheduledFromId: number | null;
  rescheduledToId: number | null;
  updatedAt: string | null;
  rating: { rating: number; comment: string | null; createdAt: string } | null;
}

export interface ActionItem {
  id: string;
  text: string;
  completed: boolean;
  completedAt?: string;
}

export interface CoachingStatus {
  eligible: boolean;
  frequency: "weekly" | "monthly" | null;
  sessionsUsed: number;
  sessionsLimit: number;
  periodStart: string | null;
  periodEnd: string | null;
  upcomingSession: {
    id: number;
    scheduledAt: string;
    durationMinutes: number;
    status: string;
    coachName: string;
    meetLink: string | null;
  } | null;
}

export interface TimeSlot {
  startTime: string;
  endTime: string;
}

export function useCoachingStatus() {
  return useQuery<CoachingStatus>({
    queryKey: ["/api/coaching/one-on-one/status"],
    queryFn: () => coachingFetch("/coaching/one-on-one/status"),
  });
}

export function useOneOnOneSessions(params?: { status?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  const qs = searchParams.toString();
  return useQuery<OneOnOneSession[]>({
    queryKey: ["/api/coaching/one-on-one/sessions", params],
    queryFn: () => coachingFetch(`/coaching/one-on-one/sessions${qs ? `?${qs}` : ""}`),
  });
}

export function useOneOnOneSession(id: number) {
  return useQuery<SessionDetail>({
    queryKey: ["/api/coaching/one-on-one/sessions", id],
    queryFn: () => coachingFetch(`/coaching/one-on-one/sessions/${id}`),
    enabled: id > 0,
  });
}

export function useOneOnOneCoaches() {
  return useQuery<OneOnOneCoach[]>({
    queryKey: ["/api/coaching/one-on-one/coaches"],
    queryFn: () => coachingFetch("/coaching/one-on-one/coaches"),
  });
}

export function useCoachSlots(coachId: number, startDate: string, endDate: string, timezone: string) {
  return useQuery<{ slots: TimeSlot[] }>({
    queryKey: ["/api/coaching/one-on-one/slots", coachId, startDate, endDate],
    queryFn: () =>
      coachingFetch(
        `/coaching/one-on-one/slots?coachId=${coachId}&startDate=${startDate}&endDate=${endDate}&timezone=${encodeURIComponent(timezone)}`
      ),
    enabled: coachId > 0 && !!startDate && !!endDate,
  });
}

function invalidateAllCoachingQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === "string" && key.startsWith("/api/coaching/one-on-one");
    },
  });
}

export function useBookSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { coachId: number; startTime: string; memberNotes?: string }) =>
      coachingFetch("/coaching/one-on-one/book", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => invalidateAllCoachingQueries(queryClient),
  });
}

export function useRescheduleSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, newStartTime, coachId }: { sessionId: number; newStartTime: string; coachId?: number }) =>
      coachingFetch(`/coaching/one-on-one/sessions/${sessionId}/reschedule`, {
        method: "POST",
        body: JSON.stringify({ newStartTime, coachId }),
      }),
    onSuccess: () => invalidateAllCoachingQueries(queryClient),
  });
}

export function useCancelSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, reason }: { sessionId: number; reason?: string }) =>
      coachingFetch(`/coaching/one-on-one/sessions/${sessionId}/cancel`, {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => invalidateAllCoachingQueries(queryClient),
  });
}

export function useToggleActionItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, actionItemId, completed }: { sessionId: number; actionItemId: string; completed: boolean }) =>
      coachingFetch(`/coaching/one-on-one/sessions/${sessionId}/action-items`, {
        method: "PATCH",
        body: JSON.stringify({ actionItemId, completed }),
      }),
    onSuccess: () => invalidateAllCoachingQueries(queryClient),
  });
}

export function useRateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, rating, comment }: { sessionId: number; rating: number; comment?: string }) =>
      coachingFetch(`/coaching/one-on-one/sessions/${sessionId}/rate`, {
        method: "POST",
        body: JSON.stringify({ rating, comment }),
      }),
    onSuccess: () => invalidateAllCoachingQueries(queryClient),
  });
}
