import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function adminFetch(path: string, options?: RequestInit) {
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

const ROOT_KEY = "/api/admin/coaching";

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === "string" && key.startsWith(ROOT_KEY);
    },
  });
}

// ---------------------------------------------------------------------------
// Bookings list
// ---------------------------------------------------------------------------

export interface AdminPackBooking {
  id: number;
  memberId: number;
  memberName: string;
  memberEmail: string;
  coachId: number;
  coachName: string;
  scheduledAt: string;
  endAt: string;
  durationMinutes: number;
  meetLink: string | null;
  status: string;
  title: string | null;
  coachNotes: string | null;
  outcomeAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface AdminPackSessionsResponse {
  bookings: AdminPackBooking[];
  total: number;
  limit: number;
  offset: number;
  stats: Record<string, number>;
}

export interface AdminPackSessionFilters {
  status?: string;
  coachId?: number;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function useAdminPackSessions(filters: AdminPackSessionFilters = {}) {
  const search = new URLSearchParams();
  if (filters.status) search.set("status", filters.status);
  if (filters.coachId) search.set("coachId", String(filters.coachId));
  if (filters.q) search.set("q", filters.q);
  if (filters.from) search.set("from", filters.from);
  if (filters.to) search.set("to", filters.to);
  if (filters.limit) search.set("limit", String(filters.limit));
  if (filters.offset) search.set("offset", String(filters.offset));
  const qs = search.toString();
  return useQuery<AdminPackSessionsResponse>({
    queryKey: [`${ROOT_KEY}/sessions`, filters],
    queryFn: () => adminFetch(`/admin/coaching/pack/sessions${qs ? `?${qs}` : ""}`),
  });
}

export function useAdminCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: boolean; refunded: boolean; balance: number },
    Error,
    { bookingId: number; refund: boolean }
  >({
    mutationFn: ({ bookingId, refund }) =>
      adminFetch(`/admin/coaching/pack/sessions/${bookingId}/cancel`, {
        method: "PATCH",
        body: JSON.stringify({ refund }),
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useAdminCompleteBooking() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: boolean; booking: AdminPackBooking },
    Error,
    { bookingId: number; coachNotes?: string }
  >({
    mutationFn: ({ bookingId, coachNotes }) =>
      adminFetch(`/admin/coaching/pack/sessions/${bookingId}/complete`, {
        method: "PATCH",
        body: JSON.stringify(coachNotes !== undefined ? { coachNotes } : {}),
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useAdminNoShowBooking() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: boolean; creditReturned: boolean; balance: number; booking: AdminPackBooking },
    Error,
    { bookingId: number; returnCredit: boolean; coachNotes?: string }
  >({
    mutationFn: ({ bookingId, returnCredit, coachNotes }) =>
      adminFetch(`/admin/coaching/pack/sessions/${bookingId}/no-show`, {
        method: "PATCH",
        body: JSON.stringify({ returnCredit, ...(coachNotes !== undefined ? { coachNotes } : {}) }),
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useAdminSaveNotes() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: boolean; booking: AdminPackBooking },
    Error,
    { bookingId: number; coachNotes: string }
  >({
    mutationFn: ({ bookingId, coachNotes }) =>
      adminFetch(`/admin/coaching/pack/sessions/${bookingId}/notes`, {
        method: "PATCH",
        body: JSON.stringify({ coachNotes }),
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

// ---------------------------------------------------------------------------
// Credits + ledger
// ---------------------------------------------------------------------------

export interface AdminMemberSummary {
  id: number;
  name: string;
  email: string;
}

export interface CreditLedgerEntry {
  id: number;
  memberId: number;
  delta: number;
  reason: string;
  note: string | null;
  bookingId: number | null;
  createdByUserId: number | null;
  createdAt: string;
}

export interface MemberCreditDetail {
  member: AdminMemberSummary;
  balance: number;
  ledger: CreditLedgerEntry[];
  bookings: AdminPackBooking[];
}

export function useMemberSearch(q: string) {
  return useQuery<AdminMemberSummary[]>({
    queryKey: [`${ROOT_KEY}/members/search`, q],
    queryFn: () => adminFetch(`/admin/coaching/pack/members/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
}

export function useMemberCreditDetail(memberId: number | null) {
  return useQuery<MemberCreditDetail>({
    queryKey: [`${ROOT_KEY}/session-credits`, memberId],
    queryFn: () => adminFetch(`/admin/coaching/pack/session-credits/${memberId}`),
    enabled: !!memberId && memberId > 0,
  });
}

export function useGrantCredits() {
  const queryClient = useQueryClient();
  return useMutation<
    { memberId: number; balance: number },
    Error,
    { memberId: number; amount: number; note?: string }
  >({
    mutationFn: (data) =>
      adminFetch("/admin/coaching/pack/session-credits/grant", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

// ---------------------------------------------------------------------------
// Coach roster CRUD
// ---------------------------------------------------------------------------

export interface PackCoach {
  id: number;
  name: string;
  bio: string | null;
  photoUrl: string | null;
  ghlCalendarId: string;
  ghlLocationId: string;
  sortOrder: number;
  isActive: boolean;
}

export interface PackCoachInput {
  name: string;
  ghlCalendarId: string;
  ghlLocationId?: string;
  bio?: string | null;
  photoUrl?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export function useAdminPackCoaches() {
  return useQuery<PackCoach[]>({
    queryKey: [`${ROOT_KEY}/coaches`],
    queryFn: () => adminFetch("/admin/coaching/pack/coaches"),
  });
}

export function useCreatePackCoach() {
  const queryClient = useQueryClient();
  return useMutation<PackCoach, Error, PackCoachInput>({
    mutationFn: (data) =>
      adminFetch("/admin/coaching/pack/coaches", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}

export function useUpdatePackCoach() {
  const queryClient = useQueryClient();
  return useMutation<PackCoach, Error, { id: number } & Partial<PackCoachInput>>({
    mutationFn: ({ id, ...data }) =>
      adminFetch(`/admin/coaching/pack/coaches/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => invalidateAll(queryClient),
  });
}
