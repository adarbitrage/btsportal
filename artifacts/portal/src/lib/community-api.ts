const API_BASE = `${import.meta.env.BASE_URL}api`;

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
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return res.json();
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
  if (params.cursor) searchParams.set("page", params.cursor);
  if (params.limit) searchParams.set("limit", params.limit.toString());
  const data = await communityFetch(`/community/posts?${searchParams.toString()}`);
  const rawPosts: any[] = data.posts ?? [];
  const posts: CommunityPost[] = rawPosts.map((p: any) => ({
    ...p,
    body: p.body ?? p.content ?? "",
    title: p.title ?? "",
    author: p.author ?? {
      id: p.authorId ?? 0,
      name: p.authorName ?? "Unknown",
      avatarUrl: p.avatarUrl ?? null,
      highestProductSlug: p.highestProductSlug ?? null,
      badges: p.badges ?? [],
    },
    isEdited: p.isEdited ?? false,
    isDeleted: p.isDeleted ?? false,
  }));
  const pagination = data.pagination ?? {};
  const currentPage = pagination.page ?? 1;
  const totalPages = pagination.totalPages ?? 1;
  return {
    posts,
    nextCursor: currentPage < totalPages ? String(currentPage + 1) : null,
    totalCount: pagination.total ?? posts.length,
  };
}

export function fetchPost(postId: number): Promise<CommunityPost> {
  return communityFetch(`/community/posts/${postId}`);
}

export function createPost(data: {
  categoryId: number;
  title: string;
  body: string;
  imageUrl?: string;
}): Promise<CommunityPost> {
  return communityFetch("/community/posts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updatePost(postId: number, data: { body: string }): Promise<CommunityPost> {
  return communityFetch(`/community/posts/${postId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deletePost(postId: number): Promise<void> {
  return communityFetch(`/community/posts/${postId}`, { method: "DELETE" });
}

export function createComment(data: {
  postId: number;
  body: string;
  parentCommentId?: number;
}): Promise<CommunityComment> {
  return communityFetch(`/community/posts/${data.postId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: data.body, parentCommentId: data.parentCommentId }),
  });
}

export function updateComment(commentId: number, data: { body: string }): Promise<CommunityComment> {
  return communityFetch(`/community/comments/${commentId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
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

export function fetchPostComments(postId: number): Promise<CommunityComment[]> {
  return communityFetch(`/community/posts/${postId}/comments`);
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
