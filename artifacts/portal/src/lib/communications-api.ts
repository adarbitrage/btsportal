const BASE = import.meta.env.BASE_URL || "/";
const API_BASE = `${BASE}api/admin/communications`.replace(/\/\//g, "/");

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const commsApi = {
  listEmailTemplates: () => apiFetch("/email-templates"),
  getEmailTemplate: (id: number) => apiFetch(`/email-templates/${id}`),
  createEmailTemplate: (data: any) => apiFetch("/email-templates", { method: "POST", body: JSON.stringify(data) }),
  updateEmailTemplate: (id: number, data: any) => apiFetch(`/email-templates/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteEmailTemplate: (id: number) => apiFetch(`/email-templates/${id}`, { method: "DELETE" }),
  getTemplateVersions: (id: number) => apiFetch(`/email-templates/${id}/versions`),
  restoreTemplateVersion: (id: number, versionId: number) => apiFetch(`/email-templates/${id}/restore/${versionId}`, { method: "POST" }),
  previewEmailTemplate: (id: number, sampleData?: any) => apiFetch(`/email-templates/${id}/preview`, { method: "POST", body: JSON.stringify({ sampleData }) }),

  listSmsTemplates: () => apiFetch("/sms-templates"),
  createSmsTemplate: (data: any) => apiFetch("/sms-templates", { method: "POST", body: JSON.stringify(data) }),
  updateSmsTemplate: (id: number, data: any) => apiFetch(`/sms-templates/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSmsTemplate: (id: number) => apiFetch(`/sms-templates/${id}`, { method: "DELETE" }),

  listSequences: () => apiFetch("/sequences"),
  getSequence: (id: number) => apiFetch(`/sequences/${id}`),
  createSequence: (data: any) => apiFetch("/sequences", { method: "POST", body: JSON.stringify(data) }),
  updateSequence: (id: number, data: any) => apiFetch(`/sequences/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSequence: (id: number) => apiFetch(`/sequences/${id}`, { method: "DELETE" }),
  addStep: (seqId: number, data: any) => apiFetch(`/sequences/${seqId}/steps`, { method: "POST", body: JSON.stringify(data) }),
  updateStep: (seqId: number, stepId: number, data: any) => apiFetch(`/sequences/${seqId}/steps/${stepId}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteStep: (seqId: number, stepId: number) => apiFetch(`/sequences/${seqId}/steps/${stepId}`, { method: "DELETE" }),
  reorderSteps: (seqId: number, orders: any[]) => apiFetch(`/sequences/${seqId}/steps/reorder`, { method: "PATCH", body: JSON.stringify({ orders }) }),
  enrollUser: (seqId: number, userId: number) => apiFetch(`/sequences/${seqId}/enroll`, { method: "POST", body: JSON.stringify({ userId }) }),
  cancelEnrollment: (seqId: number, enrollmentId: number) => apiFetch(`/sequences/${seqId}/cancel-enrollment/${enrollmentId}`, { method: "POST" }),
  pauseSequence: (id: number) => apiFetch(`/sequences/${id}/pause`, { method: "PATCH" }),
  resumeSequence: (id: number) => apiFetch(`/sequences/${id}/resume`, { method: "PATCH" }),

  listBroadcasts: () => apiFetch("/broadcasts"),
  getBroadcast: (id: number) => apiFetch(`/broadcasts/${id}`),
  createBroadcast: (data: any) => apiFetch("/broadcasts", { method: "POST", body: JSON.stringify(data) }),
  updateBroadcast: (id: number, data: any) => apiFetch(`/broadcasts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteBroadcast: (id: number) => apiFetch(`/broadcasts/${id}`, { method: "DELETE" }),
  previewBroadcast: (id: number) => apiFetch(`/broadcasts/${id}/preview`, { method: "POST" }),
  sendBroadcast: (id: number, confirmed?: boolean) => apiFetch(`/broadcasts/${id}/send`, { method: "POST", body: JSON.stringify({ confirmed }) }),
  duplicateBroadcast: (id: number) => apiFetch(`/broadcasts/${id}/duplicate`, { method: "POST" }),

  getLog: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return apiFetch(`/log${qs}`);
  },
  getLogEntry: (id: number) => apiFetch(`/log/${id}`),
  getMemberHistory: (userId: number) => apiFetch(`/member/${userId}/history`),

  getBounces: () => apiFetch("/bounces"),
  unsuppressBounce: (id: number) => apiFetch(`/bounces/${id}/unsuppress`, { method: "PATCH" }),

  getAnalytics: (period?: string) => apiFetch(`/analytics${period ? `?period=${period}` : ""}`),
};
