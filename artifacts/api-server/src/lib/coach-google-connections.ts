import { db, coachGoogleConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "./app-secrets-crypto";
import {
  isGoogleOAuthConfigured,
  refreshAccessToken,
} from "./google-oauth";

export interface CoachGoogleConnectionStatus {
  connected: boolean;
  email: string | null;
  status: string | null;
  connectedAt: string | null;
}

export async function getConnectionStatus(
  userId: number,
): Promise<CoachGoogleConnectionStatus> {
  const [row] = await db
    .select({
      email: coachGoogleConnectionsTable.googleEmail,
      status: coachGoogleConnectionsTable.status,
      connectedAt: coachGoogleConnectionsTable.connectedAt,
    })
    .from(coachGoogleConnectionsTable)
    .where(eq(coachGoogleConnectionsTable.userId, userId))
    .limit(1);

  if (!row) {
    return { connected: false, email: null, status: null, connectedAt: null };
  }
  return {
    connected: row.status === "active",
    email: row.email,
    status: row.status,
    connectedAt: row.connectedAt ? row.connectedAt.toISOString() : null,
  };
}

/**
 * Upsert the per-user connection. When Google omits a refresh token (it only
 * re-issues one on first consent), we keep any existing token so a re-consent
 * without `prompt=consent` does not wipe a working connection.
 */
export async function upsertConnection(args: {
  userId: number;
  email: string;
  refreshToken: string | null;
  scope: string | null;
}): Promise<void> {
  const { userId, email, refreshToken, scope } = args;

  if (refreshToken) {
    await db
      .insert(coachGoogleConnectionsTable)
      .values({
        userId,
        googleEmail: email,
        refreshTokenEnc: encryptSecret(refreshToken),
        scope,
        status: "active",
        lastError: null,
      })
      .onConflictDoUpdate({
        target: coachGoogleConnectionsTable.userId,
        set: {
          googleEmail: email,
          refreshTokenEnc: encryptSecret(refreshToken),
          scope,
          status: "active",
          lastError: null,
        },
      });
    return;
  }

  // No new refresh token — only update display fields / reactivate an existing
  // row. If there is no existing row we cannot persist a usable connection.
  const [existing] = await db
    .select({ id: coachGoogleConnectionsTable.id })
    .from(coachGoogleConnectionsTable)
    .where(eq(coachGoogleConnectionsTable.userId, userId))
    .limit(1);
  if (!existing) {
    throw new Error(
      "Google did not return a refresh token. Remove the app's access in your Google account and reconnect.",
    );
  }
  await db
    .update(coachGoogleConnectionsTable)
    .set({ googleEmail: email, scope, status: "active", lastError: null })
    .where(eq(coachGoogleConnectionsTable.userId, userId));
}

export async function deleteConnection(userId: number): Promise<void> {
  await db
    .delete(coachGoogleConnectionsTable)
    .where(eq(coachGoogleConnectionsTable.userId, userId));
}

async function countActiveConnections(): Promise<number> {
  const rows = await db
    .select({ id: coachGoogleConnectionsTable.id })
    .from(coachGoogleConnectionsTable)
    .where(eq(coachGoogleConnectionsTable.status, "active"));
  return rows.length;
}

/** True when at least one coach has a live OAuth Drive connection. */
export async function hasActiveOAuthConnections(): Promise<boolean> {
  if (!isGoogleOAuthConfigured()) return false;
  return (await countActiveConnections()) > 0;
}

/**
 * Mint a fresh access token for every active OAuth connection. Connections whose
 * refresh token has been revoked are marked dead (status=error) and skipped so a
 * single bad token never blocks ingest from the other coaches' Drives.
 */
export async function getConnectedDriveAccessTokens(): Promise<string[]> {
  if (!isGoogleOAuthConfigured()) return [];

  const rows = await db
    .select({
      id: coachGoogleConnectionsTable.id,
      userId: coachGoogleConnectionsTable.userId,
      refreshTokenEnc: coachGoogleConnectionsTable.refreshTokenEnc,
    })
    .from(coachGoogleConnectionsTable)
    .where(eq(coachGoogleConnectionsTable.status, "active"));

  const tokens: string[] = [];
  for (const row of rows) {
    try {
      const refreshToken = decryptSecret(row.refreshTokenEnc);
      const accessToken = await refreshAccessToken(refreshToken);
      tokens.push(accessToken);
      await db
        .update(coachGoogleConnectionsTable)
        .set({ lastSyncAt: new Date() })
        .where(eq(coachGoogleConnectionsTable.id, row.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[CoachGoogle] Failed to refresh access token for user ${row.userId}: ${message}`,
      );
      await db
        .update(coachGoogleConnectionsTable)
        .set({ status: "error", lastError: message.slice(0, 500) })
        .where(eq(coachGoogleConnectionsTable.id, row.id));
    }
  }
  return tokens;
}
