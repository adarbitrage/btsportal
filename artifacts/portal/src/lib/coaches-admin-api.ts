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

export interface CoachAwayPeriod {
  id: number;
  startDate: string;
  endDate: string;
  reason: string | null;
  isActive: boolean;
}

export interface AdminCoach {
  id: number;
  name: string;
  specialties: string;
  bio: string;
  photoUrl: string | null;
  callTypes: string[];
  timezone: string;
  sortOrder: number;
  isActive: boolean;
  doesGroupCalls: boolean;
  doesPrivateCoaching: boolean;
  // Active + upcoming away periods (past ones are omitted by the API).
  awayPeriods: CoachAwayPeriod[];
}

export interface AwayPeriodInput {
  startDate: string;
  endDate: string;
  reason?: string;
}

export interface CoachProfileInput {
  name: string;
  specialties: string;
  bio: string;
  photoUrl: string | null;
  callTypes: string[];
  timezone: string;
  isActive: boolean;
  doesGroupCalls: boolean;
  doesPrivateCoaching: boolean;
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
  // App-bundled static asset shipped in the portal's public dir, stored as a
  // root-relative path (e.g. "/coaching-photos/sasha.png"). Make it base-path
  // aware so it resolves behind the artifact's path prefix.
  if (trimmed.startsWith("/")) {
    return `${import.meta.env.BASE_URL}${trimmed.slice(1)}`;
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

// Invalidate both the admin roster list and the member-facing "Your Coaches"
// grid so add / edit / remove changes show immediately in both places.
function useInvalidateCoaches() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
    queryClient.invalidateQueries({ queryKey: getListCoachesQueryKey() });
  };
}

export function useCreateCoach() {
  const invalidate = useInvalidateCoaches();
  return useMutation({
    mutationFn: (input: CoachProfileInput) =>
      adminFetch<AdminCoach>("/admin/coaching/coaches", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateCoach() {
  const invalidate = useInvalidateCoaches();
  return useMutation({
    mutationFn: ({ id, ...input }: CoachProfileInput & { id: number }) =>
      adminFetch<AdminCoach>(`/admin/coaching/coaches/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteCoach() {
  const invalidate = useInvalidateCoaches();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch<{ ok: true }>(`/admin/coaching/coaches/${id}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });
}

// Persist a new display order for coaches. Sends the full ordered list of ids;
// the server rewrites each coach's sortOrder to its index. Optimistically
// reorders the cached list so the UI reflects the change instantly, rolling back
// if the request fails.
export function useReorderCoaches() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      adminFetch<{ coaches: AdminCoach[] }>("/admin/coaching/coaches/order", {
        method: "PUT",
        body: JSON.stringify({ ids }),
      }),
    onMutate: async (ids: number[]) => {
      await queryClient.cancelQueries({ queryKey: [LIST_KEY] });
      const previous = queryClient.getQueryData<{ coaches: AdminCoach[] }>([
        LIST_KEY,
      ]);
      if (previous) {
        const byId = new Map(previous.coaches.map((c) => [c.id, c]));
        const reordered = ids
          .map((id) => byId.get(id))
          .filter((c): c is AdminCoach => c !== undefined)
          .map((c, index) => ({ ...c, sortOrder: index }));
        queryClient.setQueryData([LIST_KEY], { coaches: reordered });
      }
      return { previous };
    },
    onError: (_err, _ids, context) => {
      if (context?.previous) {
        queryClient.setQueryData([LIST_KEY], context.previous);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData([LIST_KEY], data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
      // Reflect the new order on the member-facing "Your Coaches" grid.
      queryClient.invalidateQueries({ queryKey: getListCoachesQueryKey() });
    },
  });
}

export interface CoachCall {
  id: number;
  title: string;
  callType: string;
  scheduledAt: string;
  durationMinutes: number;
  registeredCount: number;
}

// Fetch the scheduled coaching calls assigned to a coach. Used by the delete
// flow to show which calls are blocking removal so the admin can reassign or
// cancel them. `enabled` lets the caller defer the fetch until a coach is
// actually selected for deletion.
export function useCoachCalls(coachId: number | null) {
  return useQuery({
    queryKey: [LIST_KEY, coachId, "calls"],
    queryFn: () =>
      adminFetch<{ calls: CoachCall[] }>(
        `/admin/coaching/coaches/${coachId}/calls`,
      ),
    enabled: coachId !== null,
  });
}

// Reassign all of a coach's scheduled calls to another coach, clearing the FK
// references that block deletion.
export function useReassignCoachCalls() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fromCoachId, toCoachId }: { fromCoachId: number; toCoachId: number }) =>
      adminFetch<{ reassigned: number }>(
        `/admin/coaching/coaches/${fromCoachId}/reassign-calls`,
        {
          method: "POST",
          body: JSON.stringify({ toCoachId }),
        },
      ),
    onSuccess: (_data, { fromCoachId }) => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY, fromCoachId, "calls"] });
    },
  });
}

// Cancel (delete) all of a coach's scheduled calls, the alternative path to
// clearing the references that block deletion.
export function useCancelCoachCalls() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (coachId: number) =>
      adminFetch<{ cancelled: number }>(
        `/admin/coaching/coaches/${coachId}/cancel-calls`,
        { method: "POST" },
      ),
    onSuccess: (_data, coachId) => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY, coachId, "calls"] });
    },
  });
}

// Mark a coach as away for a date range. While the period is active the coach
// is hidden from the member "Your Coaches" grid and is not bookable for private
// coaching. Invalidate both the admin roster (to show the new period) and the
// member grid (the coach may need to vanish immediately if it's active today).
export function useAddCoachAwayPeriod() {
  const invalidate = useInvalidateCoaches();
  return useMutation({
    mutationFn: ({ coachId, ...input }: AwayPeriodInput & { coachId: number }) =>
      adminFetch<CoachAwayPeriod>(`/admin/coaching/coaches/${coachId}/away`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

// Remove an away period (cancel a planned absence or end one early). The coach
// reappears on the member grid as soon as no active period covers today.
export function useRemoveCoachAwayPeriod() {
  const invalidate = useInvalidateCoaches();
  return useMutation({
    mutationFn: ({ coachId, awayId }: { coachId: number; awayId: number }) =>
      adminFetch<{ ok: true }>(
        `/admin/coaching/coaches/${coachId}/away/${awayId}`,
        { method: "DELETE" },
      ),
    onSuccess: invalidate,
  });
}
