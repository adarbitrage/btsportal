const API_BASE = `${import.meta.env.BASE_URL}api`;

async function winsFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export interface WinMilestone {
  id: number;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: "revenue" | "campaign" | "skill" | "lifestyle" | "custom";
  sortOrder: number;
  xpReward: number;
  isActive: boolean;
}

export interface WinAuthor {
  id: number;
  name: string;
  avatarUrl: string | null;
  highestProductSlug: string;
}

export interface Win {
  id: number;
  userId: number;
  author: WinAuthor;
  milestone: WinMilestone;
  title: string;
  description: string;
  revenueAmount: number | null;
  metricLabel: string | null;
  metricValue: string | null;
  proofImageUrl: string | null;
  proofImage2Url: string | null;
  proofVerified: boolean;
  winDate: string;
  shareToCommunity: boolean;
  communityPostId: number | null;
  allowTestimonial: boolean;
  allowPublicName: boolean;
  status: "published" | "featured" | "hidden" | "draft";
  featuredAt: string | null;
  testimonialRequested: boolean;
  testimonialText: string | null;
  testimonialApproved: boolean;
  reactionCount: number;
  hasReacted: boolean;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WinsResponse {
  wins: Win[];
  nextCursor: string | null;
  totalCount: number;
}

export interface WinStreakInfo {
  achievedCount: number;
  totalCount: number;
  percentage: number;
  nextMilestone: WinMilestone | null;
  achievedMilestoneIds: number[];
}

export interface WinsSummary {
  achievedCount: number;
  totalCount: number;
  percentage: number;
  latestWin: Win | null;
  nextMilestone: WinMilestone | null;
}

export function fetchMilestones(): Promise<WinMilestone[]> {
  return winsFetch("/wins/milestones");
}

export function fetchWins(params: {
  category?: string;
  cursor?: string;
  limit?: number;
  featured?: boolean;
}): Promise<WinsResponse> {
  const searchParams = new URLSearchParams();
  if (params.category && params.category !== "all") searchParams.set("category", params.category);
  if (params.cursor) searchParams.set("cursor", params.cursor);
  if (params.limit) searchParams.set("limit", params.limit.toString());
  if (params.featured) searchParams.set("featured", "true");
  return winsFetch(`/wins?${searchParams.toString()}`);
}

export function fetchWin(winId: number): Promise<Win> {
  return winsFetch(`/wins/${winId}`);
}

export function fetchMyWins(): Promise<{ wins: Win[]; streak: WinStreakInfo }> {
  return winsFetch("/wins/mine");
}

export function fetchWinStreak(): Promise<WinStreakInfo> {
  return winsFetch("/wins/streak");
}

export function fetchWinsSummary(): Promise<WinsSummary> {
  return winsFetch("/wins/summary");
}

export function createWin(data: {
  milestoneId: number;
  title: string;
  description: string;
  winDate: string;
  revenueAmount?: number;
  metricLabel?: string;
  metricValue?: string;
  proofImageUrl?: string;
  proofImage2Url?: string;
  shareToCommunity: boolean;
  allowTestimonial: boolean;
  allowPublicName: boolean;
  status: "published" | "draft";
}): Promise<Win> {
  return winsFetch("/wins", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateWin(
  winId: number,
  data: Partial<{
    milestoneId: number;
    title: string;
    description: string;
    winDate: string;
    revenueAmount: number;
    metricLabel: string;
    metricValue: string;
    proofImageUrl: string;
    proofImage2Url: string;
    shareToCommunity: boolean;
    allowTestimonial: boolean;
    allowPublicName: boolean;
    status: "published" | "draft";
  }>
): Promise<Win> {
  return winsFetch(`/wins/${winId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteWin(winId: number): Promise<void> {
  return winsFetch(`/wins/${winId}`, { method: "DELETE" });
}

export function submitTestimonial(
  winId: number,
  data: {
    testimonialText: string;
    allowTestimonial: boolean;
    allowPublicName: boolean;
  }
): Promise<Win> {
  return winsFetch(`/wins/${winId}/testimonial`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function toggleWinReaction(winId: number): Promise<{ reacted: boolean; count: number }> {
  return winsFetch(`/wins/${winId}/reactions`, { method: "POST" });
}

export function uploadProofImage(file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return winsFetch("/wins/upload-proof", {
    method: "POST",
    body: formData,
  });
}
