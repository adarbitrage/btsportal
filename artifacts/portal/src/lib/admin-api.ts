import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

export interface AdminTrack {
  id: number;
  title: string;
  description: string;
  sortOrder: number;
  status: "active" | "archived";
  requiredEntitlement: string | null;
  totalModules: number;
  totalLessons: number;
  createdAt: string;
  updatedAt: string;
  modules: AdminModule[];
}

export interface AdminModule {
  id: number;
  trackId: number;
  title: string;
  description: string;
  sortOrder: number;
  totalLessons: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminLesson {
  id: number;
  moduleId: number;
  title: string;
  contentType: "video_text" | "video_only" | "text_only";
  videoUrl: string | null;
  content: any;
  status: "draft" | "published";
  sortOrder: number;
  durationMinutes: number;
  resources: LessonResource[];
  actionItems: ActionItem[];
  createdAt: string;
  updatedAt: string;
}

export interface LessonResource {
  id: string;
  name: string;
  url: string;
  size: number;
  type: string;
}

export interface ActionItem {
  id: string;
  text: string;
  sortOrder: number;
}

export interface LessonVersion {
  id: number;
  lessonId: number;
  versionNumber: number;
  title: string;
  content: any;
  changeSummary: string;
  createdAt: string;
  createdBy: string;
}

export function useAdminListTracks() {
  return useQuery({
    queryKey: ["/api/admin/content/tracks"],
    queryFn: () => adminFetch<AdminTrack[]>("/admin/content/tracks"),
  });
}

export function useAdminGetLesson(id: number) {
  return useQuery({
    queryKey: ["/api/admin/content/lessons", id],
    queryFn: () => adminFetch<AdminLesson>(`/admin/content/lessons/${id}`),
    enabled: id > 0,
  });
}

export function useAdminCreateTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; description: string; requiredEntitlement?: string }) =>
      adminFetch<AdminTrack>("/admin/content/tracks", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] }),
  });
}

export function useAdminUpdateTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; title?: string; description?: string; status?: string; requiredEntitlement?: string | null }) =>
      adminFetch<AdminTrack>(`/admin/content/tracks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] }),
  });
}

export function useAdminReorderTracks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { orderedIds: number[] }) =>
      adminFetch("/admin/content/tracks/reorder", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] }),
  });
}

export function useAdminDuplicateTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch<AdminTrack>(`/admin/content/tracks/${id}/duplicate`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] }),
  });
}

export function useAdminCreateModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { trackId: number; title: string; description: string }) =>
      adminFetch<AdminModule>("/admin/content/modules", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] }),
  });
}

export function useAdminUpdateModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; title?: string; description?: string; trackId?: number }) =>
      adminFetch<AdminModule>(`/admin/content/modules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] }),
  });
}

export function useAdminDeleteModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch(`/admin/content/modules/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] }),
  });
}

export function useAdminReorderModules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { trackId: number; orderedIds: number[] }) =>
      adminFetch("/admin/content/modules/reorder", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] }),
  });
}

export function useAdminSaveLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Partial<Omit<AdminLesson, "id" | "createdAt" | "updatedAt">>) =>
      adminFetch<AdminLesson>(`/admin/content/lessons/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/content/lessons", vars.id] });
      qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] });
    },
  });
}

export function useAdminCreateLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { moduleId: number; title: string; contentType: string }) =>
      adminFetch<AdminLesson>("/admin/content/lessons", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] }),
  });
}

export function useAdminListLessonVersions(lessonId: number) {
  return useQuery({
    queryKey: ["/api/admin/content/lessons", lessonId, "versions"],
    queryFn: () => adminFetch<LessonVersion[]>(`/admin/content/lessons/${lessonId}/versions`),
    enabled: lessonId > 0,
  });
}

export function useAdminRestoreLessonVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lessonId, versionId }: { lessonId: number; versionId: number }) =>
      adminFetch<AdminLesson>(`/admin/content/lessons/${lessonId}/versions/${versionId}/restore`, {
        method: "POST",
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/content/lessons", vars.lessonId] });
      qc.invalidateQueries({ queryKey: ["/api/admin/content/lessons", vars.lessonId, "versions"] });
    },
  });
}

export function useAdminBulkPublishLessons() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { lessonIds: number[] }) =>
      adminFetch("/admin/content/lessons/bulk-publish", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] }),
  });
}

export function useAdminBulkMoveLessons() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { lessonIds: number[]; targetModuleId: number }) =>
      adminFetch("/admin/content/lessons/bulk-move", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] }),
  });
}

export function useAdminReorderLessons() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { moduleId: number; orderedIds: number[] }) =>
      adminFetch("/admin/content/lessons/reorder", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] }),
  });
}
