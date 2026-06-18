import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

const LIST_KEY = "/api/admin/coaching/calls";

export interface AdminCoachingCall {
  id: number;
  title: string;
  description: string;
  callType: string;
  coachId: number;
  coachName: string;
  meetLink: string | null;
  scheduledAt: string;
  durationMinutes: number;
  requiredEntitlement: string;
  recordingUrl: string | null;
  registeredCount: number;
  templateId: number | null;
}

export interface CoachingCallTemplate {
  id: number;
  title: string;
  description: string;
  callType: string;
  coachId: number;
  coachName: string;
  meetLink: string | null;
  durationMinutes: number;
  requiredEntitlement: string;
  intervalDays: number;
  occurrencesPerBatch: number;
  anchorAt: string;
  lastGeneratedAt: string | null;
  active: boolean;
}

export interface CoachingCallTemplateInput {
  title: string;
  description?: string;
  callType: string;
  coachId: number;
  anchorAt: string;
  durationMinutes: number;
  meetLink?: string | null;
  requiredEntitlement?: string;
  intervalDays?: number;
  occurrencesPerBatch?: number;
}

export interface CoachOption {
  id: number;
  name: string;
}

export interface CoachingCallInput {
  title: string;
  description?: string;
  callType: string;
  coachId: number;
  scheduledAt: string;
  durationMinutes: number;
  meetLink?: string | null;
  recordingUrl?: string | null;
  requiredEntitlement?: string;
}

export function useAdminCoachingCalls() {
  return useQuery({
    queryKey: [LIST_KEY],
    queryFn: () => adminFetch<{ calls: AdminCoachingCall[] }>("/admin/coaching/calls"),
  });
}

export function useCoachingCallCoaches() {
  return useQuery({
    queryKey: [`${LIST_KEY}/coaches`],
    queryFn: () => adminFetch<{ coaches: CoachOption[] }>("/admin/coaching/calls/coaches"),
  });
}

function useInvalidateCalls() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
}

export function useCreateCoachingCall() {
  const invalidate = useInvalidateCalls();
  return useMutation({
    mutationFn: (input: CoachingCallInput) =>
      adminFetch<AdminCoachingCall>("/admin/coaching/calls", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateCoachingCall() {
  const invalidate = useInvalidateCalls();
  return useMutation({
    mutationFn: ({ id, ...input }: CoachingCallInput & { id: number }) =>
      adminFetch<AdminCoachingCall>(`/admin/coaching/calls/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteCoachingCall() {
  const invalidate = useInvalidateCalls();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch<{ ok: true }>(`/admin/coaching/calls/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

// --- Recurring templates ---------------------------------------------------

const TEMPLATES_KEY = "/api/admin/coaching/calls/templates";

export function useCoachingCallTemplates() {
  return useQuery({
    queryKey: [TEMPLATES_KEY],
    queryFn: () =>
      adminFetch<{ templates: CoachingCallTemplate[] }>("/admin/coaching/calls/templates"),
  });
}

function useInvalidateTemplates() {
  const queryClient = useQueryClient();
  // A template change also creates / removes calls, so refresh both lists.
  return () => {
    queryClient.invalidateQueries({ queryKey: [TEMPLATES_KEY] });
    queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
  };
}

export function useCreateCoachingCallTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (input: CoachingCallTemplateInput) =>
      adminFetch<{ template: CoachingCallTemplate; generated: number }>(
        "/admin/coaching/calls/templates",
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: invalidate,
  });
}

export function useUpdateCoachingCallTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<CoachingCallTemplateInput> & { id: number }) =>
      adminFetch<CoachingCallTemplate>(`/admin/coaching/calls/templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useGenerateCoachingCallTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch<{ generated: number; through: string }>(
        `/admin/coaching/calls/templates/${id}/generate`,
        { method: "POST" },
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteCoachingCallTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch<{ ok: true }>(`/admin/coaching/calls/templates/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
