import { authFetch } from "./auth";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DriveFolder = {
  id: number;
  name: string;
  parentId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type DriveFile = {
  id: number;
  folderId: number | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

export type DriveBrowseResponse = {
  folderId: number | null;
  breadcrumb: Array<{ id: number; name: string }>;
  folders: DriveFolder[];
  files: DriveFile[];
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

async function driveFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await authFetch(path, options);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractApiError(data) ?? `Request failed (${res.status})`);
  }
  return data as T;
}

// ── URLs (cookie-authenticated, safe for <img>/<iframe> src) ─────────────────
// NOTE: these direct URLs authenticate via the short-lived access-token cookie
// and do NOT auto-refresh on expiry. They are safe only for elements that load
// immediately after an authFetch call (e.g. grid thumbnails rendered right
// after browse). For user-initiated actions that can happen after idling
// (downloads, opening a preview), use fetchDriveFileBlob/downloadDriveFile
// below — those ride authFetch's 401→refresh→retry path.

const API_BASE = `${import.meta.env.BASE_URL}api`;

export function driveFileContentUrl(fileId: number): string {
  return `${API_BASE}/creative-drive/files/${fileId}/content`;
}

/**
 * Fetch a drive file's bytes through authFetch so an expired access token is
 * transparently refreshed instead of failing (the "file wasn't available on
 * site" browser error on plain <a href> downloads).
 */
export async function fetchDriveFileBlob(fileId: number): Promise<Blob> {
  const res = await authFetch(`/creative-drive/files/${fileId}/content`);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(extractApiError(data) ?? `Download failed (${res.status})`);
  }
  return res.blob();
}

/** Download a drive file via authenticated fetch, then trigger a save-as. */
export async function downloadDriveFile(file: Pick<DriveFile, "id" | "name">): Promise<void> {
  const blob = await fetchDriveFileBlob(file.id);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke on the next tick so the click has consumed the URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// ── Member ────────────────────────────────────────────────────────────────────

export function browseDrive(folderId: number | null): Promise<DriveBrowseResponse> {
  const qs = folderId === null ? "" : `?folderId=${folderId}`;
  return driveFetch<DriveBrowseResponse>(`/creative-drive/browse${qs}`);
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export function listAllDriveFolders() {
  return driveFetch<{ folders: DriveFolder[] }>("/admin/creative-drive/folders");
}

export function createDriveFolder(name: string, parentId: number | null) {
  return driveFetch<{ folder: DriveFolder }>("/admin/creative-drive/folders", {
    method: "POST",
    body: JSON.stringify({ name, parentId }),
  });
}

export function updateDriveFolder(
  id: number,
  updates: { name?: string; parentId?: number | null },
) {
  return driveFetch<{ folder: DriveFolder }>(`/admin/creative-drive/folders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function deleteDriveFolder(id: number) {
  return driveFetch<{ ok: true }>(`/admin/creative-drive/folders/${id}`, {
    method: "DELETE",
  });
}

export function updateDriveFile(
  id: number,
  updates: { name?: string; folderId?: number | null },
) {
  return driveFetch<{ file: DriveFile }>(`/admin/creative-drive/files/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function deleteDriveFile(id: number) {
  return driveFetch<{ ok: true }>(`/admin/creative-drive/files/${id}`, {
    method: "DELETE",
  });
}

/**
 * Full upload flow for one file:
 *  1. POST /storage/uploads/request-url → presigned PUT URL + normalized path
 *  2. PUT the raw bytes directly to the presigned URL
 *  3. POST /admin/creative-drive/files to register the file in the drive
 */
export async function uploadDriveFile(
  file: File,
  folderId: number | null,
): Promise<DriveFile> {
  const { uploadURL, objectPath } = await driveFetch<{
    uploadURL: string;
    objectPath: string;
  }>("/storage/uploads/request-url", {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type || "application/octet-stream",
    }),
  });

  const putRes = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!putRes.ok) {
    throw new Error(`Upload failed for ${file.name} (${putRes.status})`);
  }

  const { file: created } = await driveFetch<{ file: DriveFile }>(
    "/admin/creative-drive/files",
    {
      method: "POST",
      body: JSON.stringify({
        name: file.name,
        folderId,
        objectPath,
        mimeType: file.type || "application/octet-stream",
      }),
    },
  );
  return created;
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function isPdfMime(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

export function isTextMime(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml"
  );
}

export function isPreviewableMime(mimeType: string): boolean {
  return isImageMime(mimeType) || isPdfMime(mimeType) || isTextMime(mimeType);
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
