import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getListCoachesQueryKey } from "@workspace/api-client-react";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function adminFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
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
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json();
}

const LIST_KEY = "/api/admin/coaching/coaches";

export interface AdminCoach {
  id: number;
  name: string;
  specialties: string;
  bio: string;
  photoUrl: string | null;
}

export interface CoachProfileInput {
  name: string;
  specialties: string;
  bio: string;
  photoUrl: string | null;
}

export function useAdminCoaches() {
  return useQuery({
    queryKey: [LIST_KEY],
    queryFn: () => adminFetch<{ coaches: AdminCoach[] }>("/admin/coaching/coaches"),
  });
}

export function useUpdateCoach() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: CoachProfileInput & { id: number }) =>
      adminFetch<AdminCoach>(`/admin/coaching/coaches/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
      // Refresh the member-facing "Your Coaches" grid so edits show immediately.
      queryClient.invalidateQueries({ queryKey: getListCoachesQueryKey() });
    },
  });
}
