---
name: Session last-seen vs created semantics
description: How sessions track sign-in time vs last activity given token rotation, and admin session controls
---
- `/auth/refresh` rotates refresh tokens: it revokes the matched session row and inserts a NEW row. Without intervention the new row's `created_at` would be the refresh time, losing the original sign-in time.
- `createSession(userId, req, inheritCreatedAt?)` takes an optional `inheritCreatedAt`; the refresh path passes the old row's `createdAt` so `created_at` keeps meaning "sign-in time".
- `sessions.last_seen_at` (added in companion migration) defaults to now() on insert, so it tracks the most recent refresh = last activity. created_at and last_seen_at are equal on fresh login, then diverge as the session refreshes.
- **Why:** admin Member Detail "Active sessions" card needs distinct "signed in" vs "last seen" columns; rotation made plain createdAt useless as sign-in time.
- **How to apply:** if you add more session-creation paths, decide whether they're a fresh sign-in (no inherit) or a rotation (inherit createdAt). "Active" = revoked_at IS NULL AND expires_at > now().
- Admin session endpoints live near force-password-reset in admin-panel.ts, all gated on `members:assign_role`: single revoke is scoped by (sessionId, userId) to prevent cross-user revokes; revoke-all + the embedded `/full` activeSessions list. Audit objects are passed as the 6th `logAdminAction` arg (changeDiff column), NOT metadata.
