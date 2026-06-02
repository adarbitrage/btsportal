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
  /**
   * Threshold the classifier was compared against when this row was flagged.
   * Null when the AI classifier didn't weigh in (hard wordlist) or the row
   * pre-dates the column being added.
   */
  flagThreshold: number | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  createdAt: string;
  authorName: string | null;
  authorEmail: string | null;
}

export interface AiFlaggedItem extends ModerationQueueItem {
  /** Max per-class classifier score for this row (0..1). */
  maxScore: number;
}

export interface AiFlaggedPage {
  items: AiFlaggedItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AiFlaggedFilters {
  status?: ModerationStatus | "";
  from?: string;
  to?: string;
  minScore?: string;
  maxScore?: string;
}

export interface ModerationQueuePage {
  items: ModerationQueueItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AiScoreBandBucket {
  min: number;
  max: number;
  label: string;
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  /** approved / (approved + rejected); null when nothing in the band is reviewed. */
  approveRate: number | null;
}

export interface AiFlaggedSummary {
  sampleWindowDays: number;
  /** Explicit lower bound applied (ISO), or null when defaulting to last N days. */
  from: string | null;
  /** Explicit upper bound applied (ISO), or null when unbounded toward "now". */
  to: string | null;
  sampleSize: number;
  currentThreshold: number;
  buckets: AiScoreBandBucket[];
  /** Ascending max classifier scores for the sample, for the what-if slider. */
  maxScores: number[];
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

/**
 * Lists moderation queue rows that were flagged by the AI classifier, with
 * the score, the threshold in effect at flag-time, and the reason. Powers
 * the AI Flagged admin dashboard so moderators can data-drive their
 * threshold tuning instead of guessing.
 */
export function useAdminAiFlagged(filters: AiFlaggedFilters) {
  return useInfiniteQuery({
    queryKey: ["admin", "moderation", "ai-flagged", filters] as const,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: "25" });
      if (filters.status) qs.set("status", filters.status);
      if (filters.from) qs.set("from", filters.from);
      if (filters.to) qs.set("to", filters.to);
      if (filters.minScore) qs.set("minScore", filters.minScore);
      if (filters.maxScore) qs.set("maxScore", filters.maxScore);
      if (pageParam) qs.set("cursor", pageParam as string);
      return adminFetch<AiFlaggedPage>(`/admin/moderation/queue/ai-flagged?${qs.toString()}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/**
 * Score-band summary for the AI Flagged dashboard: counts and approve/reject
 * rates bucketed by classifier score, plus the raw max-scores that power the
 * "what-if threshold" slider. Aggregated server-side so the dashboard turns
 * threshold tuning into a single-screen decision.
 *
 * Accepts the same From/To filters the list uses (only `from`/`to` are
 * forwarded — score/status filters don't apply to the threshold summary) so
 * the card tracks the exact window shown below it. Falls back to the last 30
 * days when no range is set.
 */
export function useAdminAiFlaggedSummary(filters: AiFlaggedFilters = {}) {
  const { from, to } = filters;
  return useQuery({
    queryKey: ["admin", "moderation", "ai-flagged", "summary", { from, to }] as const,
    queryFn: () => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return adminFetch<AiFlaggedSummary>(`/admin/moderation/queue/ai-flagged/summary${suffix}`);
    },
  });
}

export function useAdminModerationPendingCount(opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ["admin", "moderation", "pending-count"],
    queryFn: async () => {
      const data = await adminFetch<ModerationQueuePage>(
        `/admin/moderation/queue?status=pending&limit=100`
      );
      return { count: data.items.length, hasMore: data.hasMore };
    },
    refetchInterval: opts?.refetchInterval,
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
