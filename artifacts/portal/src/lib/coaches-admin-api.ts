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

// Per-coach Google connection status. Drive recordings ride the OAuth grant;
// `needsCalendarReconnect` flags a grant that predates the calendar scope. Null
// when the coach has no linked portal login.
export interface CoachGoogleConnection {
  connected: boolean;
  email: string | null;
  status: string | null;
  connectedAt: string | null;
  needsCalendarReconnect: boolean;
}

// Coach kind. "strategic_coach" runs the credit-pack private-coaching flow;
// "va" is a virtual assistant who can offer free 1-on-1 VA calls.
export type CoachType = "strategic_coach" | "va";

// The call types with real behaviour today. Each maps to one booking + optional
// conflict calendar pair in coach_call_calendars.
export type CoachCallType = "private_coaching" | "one_on_one_va";

// A per-call-type calendar pair (coach_call_calendars). The booking calendar is
// where the appointment is created; the conflict calendar is the optional
// cross-company "other company" calendar that blocks double-booking.
export interface CoachCallCalendar {
  callType: CoachCallType;
  bookingCalendarId: string | null;
  bookingLocationId: string | null;
  conflictCalendarId: string | null;
  conflictLocationId: string | null;
}

export interface AdminCoach {
  id: number;
  name: string;
  specialties: string;
  bio: string;
  photoUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  // Coach kind; drives the editor's type-adaptive capability toggles.
  type: CoachType;
  doesGroupCalls: boolean;
  doesPrivateCoaching: boolean;
  // Whether a VA offers free 1-on-1 VA calls (callType "one_on_one_va").
  doesOneOnOneVaCalls: boolean;
  // Deprecated coach-row booking config (GoHighLevel). Kept as the seed
  // identity key + migration source; the editor now reads/writes calendars via
  // `callCalendars` instead. Null for group-only coaches.
  ghlCalendarId: string | null;
  ghlLocationId: string | null;
  conflictGhlCalendarId: string | null;
  conflictGhlLocationId: string | null;
  // Per-call-type calendar pairs (the single source of truth for booking).
  callCalendars: CoachCallCalendar[];
  // Optional link to the coach's portal login; null when unlinked.
  userId: number | null;
  // Per-coach Google status; null when the coach has no linked portal login.
  googleConnection: CoachGoogleConnection | null;
}

export interface CoachProfileInput {
  name: string;
  specialties: string;
  bio: string;
  photoUrl: string | null;
  isActive: boolean;
  type: CoachType;
  doesGroupCalls: boolean;
  doesPrivateCoaching: boolean;
  doesOneOnOneVaCalls: boolean;
  // Per-call-type calendar pairs to upsert. Empty ids clear that field.
  callCalendars: CoachCallCalendar[];
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
    // No onSuccess cache write: the order endpoint returns lean COACH_COLUMNS
    // rows (no googleConnection), so overwriting the cache here would blank the
    // Connections panel. The optimistic onMutate update already applies the new
    // order to the full cached objects, and onSettled invalidates to refetch the
    // authoritative list.
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
      // Refresh the blocked coach's call list (the delete dialog), the admin
      // coaching schedule, and the member-facing "Your Coaches" grid so the new
      // host shows everywhere the old coach appeared.
      queryClient.invalidateQueries({ queryKey: [LIST_KEY, fromCoachId, "calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/coaching/calls"] });
      queryClient.invalidateQueries({ queryKey: getListCoachesQueryKey() });
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

