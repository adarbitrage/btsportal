import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

export interface CoachGoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  status: string | null;
  connectedAt: string | null;
}

const STATUS_KEY = "/api/coach/google/status";

export function useCoachGoogleStatus() {
  return useQuery<CoachGoogleStatus>({
    queryKey: [STATUS_KEY],
    queryFn: () => coachFetch("/coach/google/status"),
  });
}

// Full-page navigation so Google's consent screen replaces the tab; the
// SameSite=Strict auth cookie rides along on this same-origin GET.
export function startGoogleConnect() {
  window.location.href = `${API_BASE}/coach/google/connect`;
}

export function useCoachGoogleDisconnect() {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean }, Error, void>({
    mutationFn: () =>
      coachFetch("/coach/google/disconnect", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [STATUS_KEY] }),
  });
}
