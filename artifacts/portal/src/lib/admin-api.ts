const API_BASE = `${import.meta.env.BASE_URL}api`;

async function adminFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
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
