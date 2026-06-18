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
  // The signed-in coach's own coach id, or null when the caller is an admin
  // with coaching:view but no coach profile (they see every coach's calls).
  coachId: number | null;
  calls: CoachGroupCall[];
}

const ROOT_KEY = "/api/coach/group-calls";

export function useCoachGroupCalls() {
  return useQuery<CoachGroupCallsResponse>({
    queryKey: [ROOT_KEY],
    queryFn: () => coachFetch("/coach/group-calls"),
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
