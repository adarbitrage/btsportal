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

// Resolve a stored coach photo value to a renderable <img> src. Absolute
// http(s) URLs (paste-a-URL flow) are returned as-is. Internal object-storage
// paths ("/objects/...") from the upload flow are prefixed with the storage
// serving route, base-path aware so it works behind the artifact's path prefix.
export function resolveCoachPhotoUrl(
  photoUrl: string | null | undefined,
): string | null {
  if (!photoUrl) return null;
  const trimmed = photoUrl.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/objects/")) {
    return `${import.meta.env.BASE_URL}api/storage${trimmed}`;
  }
  return trimmed;
}

// Upload a coach photo to object storage via the two-step presigned-URL flow
// and return the internal object path ("/objects/...") to store on the coach.
export async function uploadCoachPhoto(file: File): Promise<string> {
  const meta = await adminFetch<{ uploadURL: string; objectPath: string }>(
    "/storage/uploads/request-url",
    {
      method: "POST",
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        contentType: file.type,
      }),
    },
  );
  const put = await fetch(meta.uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!put.ok) {
    throw new Error("Upload failed. Please try again.");
  }
  return meta.objectPath;
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

export function useCreateCoach() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CoachProfileInput) =>
      adminFetch<AdminCoach>("/admin/coaching/coaches", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
      // A new coach is a group-call coach, so it shows up on the member page.
      queryClient.invalidateQueries({ queryKey: getListCoachesQueryKey() });
    },
  });
}

export function useDeleteCoach() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch<{ ok: true }>(`/admin/coaching/coaches/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
      // Drop the removed coach from the member-facing "Your Coaches" grid.
      queryClient.invalidateQueries({ queryKey: getListCoachesQueryKey() });
    },
  });
}
