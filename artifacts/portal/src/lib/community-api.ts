const API_BASE = `${import.meta.env.BASE_URL}api`;

export class CommunityApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CommunityApiError";
    this.status = status;
  }
}

function extractApiError(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const err = (data as { error?: unknown }).error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return undefined;
}

async function communityFetch(path: string, options?: RequestInit) {
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
    throw new CommunityApiError(extractApiError(data) ?? "Something went wrong. Please try again.", res.status);
  }
  return res.json();
}

function normalizePost(p: any): CommunityPost {
  return {
    ...p,
    body: p.body ?? p.content ?? "",
    title: p.title ?? "",
    status: p.status ?? "active",
    author: p.author ?? {
      id: p.authorId ?? 0,
      name: p.authorName ?? "Unknown",
      avatarUrl: p.avatarUrl ?? null,
      highestProductSlug: p.highestProductSlug ?? null,
      badges: p.badges ?? [],
    },
    isEdited: p.isEdited ?? false,
    isDeleted: p.isDeleted ?? false,
    comments: (p.comments ?? []).map(normalizeComment),
  };
}

function normalizeComment(c: any): CommunityComment {
  return {
    id: c.id,
    postId: c.postId,
    author: c.author ?? {
      id: c.authorId ?? 0,
      name: c.authorName ?? "Unknown",
      avatarUrl: c.avatarUrl ?? null,
      highestProductSlug: c.highestProductSlug ?? null,
      badges: c.badges ?? [],
    },
    body: c.body ?? c.content ?? "",
    parentCommentId: c.parentCommentId ?? c.parentId ?? null,
    replyToName: c.replyToName ?? null,
    reactionCount: c.reactionCount ?? 0,
    hasReacted: c.hasReacted ?? c.viewerHasReacted ?? false,
    isEdited: c.isEdited ?? false,
    isDeleted: c.isDeleted ?? (c.status === "deleted") ?? false,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export interface CommunityCategory {
  id: number;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  postCount: number;
}

export interface CommunityAuthor {
  id: number;
  name: string;
  avatarUrl: string | null;
  highestProductSlug: string;
  badges: string[];
}

export interface CommunityComment {
  id: number;
  postId: number;
  author: CommunityAuthor;
  body: string;
  parentCommentId: number | null;
  replyToName: string | null;
  reactionCount: number;
  hasReacted: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityPost {
  id: number;
  author: CommunityAuthor;
  categoryId: number;
  categorySlug: string;
  categoryName: string;
  title: string;
  body: string;
  imageUrl: string | null;
  isPinned: boolean;
  reactionCount: number;
  hasReacted: boolean;
  commentCount: number;
  isEdited: boolean;
  isDeleted: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  comments: CommunityComment[];
}

export interface CommunityMember {
  id: number;
  name: string;
  avatarUrl: string | null;
  highestProductSlug: string;
  badges: string[];
  bio: string | null;
  postCount: number;
  commentCount: number;
  reactionsReceived: number;
  joinedAt: string;
  recentPosts: CommunityPost[];
}

export interface CommunityNotification {
  id: number;
  type: "reaction" | "comment" | "reply" | "mention" | "badge";
  message: string;
  postId: number | null;
  commentId: number | null;
  fromUser: { id: number; name: string; avatarUrl: string | null } | null;
  isRead: boolean;
  createdAt: string;
}

export interface PostsResponse {
  posts: CommunityPost[];
  nextCursor: string | null;
  totalCount: number;
}

export interface MembersResponse {
  members: CommunityMember[];
  nextCursor: string | null;
  totalCount: number;
}

export interface NotificationsResponse {
  notifications: CommunityNotification[];
  unreadCount: number;
}

export function fetchCategories(): Promise<CommunityCategory[]> {
  return communityFetch("/community/categories");
}

export async function fetchPosts(params: {
  categorySlug?: string;
  cursor?: string;
  limit?: number;
}): Promise<PostsResponse> {
  const searchParams = new URLSearchParams();
  if (params.categorySlug && params.categorySlug !== "all") searchParams.set("categorySlug", params.categorySlug);
  if (params.cursor) searchParams.set("cursor", params.cursor);
  if (params.limit) searchParams.set("limit", params.limit.toString());
  const data = await communityFetch(`/community/posts?${searchParams.toString()}`);
  const rawPosts: any[] = data.posts ?? [];
  const posts: CommunityPost[] = rawPosts.map(normalizePost);
  return {
    posts,
    nextCursor: data.nextCursor ?? null,
    totalCount: data.totalCount ?? posts.length,
  };
}

export async function fetchPost(postId: number): Promise<CommunityPost> {
  const data = await communityFetch(`/community/posts/${postId}`);
  return normalizePost(data);
}

export async function createPost(data: {
  categoryId: number;
  title: string;
  body: string;
  imageUrl?: string;
}): Promise<CommunityPost> {
  const res = await communityFetch("/community/posts", {
    method: "POST",
    body: JSON.stringify({
      categoryId: data.categoryId,
      title: data.title,
      body: data.body,
      imageUrl: data.imageUrl,
    }),
  });
  return normalizePost(res);
}

export function updatePost(postId: number, data: { body: string }): Promise<CommunityPost> {
  return communityFetch(`/community/posts/${postId}`, {
    method: "PATCH",
    body: JSON.stringify({ content: data.body }),
  });
}

export function deletePost(postId: number): Promise<void> {
  return communityFetch(`/community/posts/${postId}`, { method: "DELETE" });
}

export async function createComment(data: {
  postId: number;
  body: string;
  parentCommentId?: number;
}): Promise<CommunityComment> {
  const res = await communityFetch(`/community/posts/${data.postId}/comments`, {
    method: "POST",
    body: JSON.stringify({ content: data.body, parentId: data.parentCommentId }),
  });
  return normalizeComment(res);
}

export async function updateComment(commentId: number, data: { body: string }): Promise<CommunityComment> {
  const res = await communityFetch(`/community/comments/${commentId}`, {
    method: "PATCH",
    body: JSON.stringify({ content: data.body }),
  });
  return normalizeComment(res);
}

export function deleteComment(commentId: number): Promise<void> {
  return communityFetch(`/community/comments/${commentId}`, { method: "DELETE" });
}

export function toggleReaction(data: {
  targetType: "post" | "comment";
  targetId: number;
}): Promise<{ reacted: boolean; count: number }> {
  return communityFetch("/community/reactions", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function fetchPostComments(postId: number): Promise<CommunityComment[]> {
  const data = await communityFetch(`/community/posts/${postId}/comments`);
  return (data as any[]).map(normalizeComment);
}

export function fetchMembers(params: {
  search?: string;
  tier?: string;
  badge?: string;
  sort?: string;
  cursor?: string;
  limit?: number;
}): Promise<MembersResponse> {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set("search", params.search);
  if (params.tier) searchParams.set("tier", params.tier);
  if (params.badge) searchParams.set("badge", params.badge);
  if (params.sort) searchParams.set("sort", params.sort);
  if (params.cursor) searchParams.set("cursor", params.cursor);
  if (params.limit) searchParams.set("limit", params.limit.toString());
  return communityFetch(`/community/members?${searchParams.toString()}`);
}

export function fetchMember(userId: number): Promise<CommunityMember> {
  return communityFetch(`/community/members/${userId}`);
}

export function fetchNotifications(): Promise<NotificationsResponse> {
  return communityFetch("/community/notifications");
}

export function markAllNotificationsRead(): Promise<void> {
  return communityFetch("/community/notifications/read", { method: "POST" });
}

export function fetchMemberPreview(userId: number): Promise<CommunityMember> {
  return communityFetch(`/community/members/${userId}/preview`);
}
