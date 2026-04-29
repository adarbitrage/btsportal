import { authFetch } from "./auth";

export type AuthRateLimitAlertConfig = {
  threshold: number;
  windowMinutes: number;
  dominantIpRatio: number;
};

export type AuthRateLimitAlertConfigStatus = {
  config: AuthRateLimitAlertConfig;
  sources: Record<keyof AuthRateLimitAlertConfig, "db" | "default">;
  defaults: AuthRateLimitAlertConfig;
  bounds: {
    threshold: { min: number; max: number };
    windowMinutes: { min: number; max: number };
    dominantIpRatio: { min: number; max: number };
  };
};

export type ChangeHistoryRetentionConfig = {
  emailRetentionDays: number;
  phoneRetentionDays: number;
};

export type ChangeHistoryRetentionConfigStatus = {
  config: ChangeHistoryRetentionConfig;
  sources: Record<keyof ChangeHistoryRetentionConfig, "db" | "default">;
  defaults: ChangeHistoryRetentionConfig;
  bounds: {
    emailRetentionDays: { min: number; max: number };
    phoneRetentionDays: { min: number; max: number };
  };
};

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
    outcome?: string;
    expand?: number;
    cursor?: string;
    direction?: "forward" | "backward";
    jumpTo?: string;
  }) {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.actionType) qs.set("actionType", params.actionType);
    if (params.entityType) qs.set("entityType", params.entityType);
    if (params.startDate) qs.set("startDate", params.startDate);
    if (params.endDate) qs.set("endDate", params.endDate);
    if (params.outcome) qs.set("outcome", params.outcome);
    if (params.expand != null) qs.set("expand", String(params.expand));
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.direction) qs.set("direction", params.direction);
    if (params.jumpTo) qs.set("jumpTo", params.jumpTo);
    const res = await authFetch(`/admin/audit-log?${qs.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch audit log");
    return res.json();
  },

  async exportAuditLog(
    format: string = "csv",
    filters: { actionType?: string; entityType?: string; startDate?: string; endDate?: string; outcome?: string } = {},
    onProgress?: (progress: { bytesReceived: number; rowsReceived: number | null }) => void,
  ): Promise<{ blob: Blob; bytesReceived: number; rowsReceived: number | null }> {
    const qs = new URLSearchParams();
    qs.set("format", format);
    if (filters.actionType) qs.set("actionType", filters.actionType);
    if (filters.entityType) qs.set("entityType", filters.entityType);
    if (filters.startDate) qs.set("startDate", filters.startDate);
    if (filters.endDate) qs.set("endDate", filters.endDate);
    if (filters.outcome) qs.set("outcome", filters.outcome);
    const res = await authFetch(`/admin/audit-log/export?${qs.toString()}`);
    if (!res.ok) throw new Error("Failed to export audit log");

    const isCsv = format === "csv";
    const contentType = res.headers.get("content-type") ?? (isCsv ? "text/csv" : "application/json");

    // The server streams the entire result set in chunks. Reading the body
    // through a ReadableStream lets us surface "still working, here's how much
    // has arrived" feedback during a multi-second download instead of the user
    // staring at a frozen button. Falls back to a plain `.blob()` read on
    // platforms (or test fakes) that don't expose a body stream — we still
    // return a final progress sample so callers can finalise their UI.
    const reader = res.body?.getReader?.();
    if (!reader) {
      const blob = await res.blob();
      const final = { bytesReceived: blob.size, rowsReceived: null as number | null };
      onProgress?.(final);
      return { blob, ...final };
    }

    const chunks: BlobPart[] = [];
    let bytesReceived = 0;
    let newlineCount = 0;
    let lastEmit = 0;
    const NEWLINE = 0x0a;
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

    // Throttle progress callbacks so we don't thrash React with hundreds of
    // setStates per second on a fast connection. Force-emit on completion so
    // the final byte/row count is always surfaced.
    const emit = (force: boolean) => {
      if (!onProgress) return;
      const t = now();
      if (!force && t - lastEmit < 150) return;
      lastEmit = t;
      const rowsReceived = isCsv ? Math.max(0, newlineCount - 1) : null;
      onProgress({ bytesReceived, rowsReceived });
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          chunks.push(value);
          bytesReceived += value.byteLength;
          // For CSV we approximate rows-so-far by counting newlines on the
          // raw bytes — fast, no decoding, and ~accurate for audit_log where
          // descriptions are short single-line strings. Descriptions that
          // contain embedded LFs (RFC 4180 wraps them in quotes) will
          // slightly over-count, but this value is only a "things are
          // happening" hint during the download; the final toast still
          // reports the authoritative row count from the read endpoint.
          // JSON exports are an array of objects; counting top-level commas
          // is brittle across chunk boundaries, so we leave row count null
          // and only show bytes for the JSON download.
          if (isCsv) {
            for (let i = 0; i < value.byteLength; i++) {
              if (value[i] === NEWLINE) newlineCount++;
            }
          }
          emit(false);
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* no-op */ }
    }

    const blob = new Blob(chunks, { type: contentType });
    const rowsReceived = isCsv ? Math.max(0, newlineCount - 1) : null;
    emit(true);
    return { blob, bytesReceived, rowsReceived };
  },

  async getMemberFull(id: number) {
    const res = await authFetch(`/admin/members/${id}/full`);
    if (!res.ok) throw new Error("Failed to fetch member details");
    return res.json();
  },

  async getTicketAuditHistory(ticketId: number) {
    const res = await authFetch(`/admin/tickets/${ticketId}/audit-history`);
    if (!res.ok) throw new Error("Failed to fetch ticket audit history");
    return res.json() as Promise<{
      auditHistory: Array<{
        id: number;
        actionType: string;
        entityType: string;
        entityId: string | null;
        actorId: number | null;
        actorEmail: string | null;
        description: string;
        createdAt: string;
      }>;
      limit: number;
    }>;
  },

  async getMemberEmailAttempts(
    userId: number,
    options: { limit?: number; offset?: number } = {},
  ) {
    const qs = new URLSearchParams();
    if (typeof options.limit === "number") qs.set("limit", String(options.limit));
    if (typeof options.offset === "number") qs.set("offset", String(options.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await authFetch(`/admin/members/${userId}/email-attempts${suffix}`);
    if (!res.ok) throw new Error("Failed to fetch email-change attempts");
    return res.json() as Promise<{
      attempts: Array<{
        id: number;
        newEmail: string | null;
        requestedAt: string;
        expiresAt: string | null;
        confirmedAt: string | null;
        // Populated when an admin cancelled this attempt via
        // /admin/members/:id/cancel-email-change. Admin-cancelled rows have a
        // longer (1-year) retention than the 90-day audit window, so older
        // pages of attempts may still include them for support investigation.
        cancelledAt: string | null;
        cancelledByAdminId: number | null;
        cancelledByAdminName: string | null;
        cancelledByAdminEmail: string | null;
        status:
          | "pending"
          | "confirmed"
          | "expired"
          | "abandoned"
          | "cancelled_by_admin";
      }>;
      total: number;
      offset: number;
      limit: number;
      hasMore: boolean;
    }>;
  },

  async getMemberEmailAttemptDetail(userId: number, attemptId: number) {
    const res = await authFetch(
      `/admin/members/${userId}/email-attempts/${attemptId}`,
    );
    if (!res.ok) throw new Error("Failed to fetch email-change attempt detail");
    return res.json() as Promise<{
      attempt: {
        id: number;
        newEmail: string | null;
        requestedAt: string;
        expiresAt: string | null;
        confirmedAt: string | null;
        cancelledAt: string | null;
        cancelledByAdminId: number | null;
        cancelledByAdminName: string | null;
        cancelledByAdminEmail: string | null;
        status:
          | "pending"
          | "confirmed"
          | "expired"
          | "abandoned"
          | "cancelled_by_admin";
      };
      auditEntries: Array<{
        id: number;
        actorId: number | null;
        actorEmail: string | null;
        actionType: string;
        entityType: string;
        entityId: string | null;
        description: string;
        changeDiff: unknown;
        ipAddress: string | null;
        userAgent: string | null;
        metadata: unknown;
        createdAt: string;
      }>;
      nextAttempt: {
        id: number;
        newEmail: string | null;
        requestedAt: string;
        expiresAt: string | null;
        confirmedAt: string | null;
        cancelledAt: string | null;
        status:
          | "pending"
          | "confirmed"
          | "expired"
          | "abandoned"
          | "cancelled_by_admin";
      } | null;
      subsequentConfirmation: {
        id: number;
        oldEmail: string;
        newEmail: string;
        changedAt: string;
      } | null;
    }>;
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

  async cancelMemberEmailChange(userId: number) {
    const res = await authFetch(`/admin/members/${userId}/cancel-email-change`, { method: "POST" });
    if (!res.ok) {
      let message = "Failed to cancel pending email change";
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {}
      throw new Error(message);
    }
    return res.json();
  },

  async unlockMember(userId: number) {
    const res = await authFetch(`/admin/members/${userId}/unlock`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || "Failed to unlock account");
    }
    return res.json();
  },

  async startImpersonation(userId: number) {
    const res = await authFetch(`/admin/impersonate/${userId}`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to start impersonation");
    return res.json();
  },

  async updateMemberRole(userId: number, role: string) {
    const res = await authFetch(`/admin/members/${userId}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || "Failed to update role");
    }
    return res.json() as Promise<{ id: number; role: string; changed: boolean }>;
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

  async getQueueFallbackAlertEvents(
    limit: number = 20,
    filters?: {
      outcome?: "sent" | "failed" | "throttled" | "skipped" | null;
      deliveryChannel?: "pagerduty" | "email" | "slack" | null;
    },
  ) {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (filters?.outcome) params.set("outcome", filters.outcome);
    if (filters?.deliveryChannel) params.set("deliveryChannel", filters.deliveryChannel);
    const res = await authFetch(`/admin/system/queue-fallback-alert-events?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch queue fallback alert events");
    return res.json();
  },

  async getQueueFallbackAlerterHealth() {
    const res = await authFetch("/admin/system/queue-fallback-alerter-health");
    if (!res.ok) throw new Error("Failed to fetch on-call alerter health");
    return res.json() as Promise<{
      alertingSource: "redis" | "memory";
      throttleSource: "redis" | "memory";
      channels: Array<{
        channel: "email" | "sms";
        alerting: boolean;
        lastFireAt: string | null;
        lastClearAt: string | null;
      }>;
      throttles: Array<{
        queueChannel: "email" | "sms";
        deliveryChannel: "pagerduty" | "email" | "slack";
        kind: "fire" | "clear";
        ttlMs: number;
        expiresAt: string;
      }>;
      serverTime: string;
    }>;
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

  async getOnCallDestinations() {
    const res = await authFetch("/admin/oncall-destinations");
    if (!res.ok) throw new Error("Failed to fetch on-call destinations");
    return res.json() as Promise<{
      pagerdutyConfigured: boolean;
      pagerdutySource: "db" | "env" | null;
      opsAlertEmail: string | null;
      opsAlertEmailSource: "db" | "env" | null;
      slackConfigured: boolean;
      slackSource: "db" | "env" | null;
    }>;
  },

  async updateOnCallDestinations(payload: {
    pagerdutyIntegrationKey?: string | null;
    opsAlertEmail?: string | null;
    opsAlertSlackWebhookUrl?: string | null;
  }) {
    const res = await authFetch("/admin/oncall-destinations", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to update on-call destinations");
    }
    return res.json() as Promise<{
      pagerdutyConfigured: boolean;
      pagerdutySource: "db" | "env" | null;
      opsAlertEmail: string | null;
      opsAlertEmailSource: "db" | "env" | null;
      slackConfigured: boolean;
      slackSource: "db" | "env" | null;
      // Per-field reachability probe results from the save flow. Only the
      // fields that were updated to a non-null value appear here, so a save
      // that just clears a destination returns an empty `probes` object.
      probes: Partial<Record<
        "pagerdutyIntegrationKey" | "opsAlertEmail" | "opsAlertSlackWebhookUrl",
        { ok: boolean; skipped?: boolean; reason?: string }
      >>;
    }>;
  },

  async sendOnCallTestAlert() {
    const res = await authFetch("/admin/oncall-destinations/test", { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to send test alert");
    }
    return res.json() as Promise<{
      results: Array<{ channel: string; ok: boolean; skipped: boolean; reason?: string }>;
    }>;
  },

  async getOnCallDestinationsHistory(limit?: number) {
    const qs = new URLSearchParams();
    if (limit) qs.set("limit", String(limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await authFetch(`/admin/oncall-destinations/history${suffix}`);
    if (!res.ok) throw new Error("Failed to fetch on-call destinations history");
    return res.json() as Promise<{
      events: Array<{
        id: number;
        createdAt: string;
        actionType: "update_setting" | "send_test_alert" | string;
        actorId: number | null;
        actorEmail: string | null;
        actorName: string | null;
        description: string;
        changedFields: Array<"pagerdutyIntegrationKey" | "opsAlertEmail" | "opsAlertSlackWebhookUrl">;
        testResults: Array<{
          channel: "pagerduty" | "email" | "slack";
          ok: boolean;
          skipped: boolean;
          reason: string | null;
        }>;
      }>;
      limit: number;
    }>;
  },

  async getAuthRateLimitAlertConfig() {
    const res = await authFetch("/admin/auth-rate-limit-alert-config");
    if (!res.ok) throw new Error("Failed to fetch auth rate-limit alert config");
    return res.json() as Promise<AuthRateLimitAlertConfigStatus>;
  },

  // A `null` value means "reset this field to its default" — the underlying
  // row is deleted server-side so per-field provenance flips back to
  // "default". Omit a field entirely to leave it untouched.
  async updateAuthRateLimitAlertConfig(payload: {
    threshold?: number | null;
    windowMinutes?: number | null;
    dominantIpRatio?: number | null;
  }) {
    const res = await authFetch("/admin/auth-rate-limit-alert-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const fieldErrors = Array.isArray(body.fieldErrors)
        ? (body.fieldErrors as Array<{ field: string; message: string }>)
        : [];
      const detail =
        fieldErrors.length > 0
          ? fieldErrors.map((e) => `${e.field}: ${e.message}`).join("; ")
          : body.error || "Failed to update auth rate-limit alert config";
      const err = new Error(detail) as Error & {
        fieldErrors?: Array<{ field: string; message: string }>;
      };
      if (fieldErrors.length > 0) err.fieldErrors = fieldErrors;
      throw err;
    }
    return res.json() as Promise<AuthRateLimitAlertConfigStatus & { changedFields: Array<"threshold" | "windowMinutes" | "dominantIpRatio"> }>;
  },

  async getChangeHistoryRetentionConfig() {
    const res = await authFetch("/admin/change-history-retention-config");
    if (!res.ok) throw new Error("Failed to fetch change-history retention config");
    return res.json() as Promise<ChangeHistoryRetentionConfigStatus>;
  },

  // A `null` value means "reset this field to its default" — the underlying
  // row is deleted server-side so per-field provenance flips back to
  // "default". Omit a field entirely to leave it untouched.
  async updateChangeHistoryRetentionConfig(payload: {
    emailRetentionDays?: number | null;
    phoneRetentionDays?: number | null;
  }) {
    const res = await authFetch("/admin/change-history-retention-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const fieldErrors = Array.isArray(body.fieldErrors)
        ? (body.fieldErrors as Array<{ field: string; message: string }>)
        : [];
      const detail =
        fieldErrors.length > 0
          ? fieldErrors.map((e) => `${e.field}: ${e.message}`).join("; ")
          : body.error || "Failed to update change-history retention config";
      const err = new Error(detail) as Error & {
        fieldErrors?: Array<{ field: string; message: string }>;
      };
      if (fieldErrors.length > 0) err.fieldErrors = fieldErrors;
      throw err;
    }
    return res.json() as Promise<
      ChangeHistoryRetentionConfigStatus & {
        changedFields: Array<"emailRetentionDays" | "phoneRetentionDays">;
      }
    >;
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
