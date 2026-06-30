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
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json();
}

export interface GhlStatus {
  lastSuccessfulSync: string | null;
  queueDepth: number;
  failedJobCount: number;
  syncEnabled: boolean;
}

export interface GhlActivityLog {
  id: number;
  direction: string;
  action: string;
  status: string;
  userId: number | null;
  ghlContactId: string | null;
  createdAt: string | null;
}

export interface GhlFailedJob {
  id: number;
  action: string;
  userId: number | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: string | null;
}

export function fetchGhlStatus() {
  return adminFetch<GhlStatus>("/admin/ghl/status");
}

export function fetchGhlRecentActivity(limit = 50) {
  return adminFetch<GhlActivityLog[]>(`/admin/ghl/recent-activity?limit=${limit}`);
}

export function fetchGhlFailedJobs() {
  return adminFetch<GhlFailedJob[]>("/admin/ghl/failed-jobs");
}

export function retryGhlJob(jobId: string | number) {
  return adminFetch(`/admin/ghl/retry/${jobId}`, { method: "POST" });
}

export interface GhlContactRow {
  id: number;
  name?: string;
  email?: string;
  ghlContactId?: string | null;
  lastSyncDate?: string | null;
  memberSince?: string | null;
}

export interface GhlContactsResponse {
  contacts: GhlContactRow[];
  pagination: { page: number; totalPages: number; total: number };
}

export function fetchGhlContacts(params: { search?: string; filter?: string; page?: number; limit?: number }) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.filter) qs.set("filter", params.filter);
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  return adminFetch<GhlContactsResponse>(`/admin/ghl/contacts?${qs.toString()}`);
}

export function syncMember(userId: number) {
  return adminFetch(`/admin/ghl/sync-member/${userId}`, { method: "POST" });
}

export function bulkSync() {
  return adminFetch("/admin/ghl/bulk-sync", { method: "POST" });
}

export interface GhlConfigData {
  apiKey?: string;
  locationId?: string;
  webhookSecret?: string;
  tagPrefix?: string;
  syncEnabled?: boolean;
  pipelineStageMapping?: Record<string, string> | null;
  customFieldMapping?: Record<string, string> | null;
}

export function fetchGhlConfig() {
  return adminFetch<GhlConfigData>("/admin/ghl/config");
}

export function updateGhlConfig(config: Record<string, any>) {
  return adminFetch("/admin/ghl/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export interface AdminAnnouncement {
  id: number;
  title: string;
  body: string;
  type: string;
  createdAt: string;
}

export function listAdminAnnouncements() {
  return adminFetch<AdminAnnouncement[]>("/admin/announcements");
}

export function createAnnouncement(data: {
  title: string;
  body: string;
  type?: string;
}) {
  return adminFetch<AdminAnnouncement>("/admin/announcements", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateAnnouncement(
  id: number,
  data: { title: string; body: string; type?: string }
) {
  return adminFetch<AdminAnnouncement>(`/admin/announcements/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteAnnouncement(id: number) {
  return adminFetch<void>(`/admin/announcements/${id}`, {
    method: "DELETE",
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
  title: string;
  imageUrl: string | null;
  status: string;
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

  getPosts: (page = 1, limit = 20, status?: string) =>
    adminFetch<{ posts: AdminPost[]; total: number; page: number; limit: number }>(`/admin/community/posts?page=${page}&limit=${limit}${status ? `&status=${status}` : ""}`),
  getPendingCount: () =>
    adminFetch<{ count: number }>("/admin/community/posts/pending-count"),
  togglePin: (id: number) =>
    adminFetch(`/admin/community/posts/${id}/pin`, { method: "PATCH" }),
  toggleFeature: (id: number) =>
    adminFetch(`/admin/community/posts/${id}/feature`, { method: "PATCH" }),
  approvePost: (id: number) =>
    adminFetch(`/admin/community/posts/${id}/approve`, { method: "PATCH" }),
  rejectPost: (id: number) =>
    adminFetch(`/admin/community/posts/${id}/reject`, { method: "PATCH" }),
  deletePost: (id: number) =>
    adminFetch(`/admin/community/posts/${id}`, { method: "DELETE" }),
  deleteComment: (id: number) =>
    adminFetch(`/admin/community/comments/${id}`, { method: "DELETE" }),

  getComments: (page = 1, limit = 20) =>
    adminFetch<{ comments: AdminComment[]; total: number; page: number; limit: number }>(`/admin/community/comments?page=${page}&limit=${limit}`),

  getAnalytics: () => adminFetch<Analytics>("/admin/community/analytics"),
};

export interface AdminWin {
  id: number;
  userId: number;
  userName: string;
  userEmail: string;
  milestoneId: number;
  milestoneName: string;
  milestoneIcon: string;
  milestoneSlug: string;
  milestoneCategory: string;
  title: string;
  description: string;
  revenueAmount: string | null;
  metricLabel: string | null;
  metricValue: string | null;
  proofImageUrl: string | null;
  proofImage2Url: string | null;
  proofVerified: boolean;
  winDate: string;
  status: string;
  featuredAt: string | null;
  allowTestimonial: boolean;
  allowPublicName: boolean;
  testimonialRequested: boolean;
  testimonialText: string | null;
  testimonialApproved: boolean;
  testimonialApprovedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminWinsResponse {
  wins: AdminWin[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export const adminWinsApi = {
  getWins: (params: { page?: number; limit?: number; status?: string; testimonial?: string }) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.status) qs.set("status", params.status);
    if (params.testimonial) qs.set("testimonial", params.testimonial);
    return adminFetch<AdminWinsResponse>(`/admin/wins?${qs.toString()}`);
  },
  featureWin: (id: number) =>
    adminFetch<AdminWin>(`/admin/wins/${id}/feature`, { method: "PATCH" }),
  verifyWin: (id: number) =>
    adminFetch<AdminWin>(`/admin/wins/${id}/verify`, { method: "PATCH" }),
  hideWin: (id: number) =>
    adminFetch<AdminWin>(`/admin/wins/${id}/hide`, { method: "PATCH" }),
  requestTestimonial: (id: number) =>
    adminFetch<AdminWin>(`/admin/wins/${id}/request-testimonial`, { method: "POST" }),
  approveTestimonial: (id: number) =>
    adminFetch<AdminWin>(`/admin/wins/${id}/approve-testimonial`, { method: "PATCH" }),
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

export interface ChatAnalyticsData {
  messages: { today: number; week: number; month: number; total: number };
  totalSessions: number;
  avgMessagesPerUserPerDay: number;
  flaggedMessages: number;
  tierBreakdown: Array<{ tier: string; totalMessages: number; uniqueUsers: number }>;
  peakHours: Array<{ hour: number; count: number }>;
}

export function fetchChatAnalytics() {
  return adminFetch<ChatAnalyticsData>("/admin/chat/analytics");
}

export interface ContentGapNearMiss {
  id: number;
  title: string;
  score: number;
}

export interface ContentGapQuestion {
  id: number;
  surface: "chat" | "voice";
  questionText: string;
  topScore: number;
  nearMisses: ContentGapNearMiss[];
  askCount: number;
  firstAskedAt: string;
  lastAskedAt: string;
}

export interface ContentGapsResponse {
  questions: ContentGapQuestion[];
  summary: {
    distinctQuestions: number;
    totalAsks: number;
    chatQuestions: number;
    voiceQuestions: number;
  };
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export function fetchContentGaps(params: {
  sort?: "frequency" | "recent";
  surface?: "chat" | "voice";
  page?: number;
  limit?: number;
} = {}) {
  const qs = new URLSearchParams();
  if (params.sort) qs.set("sort", params.sort);
  if (params.surface) qs.set("surface", params.surface);
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString();
  return adminFetch<ContentGapsResponse>(`/admin/content-gaps${suffix ? `?${suffix}` : ""}`);
}

export interface ChatSessionRow {
  id: number;
  title: string;
  userName: string;
  userEmail: string;
  messageCount: number;
  flaggedCount: number;
  createdAt: string;
}

export interface ChatSessionsResponse {
  sessions: ChatSessionRow[];
  pagination: { total: number; totalPages: number };
}

export interface ChatMessageRow {
  id: number;
  role: string;
  content: string;
  createdAt: string;
  flagged?: boolean;
  adminNotes?: string | null;
}

export interface ChatSessionDetail {
  title: string;
  userName: string;
  userEmail: string;
  createdAt: string;
  messages: ChatMessageRow[];
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
  return adminFetch<ChatSessionsResponse>(`/admin/chat/sessions?${qs.toString()}`);
}

export function fetchChatSessionDetail(sessionId: number) {
  return adminFetch<ChatSessionDetail>(`/admin/chat/sessions/${sessionId}`);
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

export interface SystemPrompt {
  id: number;
  version: number;
  name: string;
  content: string;
  isActive: boolean;
  createdAt: string;
}

export function fetchSystemPrompts() {
  return adminFetch<SystemPrompt[]>("/admin/chat/system-prompts");
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
  return adminFetch<{ response: string }>("/admin/chat/system-prompts/preview", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export interface KnowledgebaseDoc {
  id: number;
  title: string;
  category: string;
  content: string;
  audience: "member" | "admin";
  chunkCount: number;
  updatedAt: string;
}

export function fetchKnowledgebaseDocs(params?: { category?: string; search?: string }) {
  const qs = new URLSearchParams();
  if (params?.category) qs.set("category", params.category);
  if (params?.search) qs.set("search", params.search);
  return adminFetch<KnowledgebaseDoc[]>(`/admin/chat/knowledgebase?${qs.toString()}`);
}

export interface KbManualReviewResult {
  stagingDocId: number;
  title: string;
  action: "analyzed" | "needs_review";
  confidenceScore: number | null;
  summary: string;
}

export function createKnowledgebaseDocWithReview(data: { title: string; category: string; content: string; audience?: "member" | "admin" }) {
  return adminFetch<KbManualReviewResult>(
    "/admin/knowledgebase/pipeline/create-from-text",
    { method: "POST", body: JSON.stringify(data) },
  );
}

export function updateKnowledgebaseDoc(id: number, data: { title?: string; category?: string; content?: string; audience?: "member" | "admin" }) {
  return adminFetch(`/admin/chat/knowledgebase/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteKnowledgebaseDoc(id: number) {
  return adminFetch(`/admin/chat/knowledgebase/${id}`, { method: "DELETE" });
}

export function reloadKnowledgeBaseCache() {
  return adminFetch<{ success: boolean; message: string }>("/admin/chat/knowledgebase/reload", { method: "POST" });
}

// ── Live AI Documents (AI Knowledgebase — phase-1 clean corpus) ──────────────
export interface AiLiveDocument {
  id: number;
  title: string;
  slug: string | null;
  category: string;
  content: string;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export function fetchAiLiveDocuments(params?: { category?: string; search?: string }) {
  const qs = new URLSearchParams();
  if (params?.category) qs.set("category", params.category);
  if (params?.search) qs.set("search", params.search);
  return adminFetch<AiLiveDocument[]>(`/admin/ai-live-documents?${qs.toString()}`);
}

export function createAiLiveDocument(data: { title: string; category: string; content: string; slug?: string }) {
  return adminFetch<AiLiveDocument>("/admin/ai-live-documents", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateAiLiveDocument(id: number, data: { title?: string; category?: string; content?: string; slug?: string }) {
  return adminFetch<AiLiveDocument>(`/admin/ai-live-documents/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteAiLiveDocument(id: number) {
  return adminFetch<{ success: boolean }>(`/admin/ai-live-documents/${id}`, { method: "DELETE" });
}

// ── AI Source Knowledge (the raw-source mining layer) ───────────────────────
export interface AiSourceDocument {
  id: number;
  title: string;
  content: string;
  sourceType: string;
  authorityRole: string;
  sourceName: string | null;
  sourceId: number | null;
  provenanceNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiSourceDocumentsResponse {
  documents: AiSourceDocument[];
  counts: Record<string, number>;
}

export function fetchAiSourceDocuments(params?: { folder?: string; search?: string }) {
  const qs = new URLSearchParams();
  if (params?.folder) qs.set("folder", params.folder);
  if (params?.search) qs.set("search", params.search);
  return adminFetch<AiSourceDocumentsResponse>(`/admin/ai-source-documents?${qs.toString()}`);
}

export function fetchAiSourceDocument(id: number) {
  return adminFetch<AiSourceDocument>(`/admin/ai-source-documents/${id}`);
}

export function createAiSourceDocument(data: {
  title: string;
  content: string;
  sourceType: string;
  authorityRole?: string;
  sourceName?: string;
  sourceId?: number;
  provenanceNote?: string;
}) {
  return adminFetch<AiSourceDocument>("/admin/ai-source-documents", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function requestKbUploadUrl(params: { name: string; size: number; contentType: string }) {
  return adminFetch<{ uploadURL: string; objectPath: string }>("/storage/uploads/request-url", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function createKbStagingFromUpload(params: {
  objectPath: string;
  title: string;
  category: string;
  audience: "member" | "admin";
  originalFilename: string;
  mimeType: string;
}) {
  return adminFetch<{ stagingDocId: number; title: string; status: string; processingStage: string | null; fileType: string }>(
    "/admin/knowledgebase/pipeline/create-from-upload",
    { method: "POST", body: JSON.stringify(params) },
  );
}

export interface KbStagingStatus {
  id: number;
  title: string;
  status: string;
  processingStage: string | null;
  processingError: string | null;
}

export function getKbStagingDoc(id: number) {
  return adminFetch<KbStagingStatus>(`/admin/knowledgebase/staging/${id}`);
}

// ── Archived staging drafts (read-only "Archive Backup" page) ────────────────
export interface KbArchiveDoc {
  id: number;
  title: string;
  category: string;
  content: string;
  tags: string;
  source: string;
  sourceVideoTitle: string;
  status: string;
  homeRoot: string;
  node: string;
  docType: string;
  createdAt: string | null;
  archivedAt: string | null;
}

export function fetchKbArchiveDocs() {
  return adminFetch<{ docs: KbArchiveDoc[]; total: number }>(
    "/admin/knowledgebase/archive",
  );
}

export interface RateLimitTier {
  tier: string;
  dailyLimit: number;
  maxOutputTokens: number;
}

export function fetchRateLimits() {
  return adminFetch<RateLimitTier[]>("/admin/chat/rate-limits");
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

export interface AdminToolCategory {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
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
export interface AdminTool {
  id: number;
  slug: string;
  name: string;
  shortDescription: string;
  longDescription: string | null;
  icon: string | null;
  categoryId: number | null;
  categoryName: string | null;
  type: string;
  requiredEntitlement: string;
  config: Record<string, unknown>;
  isFeatured: number;
  isNew: boolean;
  isBeta: boolean;
  status: string;
  badge: string | null;
  totalLaunches: number;
  sortOrder: number;
  videoTutorialUrl: string | null;
  helpDocUrl: string | null;
  rateLimitPerDay: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminToolAnalytics {
  totalOpens: {
    today: number; todayTrend: number;
    week: number; weekTrend: number;
    month: number; monthTrend: number;
  };
  popularTools: { toolId: number; toolName: string; toolSlug: string; opens: number }[];
  usageByTier: { entitlementTier: string | null; count: number }[];
  aiStats: { totalGenerations: number; totalTokens: number; totalCostCents: number };
  toolAdoption: { toolId: number; toolName: string; uniqueUsers: number; adoptionRate: number }[];
  dailyUsage: { date: string; count: number }[];
  perToolDailyUsage: { toolId: number; toolName: string; date: string; count: number }[];
  totalUsers: number;
}

export interface AdminToolUsageDetail {
  tool: AdminTool & { categoryName: string | null };
  dailyUsage: { date: string; count: number }[];
  actionBreakdown: { action: string; count: number }[];
  uniqueUsers: number;
  totalOpensAllTime: number;
}

export function useAdminListToolCategories() {
  return useQuery({
    queryKey: ["/api/admin/tool-categories"],
    queryFn: () => adminFetch<AdminToolCategory[]>("/admin/tool-categories"),
  });
}

export function useAdminCreateToolCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; slug: string; description?: string; icon?: string; sortOrder?: number }) =>
      adminFetch<AdminToolCategory>("/admin/tool-categories", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/tool-categories"] }),
  });
}

export function useAdminUpdateToolCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; slug?: string; description?: string; icon?: string; sortOrder?: number; isActive?: boolean }) =>
      adminFetch<AdminToolCategory>(`/admin/tool-categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/tool-categories"] }),
  });
}

export function useAdminDeleteToolCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch(`/admin/tool-categories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/tool-categories"] }),
  });
}

export function useAdminListTools() {
  return useQuery({
    queryKey: ["/api/admin/tools"],
    queryFn: () => adminFetch<AdminTool[]>("/admin/tools"),
  });
}

export function useAdminCreateTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<AdminTool> & { slug: string; name: string; shortDescription: string }) =>
      adminFetch<AdminTool>("/admin/tools", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/tools"] }),
  });
}

export function useAdminUpdateTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Partial<AdminTool>) =>
      adminFetch<AdminTool>(`/admin/tools/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/tools"] }),
  });
}

export function useAdminDeleteTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch(`/admin/tools/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/tools"] }),
  });
}

export function useAdminActivateTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch<AdminTool>(`/admin/tools/${id}/activate`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/tools"] }),
  });
}

export function useAdminDeactivateTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminFetch<AdminTool>(`/admin/tools/${id}/deactivate`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/tools"] }),
  });
}

export function useAdminToolAnalytics() {
  return useQuery({
    queryKey: ["/api/admin/tools/analytics"],
    queryFn: () => adminFetch<AdminToolAnalytics>("/admin/tools/analytics"),
  });
}

export function useAdminToolUsage(id: number) {
  return useQuery({
    queryKey: ["/api/admin/tools", id, "usage"],
    queryFn: () => adminFetch<AdminToolUsageDetail>(`/admin/tools/${id}/usage`),
    enabled: id > 0,
  });
}

export interface AdminAffiliateNetwork {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  logoUrl: string | null;
  logoBg: string;
  highlights: string[];
  publishers: string;
  approvalLabel: string;
  recommendedForBeginners: boolean;
  accentPreset: string;
  accentBorder: string;
  accentBadgeBg: string;
  accentBadgeText: string;
  accentBadgeBorder: string;
  registerUrl: string | null;
  loginUrl: string | null;
  extraCtaLabel: string | null;
  extraCtaHref: string | null;
  extraCtaStyle: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AffiliateNetworkFormData {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  logoUrl: string | null;
  logoBg: string;
  highlights: string[];
  publishers: string;
  approvalLabel: string;
  recommendedForBeginners: boolean;
  accentPreset: string;
  accentBorder: string;
  accentBadgeBg: string;
  accentBadgeText: string;
  accentBadgeBorder: string;
  registerUrl: string | null;
  loginUrl: string | null;
  extraCtaLabel: string | null;
  extraCtaHref: string | null;
  extraCtaStyle: string;
  displayOrder: number;
  isActive: boolean;
}

export const adminAffiliateNetworksApi = {
  list: () => adminFetch<AdminAffiliateNetwork[]>("/admin/affiliate-networks"),
  create: (data: AffiliateNetworkFormData) =>
    adminFetch<AdminAffiliateNetwork>("/admin/affiliate-networks", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: number, data: Partial<AffiliateNetworkFormData>) =>
    adminFetch<AdminAffiliateNetwork>(`/admin/affiliate-networks/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: number) =>
    adminFetch<{ success: boolean }>(`/admin/affiliate-networks/${id}`, { method: "DELETE" }),
  reorder: (order: Array<{ id: number; displayOrder: number }>) =>
    adminFetch<{ success: boolean }>("/admin/affiliate-networks/reorder", {
      method: "POST",
      body: JSON.stringify({ order }),
    }),
  getLogoUploadUrl: () =>
    adminFetch<{ uploadURL: string; objectPath: string }>("/admin/affiliate-networks/upload-logo-url", {
      method: "POST",
    }),
};

export function useAdminAffiliateNetworks() {
  return useQuery({
    queryKey: ["/api/admin/affiliate-networks"],
    queryFn: () => adminAffiliateNetworksApi.list(),
  });
}

export function useAdminCreateAffiliateNetwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: AffiliateNetworkFormData) => adminAffiliateNetworksApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/affiliate-networks"] });
      qc.invalidateQueries({ queryKey: ["/api/affiliate-networks"] });
    },
  });
}

export function useAdminUpdateAffiliateNetwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<AffiliateNetworkFormData> }) =>
      adminAffiliateNetworksApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/affiliate-networks"] });
      qc.invalidateQueries({ queryKey: ["/api/affiliate-networks"] });
    },
  });
}

export function useAdminDeleteAffiliateNetwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminAffiliateNetworksApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/affiliate-networks"] });
      qc.invalidateQueries({ queryKey: ["/api/affiliate-networks"] });
    },
  });
}

export function useAdminReorderAffiliateNetworks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (order: Array<{ id: number; displayOrder: number }>) =>
      adminAffiliateNetworksApi.reorder(order),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/affiliate-networks"] });
      qc.invalidateQueries({ queryKey: ["/api/affiliate-networks"] });
    },
  });
}

export interface AdminMediaMavensProduct {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  category: string;
  imageUrl: string | null;
  description: string;
  costToConsumer: string;
  affiliateCommission: string;
  salesPageUrl: string;
  logoDriveUrl: string;
  affiliateLink: string;
  tapfiliateProgramId: string | null;
  tapfiliateProgramTitle: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MediaMavensProductFormData {
  slug: string;
  name: string;
  tagline: string;
  category: string;
  imageUrl: string | null;
  description: string;
  costToConsumer: string;
  affiliateCommission: string;
  salesPageUrl: string;
  logoDriveUrl: string;
  affiliateLink: string;
  tapfiliateProgramId: string | null;
  tapfiliateProgramTitle: string | null;
  displayOrder: number;
  isActive: boolean;
}

export interface TapfiliateProgram {
  id: string;
  title: string;
}

export const adminMediaMavensApi = {
  list: () => adminFetch<AdminMediaMavensProduct[]>("/admin/media-mavens-products"),
  create: (data: MediaMavensProductFormData) =>
    adminFetch<AdminMediaMavensProduct>("/admin/media-mavens-products", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: number, data: Partial<MediaMavensProductFormData>) =>
    adminFetch<AdminMediaMavensProduct>(`/admin/media-mavens-products/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: number) =>
    adminFetch<{ success: boolean }>(`/admin/media-mavens-products/${id}`, { method: "DELETE" }),
  reorder: (order: Array<{ id: number; displayOrder: number }>) =>
    adminFetch<{ success: boolean }>("/admin/media-mavens-products/reorder", {
      method: "POST",
      body: JSON.stringify({ order }),
    }),
  getImageUploadUrl: () =>
    adminFetch<{ uploadURL: string; objectPath: string }>("/admin/media-mavens-products/upload-image-url", {
      method: "POST",
    }),
  listTapfiliatePrograms: () =>
    adminFetch<TapfiliateProgram[]>("/admin/tapfiliate/programs"),
};

export function useAdminMediaMavensProducts() {
  return useQuery({
    queryKey: ["/api/admin/media-mavens-products"],
    queryFn: () => adminMediaMavensApi.list(),
  });
}

export function useAdminCreateMediaMavensProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: MediaMavensProductFormData) => adminMediaMavensApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/media-mavens-products"] });
      qc.invalidateQueries({ queryKey: ["/api/media-mavens-products"] });
    },
  });
}

export function useAdminUpdateMediaMavensProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<MediaMavensProductFormData> }) =>
      adminMediaMavensApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/media-mavens-products"] });
      qc.invalidateQueries({ queryKey: ["/api/media-mavens-products"] });
    },
  });
}

export function useAdminDeleteMediaMavensProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminMediaMavensApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/media-mavens-products"] });
      qc.invalidateQueries({ queryKey: ["/api/media-mavens-products"] });
    },
  });
}

export function useAdminReorderMediaMavensProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (order: Array<{ id: number; displayOrder: number }>) =>
      adminMediaMavensApi.reorder(order),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/media-mavens-products"] });
      qc.invalidateQueries({ queryKey: ["/api/media-mavens-products"] });
    },
  });
}

export function useAdminTapfiliatePrograms() {
  return useQuery({
    queryKey: ["/api/admin/tapfiliate/programs"],
    queryFn: () => adminMediaMavensApi.listTapfiliatePrograms(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export interface AdminMediaMavensCategory {
  id: number;
  slug: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MediaMavensCategoryFormData {
  slug: string;
  name: string;
  displayOrder?: number;
  isActive?: boolean;
}

export const adminMediaMavensCategoriesApi = {
  list: () => adminFetch<AdminMediaMavensCategory[]>("/admin/media-mavens-categories"),
  create: (data: MediaMavensCategoryFormData) =>
    adminFetch<AdminMediaMavensCategory>("/admin/media-mavens-categories", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: number, data: Partial<MediaMavensCategoryFormData>) =>
    adminFetch<AdminMediaMavensCategory>(`/admin/media-mavens-categories/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: number) =>
    adminFetch<{ success: boolean }>(`/admin/media-mavens-categories/${id}`, { method: "DELETE" }),
  reorder: (order: Array<{ id: number; displayOrder: number }>) =>
    adminFetch<{ success: boolean }>("/admin/media-mavens-categories/reorder", {
      method: "POST",
      body: JSON.stringify({ order }),
    }),
};

export function useAdminMediaMavensCategories() {
  return useQuery({
    queryKey: ["/api/admin/media-mavens-categories"],
    queryFn: () => adminMediaMavensCategoriesApi.list(),
  });
}

function invalidateCategoryQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["/api/admin/media-mavens-categories"] });
  qc.invalidateQueries({ queryKey: ["/api/media-mavens-categories"] });
  qc.invalidateQueries({ queryKey: ["/api/admin/media-mavens-products"] });
  qc.invalidateQueries({ queryKey: ["/api/media-mavens-products"] });
}

export function useAdminCreateMediaMavensCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: MediaMavensCategoryFormData) => adminMediaMavensCategoriesApi.create(data),
    onSuccess: () => invalidateCategoryQueries(qc),
  });
}

export function useAdminUpdateMediaMavensCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<MediaMavensCategoryFormData> }) =>
      adminMediaMavensCategoriesApi.update(id, data),
    onSuccess: () => invalidateCategoryQueries(qc),
  });
}

export function useAdminDeleteMediaMavensCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminMediaMavensCategoriesApi.delete(id),
    onSuccess: () => invalidateCategoryQueries(qc),
  });
}

export function useAdminReorderMediaMavensCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (order: Array<{ id: number; displayOrder: number }>) =>
      adminMediaMavensCategoriesApi.reorder(order),
    onSuccess: () => invalidateCategoryQueries(qc),
  });
}

export type WordlistCategory = "profanity" | "spam";
export type WordlistSeverity = "hard" | "soft";

export interface WordlistEntry {
  id: number;
  word: string;
  category: WordlistCategory;
  severity: WordlistSeverity;
  addedBy: string | null;
  addedAt: string;
  updatedAt: string;
}

export interface WordlistEntryFormData {
  word: string;
  category: WordlistCategory;
  severity: WordlistSeverity;
}

export const adminWordlistApi = {
  list: () => adminFetch<WordlistEntry[]>("/admin/moderation/wordlist"),
  create: (data: WordlistEntryFormData) =>
    adminFetch<WordlistEntry>("/admin/moderation/wordlist", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: number, data: Partial<WordlistEntryFormData>) =>
    adminFetch<WordlistEntry>(`/admin/moderation/wordlist/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: number) =>
    adminFetch<{ success: boolean }>(`/admin/moderation/wordlist/${id}`, { method: "DELETE" }),
};

const WORDLIST_KEY = ["/api/admin/moderation/wordlist"] as const;

export function useAdminWordlist() {
  return useQuery({
    queryKey: WORDLIST_KEY,
    queryFn: () => adminWordlistApi.list(),
  });
}

export function useAdminCreateWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: WordlistEntryFormData) => adminWordlistApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WORDLIST_KEY });
    },
  });
}

export function useAdminUpdateWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<WordlistEntryFormData> }) =>
      adminWordlistApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WORDLIST_KEY });
    },
  });
}

export function useAdminDeleteWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminWordlistApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WORDLIST_KEY });
    },
  });
}

export interface StrikeUser {
  userId: number;
  name: string;
  email: string;
  strikeCount: number;
  isBanned: boolean;
  postingBannedAt: string | null;
  lastStrikeAt: string;
}

export interface StrikeRecord {
  id: number;
  reason: string;
  queueId: number | null;
  targetType: string;
  targetId: number;
  createdAt: string;
}

export interface AutoBanRecord {
  id: number;
  actorId: number | null;
  actorEmail: string | null;
  description: string | null;
  metadata: {
    userId?: number;
    reviewerId?: number | null;
    triggeringQueueId?: number;
    triggeringStrikeId?: number;
    strikeCount?: number;
    targetType?: string;
    targetId?: number;
  } | null;
  createdAt: string;
}

export interface ManualBanRecord {
  id: number;
  actionType: "ban_posting" | "unban_posting";
  actorId: number | null;
  actorEmail: string | null;
  description: string | null;
  metadata: {
    userId?: number;
    bannedAt?: string;
    strikesCleared?: boolean;
    previousBannedAt?: string | null;
  } | null;
  createdAt: string;
}

export interface BanHistoryEntry {
  id: number;
  actionType: "ban_posting" | "unban_posting" | "auto_ban_posting";
  actorId: number | null;
  actorEmail: string | null;
  description: string | null;
  metadata: {
    userId?: number;
    bannedAt?: string;
    strikesCleared?: boolean;
    previousBannedAt?: string | null;
    reviewerId?: number | null;
    triggeringQueueId?: number;
    triggeringStrikeId?: number;
    strikeCount?: number;
    targetType?: string;
    targetId?: number;
  } | null;
  createdAt: string;
}

export interface UserStrikesDetail {
  user: {
    id: number;
    name: string;
    email: string;
    postingBannedAt: string | null;
    isBanned: boolean;
  };
  strikes: StrikeRecord[];
  strikeCount: number;
  autoBan: AutoBanRecord | null;
  manualBan: ManualBanRecord | null;
  banHistory: BanHistoryEntry[];
}

export function useAdminStrikesList() {
  return useQuery({
    queryKey: ["/api/admin/strikes/users"],
    queryFn: () => adminFetch<{ users: StrikeUser[] }>("/admin/strikes/users"),
  });
}

export function useAdminUserStrikes(userId: number) {
  return useQuery({
    queryKey: ["/api/admin/strikes/users", userId],
    queryFn: () => adminFetch<UserStrikesDetail>(`/admin/strikes/users/${userId}`),
    enabled: userId > 0,
  });
}

export function useAdminBanUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) =>
      adminFetch<{ success: boolean; bannedAt: string }>(`/admin/strikes/users/${userId}/ban`, {
        method: "POST",
      }),
    onSuccess: (_, userId) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/strikes/users"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/strikes/users", userId] });
    },
  });
}

export function useAdminUnbanUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, clearStrikes }: { userId: number; clearStrikes: boolean }) =>
      adminFetch<{ success: boolean; strikesCleared: boolean }>(
        `/admin/strikes/users/${userId}/unban${clearStrikes ? "?clearStrikes=true" : ""}`,
        { method: "POST" }
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/strikes/users"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/strikes/users", vars.userId] });
    },
  });
}

// ─── Assistant Cards ──────────────────────────────────────────────────────────

export interface AssistantCardGroup {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantCard {
  id: number;
  groupId: number;
  title: string;
  description: string | null;
  icon: string | null;
  entitlementKey: string | null;
  upgradeProductId: number | null;
  upgradeProductName: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantCardQuestion {
  id: number;
  cardId: number;
  body: string;
  sortOrder: number;
  isActive: boolean;
  generatedBy: string;
  retrievalConfidence: number | null;
  sourceKbDocIds: number[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminUpgradeProduct {
  id: number;
  name: string;
  slug: string;
}

// Groups
export function useAdminAssistantGroups() {
  return useQuery({
    queryKey: ["/api/admin/assistant/groups"],
    queryFn: () => adminFetch<AssistantCardGroup[]>("/admin/assistant/groups"),
  });
}

export function useAdminCreateAssistantGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; icon?: string }) =>
      adminFetch<AssistantCardGroup>("/admin/assistant/groups", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/assistant/groups"] }),
  });
}

export function useAdminUpdateAssistantGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<{ name: string; description: string | null; icon: string | null; isActive: boolean }> }) =>
      adminFetch<AssistantCardGroup>(`/admin/assistant/groups/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/assistant/groups"] }),
  });
}

export function useAdminReorderAssistantGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ordered_ids: number[]) =>
      adminFetch<{ message: string }>("/admin/assistant/groups/reorder", {
        method: "POST",
        body: JSON.stringify({ ordered_ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/assistant/groups"] }),
  });
}

// Cards
export function useAdminAssistantCards() {
  return useQuery({
    queryKey: ["/api/admin/assistant/cards"],
    queryFn: () => adminFetch<AssistantCard[]>("/admin/assistant/cards"),
  });
}

export function useAdminCreateAssistantCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      groupId: number;
      title: string;
      description?: string | null;
      icon?: string | null;
      entitlementKey?: string | null;
      upgradeProductId?: number | null;
    }) =>
      adminFetch<AssistantCard>("/admin/assistant/cards", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/assistant/cards"] }),
  });
}

export function useAdminUpdateAssistantCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: Partial<{
        groupId: number;
        title: string;
        description: string | null;
        icon: string | null;
        entitlementKey: string | null;
        upgradeProductId: number | null;
        isActive: boolean;
      }>;
    }) =>
      adminFetch<AssistantCard>(`/admin/assistant/cards/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/assistant/cards"] }),
  });
}

export function useAdminReorderAssistantCards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ordered_ids: number[]) =>
      adminFetch<{ message: string }>("/admin/assistant/cards/reorder", {
        method: "POST",
        body: JSON.stringify({ ordered_ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/assistant/cards"] }),
  });
}

// Questions
export function useAdminAssistantQuestions(cardId: number) {
  return useQuery({
    queryKey: ["/api/admin/assistant/questions", cardId],
    queryFn: () => adminFetch<AssistantCardQuestion[]>(`/admin/assistant/questions?cardId=${cardId}`),
    enabled: cardId > 0,
  });
}

export function useAdminCreateAssistantQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      cardId: number;
      body: string;
      generatedBy?: string;
      retrievalConfidence?: number | null;
      sourceKbDocIds?: number[];
    }) =>
      adminFetch<AssistantCardQuestion>("/admin/assistant/questions", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/assistant/questions", vars.cardId] });
    },
  });
}

export function useAdminUpdateAssistantQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      cardId,
      data,
    }: {
      id: number;
      cardId: number;
      data: Partial<{ body: string; isActive: boolean }>;
    }) =>
      adminFetch<AssistantCardQuestion>(`/admin/assistant/questions/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/assistant/questions", vars.cardId] });
    },
  });
}

export function useAdminReorderAssistantQuestions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cardId, ordered_ids }: { cardId: number; ordered_ids: number[] }) =>
      adminFetch<{ message: string }>("/admin/assistant/questions/reorder", {
        method: "POST",
        body: JSON.stringify({ ordered_ids }),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/assistant/questions", vars.cardId] });
    },
  });
}

export function useAdminUpgradeProducts() {
  return useQuery({
    queryKey: ["/api/admin/products"],
    queryFn: () => adminFetch<AdminUpgradeProduct[]>("/admin/products"),
  });
}

// ─── KB Docs (for the Generate Questions picker) ──────────────────────────────

export interface KbDoc {
  id: number;
  title: string;
  category: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export function useAdminKbDocs(search?: string) {
  return useQuery({
    queryKey: ["/api/admin/chat/knowledgebase", search ?? ""],
    queryFn: () =>
      adminFetch<KbDoc[]>(
        `/admin/chat/knowledgebase${search ? `?search=${encodeURIComponent(search)}` : ""}`,
      ),
  });
}

// ─── Generate Questions ────────────────────────────────────────────────────────

export interface GenerateQuestionsCandidate {
  question_text: string;
  source_kb_doc_ids: number[];
  retrieval_confidence: number;
}

export interface GenerateQuestionsResult {
  candidates: GenerateQuestionsCandidate[];
  discarded_count: number;
  warning?: string;
}

export function useAdminGenerateQuestions() {
  return useMutation({
    mutationFn: (data: {
      cardId: number;
      kbDocIds: number[];
      kbTags: string[];
      targetCount: number;
    }) =>
      adminFetch<GenerateQuestionsResult>(
        `/admin/assistant/cards/${data.cardId}/generate-questions`,
        {
          method: "POST",
          body: JSON.stringify({
            kb_doc_ids: data.kbDocIds,
            kb_tags: data.kbTags,
            target_count: data.targetCount,
          }),
        },
      ),
  });
}

// ── Transcript Cleaner (Task #1468) ─────────────────────────────────────────
// Raw transcripts are intaken, AI-cleaned, reviewed/refined, then filed into
// the AI Source Knowledge library. Distinct from the curated Document Review
// pipeline — these are raw source, never citable truth.

export interface TranscriptCleanerFlag {
  type: string;
  text?: string;
  reason: string;
  confidence?: string;
}

export interface TranscriptCleanerChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TranscriptCleanerDocument {
  id: number;
  title: string;
  suggestedTitle: string | null;
  proposedTitle: string | null;
  titleNeedsInput: boolean;
  transcriptType: string | null;
  originalContent: string;
  cleanedContent: string | null;
  authorityRole: string | null;
  authorityConfidence: string | null;
  authorityEvidence: string | null;
  flags: TranscriptCleanerFlag[];
  chatHistory: TranscriptCleanerChatTurn[];
  status: string;
  sourceName: string | null;
  provenanceNote: string | null;
  filedSourceDocId: number | null;
  filedAt: string | null;
  errorMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TranscriptCleanerIntakeItem {
  content: string;
  title?: string;
  transcriptType?: string;
  sourceName?: string;
  proposedTitle?: string;
  provenanceNote?: string;
}

export function listTranscriptCleanerDocuments(status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return adminFetch<{ documents: TranscriptCleanerDocument[]; counts: Record<string, number> }>(
    `/admin/transcript-cleaner/documents${qs}`,
  );
}

export function getTranscriptCleanerDocument(id: number) {
  return adminFetch<TranscriptCleanerDocument>(`/admin/transcript-cleaner/documents/${id}`);
}

export function createTranscriptCleanerDocument(item: TranscriptCleanerIntakeItem) {
  return adminFetch<TranscriptCleanerDocument>("/admin/transcript-cleaner/documents", {
    method: "POST",
    body: JSON.stringify(item),
  });
}

export function createTranscriptCleanerDocumentsBatch(items: TranscriptCleanerIntakeItem[]) {
  return adminFetch<{ results: Array<{ ok: boolean; id?: number; sourceName?: string; error?: string }> }>(
    "/admin/transcript-cleaner/documents/batch",
    { method: "POST", body: JSON.stringify({ items }) },
  );
}

export function updateTranscriptCleanerDocument(
  id: number,
  patch: Partial<{
    title: string;
    transcriptType: string;
    cleanedContent: string;
    authorityRole: string;
    authorityConfidence: string;
    authorityEvidence: string;
    titleNeedsInput: boolean;
    flags: TranscriptCleanerFlag[];
    provenanceNote: string;
  }>,
) {
  return adminFetch<TranscriptCleanerDocument>(`/admin/transcript-cleaner/documents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteTranscriptCleanerDocument(id: number) {
  return adminFetch<{ ok: boolean }>(`/admin/transcript-cleaner/documents/${id}`, { method: "DELETE" });
}

export function cleanTranscriptCleanerDocument(id: number) {
  return adminFetch<TranscriptCleanerDocument>(`/admin/transcript-cleaner/documents/${id}/clean`, {
    method: "POST",
  });
}

export function cleanTranscriptCleanerBatch(ids: number[]) {
  return adminFetch<{ results: Array<{ id: number; ok: boolean; error?: string }> }>(
    "/admin/transcript-cleaner/clean-batch",
    { method: "POST", body: JSON.stringify({ ids }) },
  );
}

export function refineTranscriptCleanerDocument(id: number, instruction: string) {
  return adminFetch<TranscriptCleanerDocument>(`/admin/transcript-cleaner/documents/${id}/refine`, {
    method: "POST",
    body: JSON.stringify({ instruction }),
  });
}

export function fileTranscriptCleanerDocument(id: number) {
  return adminFetch<TranscriptCleanerDocument>(`/admin/transcript-cleaner/documents/${id}/file`, {
    method: "POST",
  });
}

export function fileTranscriptCleanerBatch(ids: number[]) {
  return adminFetch<{ results: Array<{ id: number; ok: boolean; error?: string; sourceDocId?: number }> }>(
    "/admin/transcript-cleaner/file-batch",
    { method: "POST", body: JSON.stringify({ ids }) },
  );
}
