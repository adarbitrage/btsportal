import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

export interface CoachGroupCall {
  id: number;
  title: string;
  coachId: number;
  coachName: string;
  scheduledAt: string;
  durationMinutes: number;
  registeredCount: number;
  cancelled: boolean;
  cancelledAt: string | null;
}

export interface CoachGroupCallsResponse {
  // The signed-in coach's own coach id, or null for an admin (who is never
  // pinned to a single coach). Use `isAdmin` — NOT this field — to decide
  // whether to show the coach picker, since an unlinked plain coach also
  // reports a null coachId.
  coachId: number | null;
  // True when the caller is an admin with coaching:view. Admins get the coach
  // picker and may scope the calendar to any coach via `coachId` below.
  isAdmin: boolean;
  calls: CoachGroupCall[];
}

export interface PickerCoach {
  id: number;
  name: string;
}

// A busy interval pulled from the coach's external Google Calendar (free/busy
// only — no event titles). Used to overlay conflicts on the month grid.
export interface CalendarBusyBlock {
  start: string;
  end: string;
}

export interface CoachCalendarBusyResponse {
  // True only when the scoped coach has a live Google Calendar connection.
  connected: boolean;
  // True when the coach is connected for Drive but never granted the calendar
  // scope (an older connection) — the UI prompts a reconnect.
  needsReconnect?: boolean;
  busy: CalendarBusyBlock[];
}

const ROOT_KEY = "/api/coach/group-calls";
const BUSY_KEY = "/api/coach/group-calls/calendar-busy";
const COACHES_KEY = "/api/admin/coaching/coaches";

// Loads one coach's calendar. Plain coaches are pinned server-side to their own
// schedule (the coachId param is ignored for them); admins pass a coachId to
// scope to a single coach, or null/undefined for the all-coaches view.
export function useCoachGroupCalls(coachId?: number | null) {
  const query =
    coachId != null ? `?coachId=${encodeURIComponent(coachId)}` : "";
  return useQuery<CoachGroupCallsResponse>({
    queryKey: [ROOT_KEY, coachId ?? "self"],
    queryFn: () => coachFetch(`/coach/group-calls${query}`),
  });
}

// Admin-only: the full coach roster (including coaches with no login) used to
// populate the calendar's coach picker. Gated behind `enabled` so plain coaches
// never hit the admin endpoint (which would 403).
export function useGroupCoachingCoaches(enabled: boolean) {
  return useQuery<PickerCoach[]>({
    queryKey: [COACHES_KEY, "picker"],
    enabled,
    queryFn: async () => {
      const data = await coachFetch("/admin/coaching/coaches");
      const coaches: Array<{ id: number; name: string }> = data?.coaches ?? [];
      return coaches.map((c) => ({ id: c.id, name: c.name }));
    },
  });
}

// Loads the scoped coach's external Google Calendar busy blocks for a window.
// `from`/`to` are ISO instants spanning the visible month grid. Pass the same
// coachId used for the calendar (null = the signed-in coach's own / the admin
// all-coaches view, which the server reports as not-connected). Disabled until a
// window is known so we never fire an unbounded query.
export function useCoachCalendarBusy(
  coachId: number | null | undefined,
  from: string | null,
  to: string | null,
) {
  const params = new URLSearchParams();
  if (coachId != null) params.set("coachId", String(coachId));
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return useQuery<CoachCalendarBusyResponse>({
    queryKey: [BUSY_KEY, coachId ?? "self", from, to],
    enabled: Boolean(from && to),
    queryFn: () => coachFetch(`/coach/group-calls/calendar-busy?${query}`),
  });
}

export interface GroupCallRosterMember {
  userId: number;
  name: string;
  email: string;
  rsvpd: boolean;
  joined: boolean;
}

export interface GroupCallRosterResponse {
  callId: number;
  rsvpCount: number;
  joinedCount: number;
  members: GroupCallRosterMember[];
}

// Who has RSVP'd (and actually joined) a specific group call. Scoped
// server-side: a coach can only read rosters for their own calls; admins any.
// Disabled until a call is expanded so collapsed rows never fire a request.
export function useGroupCallRoster(callId: number | null) {
  return useQuery<GroupCallRosterResponse>({
    queryKey: [ROOT_KEY, "roster", callId],
    enabled: callId !== null,
    queryFn: () => coachFetch(`/coach/group-calls/${callId}/roster`),
  });
}

function useGroupCallMutation(action: "cancel" | "restore") {
  const queryClient = useQueryClient();
  return useMutation<{ id: number; cancelled: boolean }, Error, number>({
    mutationFn: (callId) =>
      coachFetch(`/coach/group-calls/${callId}/${action}`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ROOT_KEY] });
    },
  });
}

export function useCancelGroupCall() {
  return useGroupCallMutation("cancel");
}

export function useRestoreGroupCall() {
  return useGroupCallMutation("restore");
}
