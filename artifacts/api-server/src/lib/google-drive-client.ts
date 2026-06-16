// Thin, pluggable Google Drive read adapter for the 1-on-1 coaching recording
// ingest. Topology-agnostic: it works whether Meet recordings land in one
// central Drive (single service account) or in each coach's Drive (one service
// account with domain-wide delegation, impersonating each coach in turn).
//
// CONFIGURATION (all optional — absent config means "not connected", and the
// ingest degrades gracefully to a no-op so booking fields simply stay empty):
//   GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON  base64-encoded service-account key JSON
//   GOOGLE_DRIVE_IMPERSONATE_SUBJECTS  comma-separated Workspace emails to
//                                      impersonate via domain-wide delegation
//                                      (per-coach Drives). Omit for a single
//                                      central Drive owned by the SA itself.
//   GOOGLE_DRIVE_SHARED_DRIVE_ID       optional shared-drive id to search.
//
// Only the read-only Drive scope is requested. Never cache a client across
// requests — tokens expire; mint a fresh JWT per search batch.

import { JWT } from "google-auth-library";

const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";

import type { DriveFileMeta } from "./coaching-recording-matcher";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function loadServiceAccount(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) return null;
  let json: unknown;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    json = JSON.parse(decoded);
  } catch {
    console.error(
      "[GoogleDrive] GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not valid base64-encoded JSON; ignoring",
    );
    return null;
  }
  const key = json as Partial<ServiceAccountKey>;
  if (!key.client_email || !key.private_key) {
    console.error(
      "[GoogleDrive] service-account JSON missing client_email/private_key; ignoring",
    );
    return null;
  }
  return { client_email: key.client_email, private_key: key.private_key };
}

// The set of "Drives" to search. Empty subjects => search the service account's
// own Drive (central topology). Non-empty => one impersonated subject per coach
// Drive (per-coach topology). The same code covers both.
function impersonationSubjects(): (string | undefined)[] {
  const raw = process.env.GOOGLE_DRIVE_IMPERSONATE_SUBJECTS;
  if (!raw || !raw.trim()) return [undefined];
  const subjects = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return subjects.length > 0 ? subjects : [undefined];
}

// Whether any Google Drive credentials are configured. Used by the ingest job
// to skip entirely (no-op) when the integration has not been connected yet.
export function isDriveConfigured(): boolean {
  return loadServiceAccount() !== null;
}

async function listFilesForSubject(
  sa: ServiceAccountKey,
  subject: string | undefined,
  query: string,
): Promise<DriveFileMeta[]> {
  const client = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: [DRIVE_READONLY_SCOPE],
    subject,
  });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Drive auth returned no access token");

  const sharedDriveId = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID?.trim();
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,mimeType,createdTime,webViewLink)",
    pageSize: "100",
    orderBy: "createdTime desc",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  if (sharedDriveId) {
    params.set("corpora", "drive");
    params.set("driveId", sharedDriveId);
  }

  const res = await fetch(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive files.list ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { files?: DriveFileMeta[] };
  return data.files ?? [];
}

// Search every configured Drive for files created in [createdAfter, createdBefore]
// whose name contains `nameContains`. De-duplicates by file id across subjects.
// Returns [] (never throws) when Drive is not configured.
export async function searchDriveFiles(args: {
  nameContains: string;
  createdAfter: Date;
  createdBefore: Date;
}): Promise<DriveFileMeta[]> {
  const sa = loadServiceAccount();
  if (!sa) return [];

  // Escape single quotes for the Drive query string literal.
  const safeName = args.nameContains.replace(/'/g, "\\'");
  const query = [
    `name contains '${safeName}'`,
    `createdTime >= '${args.createdAfter.toISOString()}'`,
    `createdTime <= '${args.createdBefore.toISOString()}'`,
    "trashed = false",
  ].join(" and ");

  const byId = new Map<string, DriveFileMeta>();
  for (const subject of impersonationSubjects()) {
    const files = await listFilesForSubject(sa, subject, query);
    for (const f of files) {
      if (!byId.has(f.id)) byId.set(f.id, f);
    }
  }
  return [...byId.values()];
}
