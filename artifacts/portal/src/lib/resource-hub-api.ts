import { authFetch } from "./auth";

// ── Types ─────────────────────────────────────────────────────────────────────

export type HubSection = "foundations" | "working_documents" | "templates_assets";

export type HubItem = {
  id: number;
  slug: string;
  section: HubSection;
  kind: "file" | "external" | "group";
  fileId: number | null;
  fileName: string | null;
  externalUrl: string | null;
  parentId: number | null;
  subGroupLabel: string | null;
  displayTitle: string;
  blurb: string;
  noteLine: string | null;
  sortOrder: number;
  children?: HubItem[];
};

export type HubResponse = {
  sections: Record<HubSection, HubItem[]>;
  glossary: Array<{ term: string; definition: string }>;
};

export type GlossaryTerm = {
  id: number;
  term: string;
  definition: string;
  status: "draft" | "approved" | "rejected";
  lastGeneratedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ── Error helper (tolerates both API error shapes) ───────────────────────────

function extractApiError(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const err = (data as { error?: unknown }).error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return undefined;
}

async function hubFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await authFetch(path, options);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractApiError(data) ?? `Request failed (${res.status})`);
  }
  return data as T;
}

// ── Member ────────────────────────────────────────────────────────────────────

export function fetchResourceHub(): Promise<HubResponse> {
  return hubFetch<HubResponse>("/resource-hub");
}

// ── Admin: curation ───────────────────────────────────────────────────────────

export function fetchHubItems(): Promise<{ items: HubItem[] }> {
  return hubFetch<{ items: HubItem[] }>("/admin/resource-hub/items");
}

export type HubItemInput = {
  section?: HubSection;
  kind?: "file" | "external" | "group";
  fileId?: number | null;
  externalUrl?: string | null;
  parentId?: number | null;
  subGroupLabel?: string | null;
  displayTitle?: string;
  blurb?: string;
  noteLine?: string | null;
  sortOrder?: number;
};

export function createHubItem(input: HubItemInput) {
  return hubFetch<{ item: HubItem }>("/admin/resource-hub/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateHubItem(id: number, input: HubItemInput) {
  return hubFetch<{ item: HubItem }>(`/admin/resource-hub/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteHubItem(id: number) {
  return hubFetch<{ ok: boolean }>(`/admin/resource-hub/items/${id}`, {
    method: "DELETE",
  });
}

// ── Admin: glossary ───────────────────────────────────────────────────────────

export function fetchGlossaryTerms(): Promise<{ terms: GlossaryTerm[] }> {
  return hubFetch<{ terms: GlossaryTerm[] }>("/admin/resource-hub/glossary");
}

export function addGlossaryTerm(term: string, definition = "") {
  return hubFetch<{ term: GlossaryTerm }>("/admin/resource-hub/glossary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term, definition }),
  });
}

export function updateGlossaryTerm(
  id: number,
  updates: { definition?: string; status?: GlossaryTerm["status"] },
) {
  return hubFetch<{ term: GlossaryTerm }>(`/admin/resource-hub/glossary/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export function deleteGlossaryTerm(id: number) {
  return hubFetch<{ ok: boolean }>(`/admin/resource-hub/glossary/${id}`, {
    method: "DELETE",
  });
}

export function regenerateGlossaryTerm(id: number) {
  return hubFetch<{ term: GlossaryTerm }>(`/admin/resource-hub/glossary/${id}/regenerate`, {
    method: "POST",
  });
}

export function generateGlossaryBatch() {
  return hubFetch<{ generated: number; remaining: number }>(
    "/admin/resource-hub/glossary/generate",
    { method: "POST" },
  );
}
