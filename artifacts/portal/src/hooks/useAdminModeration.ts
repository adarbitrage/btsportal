import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function adminFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export type ModerationStatus = "pending" | "approved" | "rejected";

export interface WordlistMatch {
  word: string;
  category: string;
  severity: "HARD" | "SOFT";
}

export interface ModerationQueueItem {
  id: number;
  targetType: "post" | "comment";
  targetId: number;
  authorId: number;
  body: string;
  status: ModerationStatus;
  triggeredBy: string;
  wordlistMatches: WordlistMatch[] | null;
  aiScores: Record<string, number> | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  createdAt: string;
  authorName: string | null;
  authorEmail: string | null;
}

export interface ModerationQueuePage {
  items: ModerationQueueItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

function moderationQueueKey(status: ModerationStatus) {
  return ["admin", "moderation", "queue", status] as const;
}

export function useAdminModerationQueue(status: ModerationStatus) {
  return useInfiniteQuery({
    queryKey: moderationQueueKey(status),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ status, limit: "25" });
      if (pageParam) qs.set("cursor", pageParam as string);
      return adminFetch<ModerationQueuePage>(`/admin/moderation/queue?${qs.toString()}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useAdminModerationItem(id: number) {
  return useQuery({
    queryKey: ["admin", "moderation", "item", id],
    queryFn: () => adminFetch<ModerationQueueItem>(`/admin/moderation/queue/${id}`),
    enabled: id > 0,
  });
}

export function useApproveQueueItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch<{ success: boolean }>(`/admin/moderation/queue/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "moderation", "queue"] });
    },
  });
}

export function useRejectQueueItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      adminFetch<{ success: boolean; strikeCount: number }>(`/admin/moderation/queue/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "moderation", "queue"] });
    },
  });
}
