import { authFetch } from "./auth";

// ── Types (mirror artifacts/api-server/src/routes/swipe-bank.ts) ─────────────

export type SwipeBankItem = {
  id: number;
  itemType: "banner" | "advertorial";
  subVerticalId: number;
  angleId: number | null;
  title: string;
  sourceLabel: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  isActive: boolean;
  hasThumbnail: boolean;
};

export type SwipeBankAngle = { id: number; name: string };

export type SwipeBankSubVertical = {
  id: number;
  name: string;
  angles: SwipeBankAngle[];
  items: SwipeBankItem[];
};

export type SwipeBankVertical = {
  id: number;
  name: string;
  subVerticals: SwipeBankSubVertical[];
};

export type SwipeBankDisclaimer = {
  topNote: string;
  heading: string;
  paragraphs: string[];
};

export type SwipeBankResponse = {
  verticals: SwipeBankVertical[];
  disclaimer: SwipeBankDisclaimer;
};

function extractApiError(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const err = (data as { error?: unknown }).error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return undefined;
}

async function bankFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await authFetch(path, options);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractApiError(data) ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const API_BASE = `${import.meta.env.BASE_URL}api`;

/**
 * Cookie-authenticated thumbnail URL — safe for <img> tags rendered right
 * after the listing authFetch (same pattern as driveFileContentUrl; does NOT
 * auto-refresh an expired token, so delayed loads use the blob helpers).
 */
export function swipeBankThumbnailUrl(itemId: number): string {
  return `${API_BASE}/swipe-bank/items/${itemId}/thumbnail`;
}

/** Full-size bytes via authFetch → blob (token-expiry-proof). */
export async function fetchSwipeBankItemBlob(itemId: number): Promise<Blob> {
  const res = await authFetch(`/swipe-bank/items/${itemId}/content`);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(extractApiError(data) ?? `Download failed (${res.status})`);
  }
  return res.blob();
}

/** Blob-based download with save-as (token-expiry-proof). */
export async function downloadSwipeBankItem(item: Pick<SwipeBankItem, "id" | "title">): Promise<void> {
  const blob = await fetchSwipeBankItemBlob(item.id);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = item.title;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function fetchSwipeBank(): Promise<SwipeBankResponse> {
  return bankFetch<SwipeBankResponse>("/swipe-bank");
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export type AdminSwipeBankOverview = {
  verticals: Array<{ id: number; name: string; sortOrder: number }>;
  subVerticals: Array<{ id: number; verticalId: number; name: string; sortOrder: number }>;
  angles: Array<{ id: number; subVerticalId: number; name: string; sortOrder: number }>;
  items: SwipeBankItem[];
  disclaimer: SwipeBankDisclaimer;
};

export function fetchAdminSwipeBankOverview(): Promise<AdminSwipeBankOverview> {
  return bankFetch<AdminSwipeBankOverview>("/admin/swipe-bank/overview");
}

export type TaxonomyLevel = "vertical" | "subVertical" | "angle";

export function createTaxonomyEntry(
  level: TaxonomyLevel,
  body: { name: string; sortOrder?: number; verticalId?: number; subVerticalId?: number },
): Promise<{ id: number }> {
  return bankFetch(`/admin/swipe-bank/taxonomy/${level}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateTaxonomyEntry(
  level: TaxonomyLevel,
  id: number,
  body: { name?: string; sortOrder?: number },
): Promise<{ ok: true }> {
  return bankFetch(`/admin/swipe-bank/taxonomy/${level}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteTaxonomyEntry(level: TaxonomyLevel, id: number): Promise<{ ok: true }> {
  return bankFetch(`/admin/swipe-bank/taxonomy/${level}/${id}`, { method: "DELETE" });
}

/** Presigned-PUT upload (same flow as the Creative Drive admin). */
export async function uploadSwipeBankAsset(file: File): Promise<string> {
  const { uploadURL, objectPath } = await bankFetch<{ uploadURL: string; objectPath: string }>(
    "/storage/uploads/request-url",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
      }),
    },
  );
  const put = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return objectPath;
}

export function registerSwipeBankItem(body: {
  itemType: "banner" | "advertorial";
  subVerticalId: number;
  angleId?: number | null;
  title: string;
  sourceLabel?: string;
  objectPath: string;
  sortOrder?: number;
}): Promise<{ item: SwipeBankItem }> {
  return bankFetch("/admin/swipe-bank/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateSwipeBankItem(
  id: number,
  body: Partial<{
    itemType: "banner" | "advertorial";
    subVerticalId: number;
    angleId: number | null;
    title: string;
    sourceLabel: string;
    sortOrder: number;
    isActive: boolean;
  }>,
): Promise<{ item: SwipeBankItem }> {
  return bankFetch(`/admin/swipe-bank/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function saveSwipeBankDisclaimer(
  disclaimer: SwipeBankDisclaimer,
): Promise<{ disclaimer: SwipeBankDisclaimer }> {
  return bankFetch("/admin/swipe-bank/disclaimer", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(disclaimer),
  });
}
