import { authFetch } from "./auth";

export const adminPanelApi = {
  async getDashboardKpis() {
    const res = await authFetch("/admin/dashboard/kpis");
    if (!res.ok) throw new Error("Failed to fetch KPIs");
    return res.json();
  },

  async getActivityChart() {
    const res = await authFetch("/admin/dashboard/activity-chart");
    if (!res.ok) throw new Error("Failed to fetch activity chart");
    return res.json();
  },

  async getNeedsAttention() {
    const res = await authFetch("/admin/dashboard/needs-attention");
    if (!res.ok) throw new Error("Failed to fetch alerts");
    return res.json();
  },

  async getRecentActivity() {
    const res = await authFetch("/admin/dashboard/recent-activity");
    if (!res.ok) throw new Error("Failed to fetch recent activity");
    return res.json();
  },

  async search(q: string) {
    const res = await authFetch(`/admin/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error("Search failed");
    return res.json();
  },

  async getAuditLog(params: {
    page?: number;
    limit?: number;
    actionType?: string;
    entityType?: string;
    startDate?: string;
    endDate?: string;
    expand?: number;
    cursor?: string;
    direction?: "forward" | "backward";
  }) {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.actionType) qs.set("actionType", params.actionType);
    if (params.entityType) qs.set("entityType", params.entityType);
    if (params.startDate) qs.set("startDate", params.startDate);
    if (params.endDate) qs.set("endDate", params.endDate);
    if (params.expand != null) qs.set("expand", String(params.expand));
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.direction) qs.set("direction", params.direction);
    const res = await authFetch(`/admin/audit-log?${qs.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch audit log");
    return res.json();
  },

  async exportAuditLog(format: string = "csv", filters: { actionType?: string; entityType?: string; startDate?: string; endDate?: string } = {}) {
    const qs = new URLSearchParams();
    qs.set("format", format);
    if (filters.actionType) qs.set("actionType", filters.actionType);
    if (filters.entityType) qs.set("entityType", filters.entityType);
    if (filters.startDate) qs.set("startDate", filters.startDate);
    if (filters.endDate) qs.set("endDate", filters.endDate);
    const res = await authFetch(`/admin/audit-log/export?${qs.toString()}`);
    if (!res.ok) throw new Error("Failed to export audit log");
    return res;
  },

  async getMemberFull(id: number) {
    const res = await authFetch(`/admin/members/${id}/full`);
    if (!res.ok) throw new Error("Failed to fetch member details");
    return res.json();
  },

  async addMemberNote(userId: number, content: string) {
    const res = await authFetch(`/admin/members/${userId}/notes`, { method: "POST", body: JSON.stringify({ content }) });
    if (!res.ok) throw new Error("Failed to add note");
    return res.json();
  },

  async grantProduct(userId: number, productId: number, expiresAt?: string) {
    const res = await authFetch(`/admin/members/${userId}/grant-product`, { method: "POST", body: JSON.stringify({ productId, expiresAt }) });
    if (!res.ok) throw new Error("Failed to grant product");
    return res.json();
  },

  async listProducts() {
    const res = await authFetch(`/admin/products`);
    if (!res.ok) throw new Error("Failed to fetch products");
    return res.json();
  },

  async revokeProduct(userId: number, userProductId: number) {
    const res = await authFetch(`/admin/members/${userId}/revoke-product`, { method: "POST", body: JSON.stringify({ userProductId }) });
    if (!res.ok) throw new Error("Failed to revoke product");
    return res.json();
  },

  async startImpersonation(userId: number) {
    const res = await authFetch(`/admin/impersonate/${userId}`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to start impersonation");
    return res.json();
  },

  async getSystemHealth() {
    const res = await authFetch("/admin/system/health");
    if (!res.ok) throw new Error("Failed to fetch system health");
    return res.json();
  },

  async getQueueFallbackEvents(limit: number = 50) {
    const res = await authFetch(`/admin/system/queue-fallback-events?limit=${limit}`);
    if (!res.ok) throw new Error("Failed to fetch queue fallback events");
    return res.json();
  },

  async getNotifications() {
    const res = await authFetch("/admin/notifications");
    if (!res.ok) throw new Error("Failed to fetch notifications");
    return res.json();
  },

  async getSettings() {
    const res = await authFetch("/admin/settings");
    if (!res.ok) throw new Error("Failed to fetch settings");
    return res.json();
  },

  async updateSetting(key: string, value: any, category?: string, description?: string) {
    const res = await authFetch(`/admin/settings/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value, category, description }) });
    if (!res.ok) throw new Error("Failed to update setting");
    return res.json();
  },

  async getMembers(params: { page?: number; limit?: number; search?: string; role?: string }) {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.search) qs.set("search", params.search);
    if (params.role) qs.set("role", params.role);
    const res = await authFetch(`/admin/members?${qs.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch members");
    return res.json();
  },

  async exportData(type: string, format: string = "csv", startDate?: string, endDate?: string) {
    const qs = new URLSearchParams({ format });
    if (startDate) qs.set("startDate", startDate);
    if (endDate) qs.set("endDate", endDate);
    const res = await authFetch(`/admin/export/${type}?${qs.toString()}`);
    if (!res.ok) throw new Error("Failed to export data");
    return res;
  },
};
