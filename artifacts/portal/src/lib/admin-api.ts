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
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export function fetchGhlStatus() {
  return adminFetch("/admin/ghl/status");
}

export function fetchGhlRecentActivity(limit = 50) {
  return adminFetch(`/admin/ghl/recent-activity?limit=${limit}`);
}

export function fetchGhlFailedJobs() {
  return adminFetch("/admin/ghl/failed-jobs");
}

export function retryGhlJob(jobId: string | number) {
  return adminFetch(`/admin/ghl/retry/${jobId}`, { method: "POST" });
}

export function fetchGhlContacts(params: { search?: string; filter?: string; page?: number; limit?: number }) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.filter) qs.set("filter", params.filter);
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  return adminFetch(`/admin/ghl/contacts?${qs.toString()}`);
}

export function syncMember(userId: number) {
  return adminFetch(`/admin/ghl/sync-member/${userId}`, { method: "POST" });
}

export function bulkSync() {
  return adminFetch("/admin/ghl/bulk-sync", { method: "POST" });
}

export function fetchGhlConfig() {
  return adminFetch("/admin/ghl/config");
}

export function updateGhlConfig(config: Record<string, any>) {
  return adminFetch("/admin/ghl/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  postsCount: number;
  createdAt: string;
}

export interface AdminPost {
  id: number;
  content: string;
  imageUrl: string | null;
  isPinned: boolean;
  isFeatured: boolean;
  isDeleted: boolean;
  deletedBy: string | null;
  commentCount: number;
  reactionCount: number;
  createdAt: string;
  authorId: number;
  authorName: string;
  authorEmail: string;
  categoryId: number;
  categoryName: string;
}

export interface AdminComment {
  id: number;
  postId: number;
  content: string;
  isDeleted: boolean;
  deletedBy: string | null;
  reactionCount: number;
  createdAt: string;
  authorId: number;
  authorName: string;
  authorEmail: string;
}

export interface Analytics {
  posts: { total: number; today: number; thisWeek: number; thisMonth: number };
  comments: { total: number; today: number; thisWeek: number; thisMonth: number };
  reactions: { total: number; today: number; thisWeek: number; thisMonth: number };
  activeCategories: { id: number; name: string; slug: string; postCount: number }[];
  topPosters: { userId: number; name: string; email: string; postCount: number }[];
  topCommenters: { userId: number; name: string; email: string; commentCount: number }[];
  newMembersThisMonth: number;
}

export const adminApi = {
  getCategories: () => adminFetch<Category[]>("/admin/community/categories"),
  createCategory: (data: { name: string; slug: string; description?: string; sortOrder?: number }) =>
    adminFetch<Category>("/admin/community/categories", { method: "POST", body: JSON.stringify(data) }),
  updateCategory: (id: number, data: Partial<{ name: string; slug: string; description: string; sortOrder: number; isActive: boolean }>) =>
    adminFetch<Category>(`/admin/community/categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deactivateCategory: (id: number) =>
    adminFetch<Category>(`/admin/community/categories/${id}`, { method: "DELETE" }),
  reorderCategories: (order: { id: number; sortOrder: number }[]) =>
    adminFetch<Category[]>("/admin/community/categories/reorder", { method: "PATCH", body: JSON.stringify({ order }) }),

  getPosts: (page = 1, limit = 20) =>
    adminFetch<{ posts: AdminPost[]; total: number; page: number; limit: number }>(`/admin/community/posts?page=${page}&limit=${limit}`),
  togglePin: (id: number) =>
    adminFetch(`/admin/community/posts/${id}/pin`, { method: "PATCH" }),
  toggleFeature: (id: number) =>
    adminFetch(`/admin/community/posts/${id}/feature`, { method: "PATCH" }),
  deletePost: (id: number) =>
    adminFetch(`/admin/community/posts/${id}`, { method: "DELETE" }),
  deleteComment: (id: number) =>
    adminFetch(`/admin/community/comments/${id}`, { method: "DELETE" }),

  getComments: (page = 1, limit = 20) =>
    adminFetch<{ comments: AdminComment[]; total: number; page: number; limit: number }>(`/admin/community/comments?page=${page}&limit=${limit}`),

  getAnalytics: () => adminFetch<Analytics>("/admin/community/analytics"),
};
