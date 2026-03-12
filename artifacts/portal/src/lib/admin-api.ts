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

export function useAdminExportContent() {
  return useMutation({
    mutationFn: (trackIds: number[]) =>
      adminFetch<{ exportData: any }>("/admin/content/export", {
        method: "POST",
        body: JSON.stringify({ trackIds }),
      }),
  });
}

export function useAdminImportContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      adminFetch("/admin/content/import", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/content/tracks"] }),
  });
}

export function fetchChatAnalytics() {
  return adminFetch("/admin/chat/analytics");
}

export function fetchChatSessions(params: {
  page?: number; limit?: number; search?: string;
  userId?: number; dateFrom?: string; dateTo?: string;
  flagged?: boolean; ticketCreated?: boolean;
}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.search) qs.set("search", params.search);
  if (params.userId) qs.set("userId", String(params.userId));
  if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
  if (params.dateTo) qs.set("dateTo", params.dateTo);
  if (params.flagged) qs.set("flagged", "true");
  if (params.ticketCreated) qs.set("ticketCreated", "true");
  return adminFetch(`/admin/chat/sessions?${qs.toString()}`);
}

export function fetchChatSessionDetail(sessionId: number) {
  return adminFetch(`/admin/chat/sessions/${sessionId}`);
}

export function flagChatMessage(messageId: number, flagged: boolean) {
  return adminFetch(`/admin/chat/messages/${messageId}/flag`, {
    method: "PATCH",
    body: JSON.stringify({ flagged }),
  });
}

export function updateMessageNotes(messageId: number, notes: string) {
  return adminFetch(`/admin/chat/messages/${messageId}/notes`, {
    method: "PATCH",
    body: JSON.stringify({ notes }),
  });
}

export function fetchSystemPrompts() {
  return adminFetch("/admin/chat/system-prompts");
}

export function createSystemPrompt(data: { name: string; content: string }) {
  return adminFetch("/admin/chat/system-prompts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function activateSystemPrompt(id: number) {
  return adminFetch(`/admin/chat/system-prompts/${id}/activate`, { method: "PATCH" });
}

export function previewSystemPrompt(data: { content: string; testMessage: string }) {
  return adminFetch("/admin/chat/system-prompts/preview", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function fetchKnowledgebaseDocs(params?: { category?: string; search?: string }) {
  const qs = new URLSearchParams();
  if (params?.category) qs.set("category", params.category);
  if (params?.search) qs.set("search", params.search);
  return adminFetch(`/admin/chat/knowledgebase?${qs.toString()}`);
}

export function createKnowledgebaseDoc(data: { title: string; category: string; content: string }) {
  return adminFetch("/admin/chat/knowledgebase", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateKnowledgebaseDoc(id: number, data: { title?: string; category?: string; content?: string }) {
  return adminFetch(`/admin/chat/knowledgebase/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteKnowledgebaseDoc(id: number) {
  return adminFetch(`/admin/chat/knowledgebase/${id}`, { method: "DELETE" });
}

export function fetchRateLimits() {
  return adminFetch("/admin/chat/rate-limits");
}

export function updateRateLimits(limits: Array<{ tier: string; dailyLimit: number; maxOutputTokens: number }>) {
  return adminFetch("/admin/chat/rate-limits", {
    method: "PUT",
    body: JSON.stringify({ limits }),
  });
}

export interface VaultCollection {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  coverImageUrl: string | null;
  requiredEntitlement: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VaultResource {
  id: number;
  collectionId: number | null;
  title: string;
  description: string | null;
  longDescription: string | null;
  resourceType: string;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  fileType: string | null;
  previewImageUrl: string | null;
  contentHtml: string | null;
  externalUrl: string | null;
  videoUrl: string | null;
  tags: string[];
  requiredEntitlement: string | null;
  isFeatured: boolean;
  isPinned: boolean;
  isNew: boolean;
  status: string;
  version: string | null;
  updateNote: string | null;
  downloadCount: number;
  favoriteCount: number;
  sortOrder: number;
  collectionName?: string | null;
  createdAt: string;
  updatedAt: string;
  relatedResources?: { relationId: number; resourceId: number; title: string; resourceType: string }[];
  relatedLessons?: { relationId: number; lessonId: number; title: string }[];
}

export interface VaultAnalytics {
  mostDownloaded: { id: number; title: string; resourceType: string; downloadCount: number; collectionName: string | null }[];
  mostFavorited: { id: number; title: string; resourceType: string; favoriteCount: number; collectionName: string | null }[];
  zeroDownloads: { id: number; title: string; resourceType: string; createdAt: string; collectionName: string | null }[];
  downloadTrends: { date: string; downloads: number }[];
  searchGaps: { query: string; searchCount: number; avgResults: number }[];
  totalResources: number;
  totalCollections: number;
}

export function useAdminVaultCollections() {
  return useQuery({
    queryKey: ["/api/admin/vault/collections"],
    queryFn: () => adminFetch<VaultCollection[]>("/admin/vault/collections"),
  });
}

export function useAdminCreateVaultCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<VaultCollection>) =>
      adminFetch<VaultCollection>("/admin/vault/collections", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/vault/collections"] }),
  });
}

export function useAdminUpdateVaultCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Partial<VaultCollection>) =>
      adminFetch<VaultCollection>(`/admin/vault/collections/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/vault/collections"] }),
  });
}

export function useAdminDeleteVaultCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch(`/admin/vault/collections/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/vault/collections"] }),
  });
}

export function useAdminVaultResources(params: { type?: string; collection?: string; status?: string; search?: string; page?: number }) {
  const qs = new URLSearchParams();
  if (params.type && params.type !== "all") qs.set("type", params.type);
  if (params.collection && params.collection !== "all") qs.set("collection", params.collection);
  if (params.status && params.status !== "all") qs.set("status", params.status);
  if (params.search) qs.set("search", params.search);
  if (params.page) qs.set("page", String(params.page));
  return useQuery({
    queryKey: ["/api/admin/vault/resources", params],
    queryFn: () => adminFetch<{ resources: VaultResource[]; total: number; page: number; limit: number }>(`/admin/vault/resources?${qs.toString()}`),
  });
}

export function useAdminVaultResource(id: number) {
  return useQuery({
    queryKey: ["/api/admin/vault/resources", id],
    queryFn: () => adminFetch<VaultResource>(`/admin/vault/resources/${id}`),
    enabled: id > 0,
  });
}

export function useAdminCreateVaultResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<VaultResource>) =>
      adminFetch<VaultResource>("/admin/vault/resources", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/vault/resources"] }),
  });
}

export function useAdminUpdateVaultResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Partial<VaultResource>) =>
      adminFetch<VaultResource>(`/admin/vault/resources/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/vault/resources"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/vault/resources", vars.id] });
    },
  });
}

export function useAdminDuplicateVaultResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch<VaultResource>(`/admin/vault/resources/${id}/duplicate`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/vault/resources"] }),
  });
}

export function useAdminArchiveVaultResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch<VaultResource>(`/admin/vault/resources/${id}/archive`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/vault/resources"] }),
  });
}

export function useAdminAddVaultRelation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ resourceId, relatedResourceId }: { resourceId: number; relatedResourceId: number }) =>
      adminFetch(`/admin/vault/resources/${resourceId}/relations`, { method: "POST", body: JSON.stringify({ relatedResourceId }) }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["/api/admin/vault/resources", vars.resourceId] }),
  });
}

export function useAdminRemoveVaultRelation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ resourceId, relationId }: { resourceId: number; relationId: number }) =>
      adminFetch(`/admin/vault/resources/${resourceId}/relations/${relationId}`, { method: "DELETE" }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["/api/admin/vault/resources", vars.resourceId] }),
  });
}

export function useAdminAddVaultLessonRelation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ resourceId, lessonId }: { resourceId: number; lessonId: number }) =>
      adminFetch(`/admin/vault/resources/${resourceId}/lesson-relations`, { method: "POST", body: JSON.stringify({ lessonId }) }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["/api/admin/vault/resources", vars.resourceId] }),
  });
}

export function useAdminRemoveVaultLessonRelation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ resourceId, relationId }: { resourceId: number; relationId: number }) =>
      adminFetch(`/admin/vault/resources/${resourceId}/lesson-relations/${relationId}`, { method: "DELETE" }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["/api/admin/vault/resources", vars.resourceId] }),
  });
}

export function useAdminVaultUploadUrl() {
  return useMutation({
    mutationFn: () => adminFetch<{ uploadURL: string; objectPath: string }>("/admin/vault/upload-url", { method: "POST" }),
  });
}

export function useAdminSearchVaultResources() {
  return useMutation({
    mutationFn: (q: string) => adminFetch<{ id: number; title: string; resourceType: string }[]>(`/admin/vault/resources/search?q=${encodeURIComponent(q)}`),
  });
}

export function useAdminSearchLessons() {
  return useMutation({
    mutationFn: (q: string) => adminFetch<{ id: number; title: string }[]>(`/admin/vault/lessons/search?q=${encodeURIComponent(q)}`),
  });
}

export function useAdminVaultTags() {
  return useQuery({
    queryKey: ["/api/admin/vault/tags"],
    queryFn: () => adminFetch<string[]>("/admin/vault/tags"),
  });
}

export function useAdminVaultAnalytics() {
  return useQuery({
    queryKey: ["/api/admin/vault/analytics"],
    queryFn: () => adminFetch<VaultAnalytics>("/admin/vault/analytics"),
  });
}
