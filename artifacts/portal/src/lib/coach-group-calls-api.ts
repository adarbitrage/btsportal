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

const ROOT_KEY = "/api/coach/group-calls";
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
