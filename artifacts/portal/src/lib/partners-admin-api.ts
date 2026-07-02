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

const LIST_KEY = "/api/admin/partners";

export interface AdminPartner {
  id: number;
  displayName: string;
  bio: string;
  photoUrl: string | null;
  isActive: boolean;
  maxDailyCalls: number;
  userId: number | null;
  activeAssignmentCount: number;
}

export interface PartnerInput {
  displayName?: string;
  bio?: string;
  photoUrl?: string | null;
  isActive?: boolean;
  maxDailyCalls?: number;
}

export interface PartnerAssignmentHistoryItem {
  id: number;
  partnerId: number;
  partnerDisplayName: string;
  status: "active" | "ended" | "reassigned";
  assignedAt: string;
  endedAt: string | null;
  endedReason: string | null;
}

export function useAdminPartners() {
  return useQuery({
    queryKey: [LIST_KEY],
    queryFn: () => adminFetch<{ partners: AdminPartner[] }>("/admin/partners"),
  });
}

export function useCreatePartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PartnerInput) =>
      adminFetch<AdminPartner>("/admin/partners", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
    },
  });
}

export function useUpdatePartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: PartnerInput }) =>
      adminFetch<AdminPartner>(`/admin/partners/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
    },
  });
}

export function useMemberPartnerAssignments(memberId: number | null) {
  return useQuery({
    queryKey: ["/api/admin/members", memberId, "partner-assignments"],
    queryFn: () =>
      adminFetch<{ history: PartnerAssignmentHistoryItem[] }>(
        `/admin/members/${memberId}/partner-assignments`,
      ),
    enabled: memberId != null,
  });
}

export function useReassignPartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      memberId,
      partnerId,
      reason,
    }: {
      memberId: number;
      partnerId?: number;
      reason: string;
    }) =>
      adminFetch<{ partnerId: number }>(`/admin/members/${memberId}/reassign-partner`, {
        method: "POST",
        body: JSON.stringify({ partnerId, reason }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/members", variables.memberId, "partner-assignments"],
      });
    },
  });
}

export function useEndPartnerAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, reason }: { memberId: number; reason: string }) =>
      adminFetch<{ ended: boolean }>(`/admin/members/${memberId}/end-partner-assignment`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/members", variables.memberId, "partner-assignments"],
      });
    },
  });
}
