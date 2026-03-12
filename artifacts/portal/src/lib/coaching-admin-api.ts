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
  return res.json();
}

export interface CoachDetail {
  id: number;
  name: string;
  bio: string;
  photoUrl: string | null;
  specialties: string;
  callTypes: string[];
  oneOnOneEnabled: boolean;
  meetLink: string | null;
  timezone: string;
  maxDailySessions: number;
  availability: AvailabilitySlot[];
  overrides: AvailabilityOverride[];
}

export interface AvailabilitySlot {
  id: number;
  coachId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  sessionDurationMinutes: number;
  bufferMinutes: number;
}

export interface AvailabilityOverride {
  id: number;
  coachId: number;
  overrideDate: string;
  overrideType: string;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

export interface CoachingSessionItem {
  id: number;
  coachId: number;
  coachName: string;
  memberId: number;
  memberName: string;
  memberEmail: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  meetLink: string | null;
  coachNotes: string | null;
  memberNotes: string | null;
  rating: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoachingSessionDetail extends CoachingSessionItem {
  actionItems: ActionItem[];
}

export interface ActionItem {
  id: number;
  sessionId: number;
  text: string;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CoachingAnalytics {
  sessionsThisMonth: number;
  sessionsLastMonth: number;
  completed: number;
  cancelled: number;
  noShow: number;
  scheduled: number;
  creditReturned: number;
  averageRating: number | null;
  popularCoaches: { coachId: number; coachName: string; sessionCount: number }[];
  needsNotesCount: number;
  actionItemsTotal: number;
  actionItemsCompleted: number;
}

export const coachingAdminApi = {
  getCoaches: () => adminFetch<CoachDetail[]>("/admin/coaching/coaches"),
  getCoach: (id: number) => adminFetch<CoachDetail>(`/admin/coaching/coaches/${id}`),
  updateCoach: (id: number, data: Partial<Pick<CoachDetail, "oneOnOneEnabled" | "meetLink" | "timezone" | "maxDailySessions">>) =>
    adminFetch<CoachDetail>(`/admin/coaching/coaches/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  createAvailability: (data: Omit<AvailabilitySlot, "id">) =>
    adminFetch<AvailabilitySlot>("/admin/coaching/availability", { method: "POST", body: JSON.stringify(data) }),
  updateAvailability: (id: number, data: Partial<AvailabilitySlot>) =>
    adminFetch<AvailabilitySlot>(`/admin/coaching/availability/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteAvailability: (id: number) =>
    adminFetch(`/admin/coaching/availability/${id}`, { method: "DELETE" }),

  createOverride: (data: Omit<AvailabilityOverride, "id">) =>
    adminFetch<AvailabilityOverride>("/admin/coaching/overrides", { method: "POST", body: JSON.stringify(data) }),
  updateOverride: (id: number, data: Partial<AvailabilityOverride>) =>
    adminFetch<AvailabilityOverride>(`/admin/coaching/overrides/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteOverride: (id: number) =>
    adminFetch(`/admin/coaching/overrides/${id}`, { method: "DELETE" }),

  getSessions: (params?: { status?: string; coachId?: number; memberId?: number; dateFrom?: string; dateTo?: string; needsNotes?: boolean; noShow?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.coachId) qs.set("coachId", String(params.coachId));
    if (params?.memberId) qs.set("memberId", String(params.memberId));
    if (params?.dateFrom) qs.set("dateFrom", params.dateFrom);
    if (params?.dateTo) qs.set("dateTo", params.dateTo);
    if (params?.needsNotes) qs.set("needsNotes", "true");
    if (params?.noShow) qs.set("noShow", "true");
    return adminFetch<CoachingSessionItem[]>(`/admin/coaching/sessions?${qs.toString()}`);
  },
  getSession: (id: number) => adminFetch<CoachingSessionDetail>(`/admin/coaching/sessions/${id}`),
  updateSession: (id: number, data: Partial<Pick<CoachingSessionItem, "status" | "coachNotes" | "memberNotes" | "rating">>) =>
    adminFetch(`/admin/coaching/sessions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  returnCredit: (id: number) =>
    adminFetch(`/admin/coaching/sessions/${id}/return-credit`, { method: "POST" }),

  createActionItem: (sessionId: number, data: { text: string; dueDate?: string }) =>
    adminFetch<ActionItem>(`/admin/coaching/sessions/${sessionId}/action-items`, { method: "POST", body: JSON.stringify(data) }),
  completeActionItem: (id: number) =>
    adminFetch(`/admin/coaching/action-items/${id}/complete`, { method: "PATCH" }),
  deleteActionItem: (id: number) =>
    adminFetch(`/admin/coaching/action-items/${id}`, { method: "DELETE" }),

  getAnalytics: () => adminFetch<CoachingAnalytics>("/admin/coaching/analytics"),
};

export function useCoachingCoaches() {
  return useQuery({
    queryKey: ["/admin/coaching/coaches"],
    queryFn: () => coachingAdminApi.getCoaches(),
  });
}

export function useCoachingCoach(id: number) {
  return useQuery({
    queryKey: ["/admin/coaching/coaches", id],
    queryFn: () => coachingAdminApi.getCoach(id),
    enabled: id > 0,
  });
}

export function useCoachingSessions(params?: Parameters<typeof coachingAdminApi.getSessions>[0]) {
  return useQuery({
    queryKey: ["/admin/coaching/sessions", params],
    queryFn: () => coachingAdminApi.getSessions(params),
  });
}

export function useCoachingSession(id: number) {
  return useQuery({
    queryKey: ["/admin/coaching/sessions", id],
    queryFn: () => coachingAdminApi.getSession(id),
    enabled: id > 0,
  });
}

export function useCoachingAnalytics() {
  return useQuery({
    queryKey: ["/admin/coaching/analytics"],
    queryFn: () => coachingAdminApi.getAnalytics(),
  });
}
