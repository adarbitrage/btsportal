import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Per-coach Google Drive OAuth connection.
//
// Each coach (or coaching admin) who logs into the portal can connect their own
// Google account, granting READ-ONLY Drive access so the recording-ingest job
// can find that coach's Meet recordings + Gemini "Take notes for me" notes that
// live in the coach's own Drive (per-coach topology — no Workspace admin /
// domain-wide delegation required). One row per portal user.
//
// The OAuth refresh token is encrypted at rest with app-secrets-crypto
// (AES-256-GCM); the plaintext token is NEVER stored or returned to clients.
export const coachGoogleConnectionsTable = pgTable("coach_google_connections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id),
  // The connected Google account's email (for display + sanity in coach UI).
  googleEmail: text("google_email").notNull(),
  // AES-256-GCM encrypted OAuth refresh token (the `v1:iv:tag:ct` blob).
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  // Space-delimited granted scopes (for diagnostics).
  scope: text("scope"),
  // active | revoked | error — set to revoked/error when a refresh fails so the
  // coach UI can prompt a reconnect and the ingest can skip the dead token.
  status: text("status").notNull().default("active"),
  lastError: text("last_error"),
  // When the ingest last successfully minted an access token for this account.
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type CoachGoogleConnection = typeof coachGoogleConnectionsTable.$inferSelect;
