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

export function useKickoffAvailability(startDate: string, endDate: string) {
  return useQuery<{ coach: StaffProfile; slots: CallSlot[]; durationMinutes: number }>({
    queryKey: [`${KICKOFF_KEY}/availability`, startDate, endDate],
    queryFn: () => callFetch(`/onboarding/kickoff/availability?startDate=${startDate}&endDate=${endDate}`),
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
  return useMutation<{ booking: CallBooking; alreadyBooked?: boolean; onboardingAdvanced?: boolean }, Error, { startTime: string }>({
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

// ---------------------------------------------------------------------------
// Partner call
// ---------------------------------------------------------------------------

export function usePartnerInfo() {
  return useQuery<{ partner: StaffProfile | null }>({
    queryKey: [`${PARTNER_KEY}/info`],
    queryFn: () => callFetch("/onboarding/partner/info"),
  });
}

export function usePartnerAvailability(startDate: string, endDate: string) {
  return useQuery<{ partnerId: number; slots: CallSlot[]; durationMinutes: number }>({
    queryKey: [`${PARTNER_KEY}/availability`, startDate, endDate],
    queryFn: () => callFetch(`/onboarding/partner/availability?startDate=${startDate}&endDate=${endDate}`),
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
