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
import {
  getConnectedDriveAccessTokens,
  hasActiveOAuthConnections,
} from "./coach-google-connections";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function tryParseJson(value: string): unknown | undefined {
  if (!value.startsWith("{")) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function tryParseBase64Json(value: string): unknown | undefined {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (!decoded.trim().startsWith("{")) return undefined;
    return JSON.parse(decoded);
  } catch {
    return undefined;
  }
}

function loadServiceAccount(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) return null;
  // Accept the key either as raw JSON pasted directly into the secret, or as
  // base64-encoded JSON. Try raw JSON first (the common case when a user pastes
  // the downloaded key file), then fall back to base64-decoding. This avoids a
  // silent no-op when the value isn't base64.
  const trimmed = raw.trim();
  let json: unknown;
  const parsed = tryParseJson(trimmed) ?? tryParseBase64Json(trimmed);
  if (parsed === undefined) {
    console.error(
      "[GoogleDrive] GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not valid JSON or base64-encoded JSON; ignoring",
    );
    return null;
  }
  json = parsed;
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

// Whether the service-account topology is configured. Used as the synchronous
// part of the "is any Drive source connected?" check.
export function isDriveConfigured(): boolean {
  return loadServiceAccount() !== null;
}

// Whether ANY Drive source is connected — either the service account OR at least
// one per-coach OAuth connection. The ingest job uses this to skip entirely
// (no-op) when nothing is connected yet.
export async function hasAnyDriveSource(): Promise<boolean> {
  if (isDriveConfigured()) return true;
  return hasActiveOAuthConnections();
}

async function mintServiceAccountToken(
  sa: ServiceAccountKey,
  subject: string | undefined,
): Promise<string> {
  const client = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: [DRIVE_READONLY_SCOPE],
    subject,
  });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Drive auth returned no access token");
  return token;
}

async function listFilesWithToken(
  token: string,
  query: string,
): Promise<DriveFileMeta[]> {
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
  // Escape single quotes for the Drive query string literal.
  const safeName = args.nameContains.replace(/'/g, "\\'");
  const query = [
    `name contains '${safeName}'`,
    `createdTime >= '${args.createdAfter.toISOString()}'`,
    `createdTime <= '${args.createdBefore.toISOString()}'`,
    "trashed = false",
  ].join(" and ");

  const byId = new Map<string, DriveFileMeta>();
  const addFiles = (files: DriveFileMeta[]) => {
    for (const f of files) {
      if (!byId.has(f.id)) byId.set(f.id, f);
    }
  };

  // 1. Service-account topology (central Drive or domain-wide delegation).
  const sa = loadServiceAccount();
  if (sa) {
    for (const subject of impersonationSubjects()) {
      try {
        const token = await mintServiceAccountToken(sa, subject);
        addFiles(await listFilesWithToken(token, query));
      } catch (err) {
        console.error(
          `[GoogleDrive] service-account search failed${subject ? ` for ${subject}` : ""}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // 2. Per-coach OAuth connections. Each connected coach's Drive is searched
  // with a freshly-minted access token; a single dead token never blocks the
  // others (getConnectedDriveAccessTokens skips/marks them).
  const oauthTokens = await getConnectedDriveAccessTokens();
  for (const token of oauthTokens) {
    try {
      addFiles(await listFilesWithToken(token, query));
    } catch (err) {
      console.error(
        "[GoogleDrive] OAuth-connection search failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return [...byId.values()];
}
