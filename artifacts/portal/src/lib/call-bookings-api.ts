import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function callFetch(path: string, options?: RequestInit) {
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
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export interface CallSlot {
  startTime: string;
}

// A merged kickoff-pool slot, tagged with the specific coach that owns it
// (Task #1654). Calendars can differ per coach, so durationMinutes travels
// WITH the slot rather than as one top-level value.
export interface KickoffPoolSlot extends CallSlot {
  coachId: number;
  durationMinutes: number;
}

export interface CallBooking {
  id: number;
  memberId: number;
  staffType: "kickoff_coach" | "partner";
  staffId: number;
  type: "kickoff" | "partner";
  ghlAppointmentId: string | null;
  scheduledAt: string;
  endAt: string;
  durationMinutes: number;
  meetingUrl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

export interface StaffProfile {
  id: number;
  displayName: string;
  photoUrl: string | null;
  bio: string | null;
}

const KICKOFF_KEY = "/api/onboarding/kickoff";
const PARTNER_KEY = "/api/onboarding/partner";

// ---------------------------------------------------------------------------
// Kickoff call
// ---------------------------------------------------------------------------

export function useKickoffAvailability(startDate: string, endDate: string, excludeBookingId?: number) {
  // Task #1654: the response is now a MERGED, earliest-first pool across
  // every active/calendar-configured kickoff coach in the member's tier —
  // `coaches` lists every coach in the pool (for photo/bio reveal), `slots`
  // is the merged grid with each slot tagged by `coachId` + its own
  // `durationMinutes` (calendars can differ per coach). `setupPending` is
  // true when the tier has no coach pool at all yet (e.g. LaunchPad before a
  // real calendar ID is entered) — loud and explicit, never a silent empty
  // grid, and never a fallback to another tier's coaches.
  // Task #1723: excludeBookingId is passed during reschedule so the member's
  // own current slot is not filtered out as a conflict.
  return useQuery<{
    coaches: StaffProfile[];
    slots: KickoffPoolSlot[];
    setupPending?: boolean;
  }>({
    queryKey: [`${KICKOFF_KEY}/availability`, startDate, endDate, excludeBookingId],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate });
      if (excludeBookingId !== undefined) params.set("excludeBookingId", String(excludeBookingId));
      return callFetch(`/onboarding/kickoff/availability?${params}`);
    },
    enabled: !!startDate && !!endDate,
  });
}

export function useMyKickoffBooking() {
  return useQuery<{ booking: CallBooking | null }>({
    queryKey: [`${KICKOFF_KEY}/mine`],
    queryFn: () => callFetch("/onboarding/kickoff/mine"),
  });
}

export function useBookKickoffCall() {
  const queryClient = useQueryClient();
  return useMutation<
    { booking: CallBooking; alreadyBooked?: boolean; onboardingAdvanced?: boolean; setupPending?: boolean },
    Error,
    { startTime: string; coachId: number }
  >({
    mutationFn: (data) =>
      callFetch("/onboarding/kickoff/book", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith(KICKOFF_KEY),
      });
    },
  });
}

function invalidateKickoff(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({
    predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith(KICKOFF_KEY),
  });
}

export function useRescheduleKickoffCall() {
  const queryClient = useQueryClient();
  return useMutation<{ booking: CallBooking }, Error, { bookingId: number; startTime: string }>({
    mutationFn: ({ bookingId, startTime }) =>
      callFetch(`/onboarding/kickoff/${bookingId}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify({ startTime }),
      }),
    onSuccess: () => invalidateKickoff(queryClient),
  });
}

export function useCancelKickoffCall() {
  const queryClient = useQueryClient();
  return useMutation<{ booking: CallBooking }, Error, { bookingId: number }>({
    mutationFn: ({ bookingId }) =>
      callFetch(`/onboarding/kickoff/${bookingId}/cancel`, { method: "PATCH" }),
    onSuccess: () => invalidateKickoff(queryClient),
  });
}

// ---------------------------------------------------------------------------
// Partner call
// ---------------------------------------------------------------------------

export function usePartnerInfo() {
  return useQuery<{ partner: StaffProfile | null }>({
    queryKey: [`${PARTNER_KEY}/info`],
    queryFn: () => callFetch("/onboarding/partner/info"),
  });
}

export function usePartnerAvailability(startDate: string, endDate: string, excludeBookingId?: number) {
  // durationMinutes is null when the partner has no calendar configured yet
  // (no slots either way, so no calendar-config fetch is attempted).
  // Task #1723: excludeBookingId is passed during reschedule so the booking
  // being moved isn't filtered as a conflict against itself.
  return useQuery<{ partnerId: number; slots: CallSlot[]; durationMinutes: number | null }>({
    queryKey: [`${PARTNER_KEY}/availability`, startDate, endDate, excludeBookingId],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate });
      if (excludeBookingId !== undefined) params.set("excludeBookingId", String(excludeBookingId));
      return callFetch(`/onboarding/partner/availability?${params}`);
    },
    enabled: !!startDate && !!endDate,
  });
}

export function useMyPartnerBookings() {
  return useQuery<{ bookings: CallBooking[] }>({
    queryKey: [`${PARTNER_KEY}/mine`],
    queryFn: () => callFetch("/onboarding/partner/mine"),
  });
}

function invalidatePartner(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({
    predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith(PARTNER_KEY),
  });
}

export function useBookPartnerCall() {
  const queryClient = useQueryClient();
  return useMutation<{ booking: CallBooking; onboardingAdvanced?: boolean }, Error, { startTime: string }>({
    mutationFn: (data) =>
      callFetch("/onboarding/partner/book", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => invalidatePartner(queryClient),
  });
}

export function useReschedulePartnerCall() {
  const queryClient = useQueryClient();
  return useMutation<{ booking: CallBooking }, Error, { bookingId: number; startTime: string }>({
    mutationFn: ({ bookingId, startTime }) =>
      callFetch(`/onboarding/partner/${bookingId}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify({ startTime }),
      }),
    onSuccess: () => invalidatePartner(queryClient),
  });
}

export function useCancelPartnerCall() {
  const queryClient = useQueryClient();
  return useMutation<{ booking: CallBooking }, Error, { bookingId: number }>({
    mutationFn: ({ bookingId }) =>
      callFetch(`/onboarding/partner/${bookingId}/cancel`, { method: "PATCH" }),
    onSuccess: () => invalidatePartner(queryClient),
  });
}

// ---------------------------------------------------------------------------
// Accountability partner panel (dashboard, Task #1593)
// ---------------------------------------------------------------------------

export interface PartnerAssignmentPanel {
  partner: StaffProfile;
  cadencePerWeek: number | null;
  nextCall: { scheduledAt: string; meetingUrl: string | null } | null;
  completedCallCount: number;
}

export function usePartnerPanel() {
  return useQuery<{ assignment: PartnerAssignmentPanel | null }>({
    queryKey: ["/api/partner/me"],
    queryFn: () => callFetch("/partner/me"),
  });
}

// ---------------------------------------------------------------------------
// Call-day banner
// ---------------------------------------------------------------------------

export function useTodayCallBooking() {
  return useQuery<{ booking: CallBooking | null }>({
    queryKey: ["/api/call-bookings/today"],
    queryFn: () => callFetch("/call-bookings/today"),
    refetchInterval: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Persistent next-call panel (Task #1688). Source of truth for "what's my
// next booked call" across BOTH kickoff and partner types, independent of
// partner assignment — a LaunchPad member with a booked kickoff call and no
// partner assignment still gets a result here (unlike usePartnerPanel above,
// which stays null for them by design).
// ---------------------------------------------------------------------------

export interface NextCall {
  type: "kickoff" | "partner";
  scheduledAt: string;
  endAt: string;
  meetingUrl: string | null;
  staff: { displayName: string; photoUrl: string | null } | null;
}

// Task #1696: every upcoming booked call, chronological — a member can have
// BOTH a kickoff call and an accountability call booked at once, and each
// gets its own card in the sidebar rather than one panel mixing the two.
export function useNextCallBooking() {
  return useQuery<{ calls: NextCall[] }>({
    queryKey: ["/api/call-bookings/next"],
    queryFn: () => callFetch("/call-bookings/next"),
    refetchInterval: 5 * 60 * 1000,
  });
}
