# BTS Portal — Community + Direct Messages Build Spec

**Reference:** BTS PRD v2.0, Build Spec #5 (Community)
**Stack:** React 18 + Vite + Tailwind + shadcn/ui + TanStack Query / Express.js + Drizzle ORM + PostgreSQL (Neon)
**Entitlement gates:**
- Community posting + commenting + reacting → `community:access` (3-Month Mentorship and above)
- DMs → ALL members can DM admins ONLY. Coaches receive no DMs. Admins can initiate with anyone. Either side can start a DM thread.

---

## Dependency Graph

```
TIER 1 (parallel):  Task 1 (Community backend)   Task 2 (DM backend)
TIER 2 (parallel):  Task 3 (Community frontend)  Task 4 (DM frontend)
TIER 3 (sequential): Task 5 (Routing + nav integration)
```

---

## Task 1: Community Backend

### What This Does
Posts, comments, and reactions for the community feed. Gated to `community:access` for write, readable by same.

### Files Created
- `shared/schema/community.ts` — Drizzle tables for community
- `server/routes/community.ts` — REST endpoints
- `server/storage/community.ts` — DB access methods

### Files Modified
- `shared/schema.ts` — add `export * from './schema/community'` line at bottom
- `server/index.ts` — register `community` router at `/api/community`

### Schema Changes
New tables:
- `community_posts` — `id, user_id, body (text), media_urls (jsonb, default []), status (enum: active|hidden|deleted, default active), created_at, updated_at`
- `community_comments` — `id, post_id (fk), user_id, body, status (enum: active|hidden|deleted), created_at, updated_at`
- `community_reactions` — `id, target_type (enum: post|comment), target_id, user_id, type (enum: like — extendable later), created_at` + UNIQUE(target_type, target_id, user_id, type)

### API Endpoints
All require auth. All require `community:access` entitlement.
- `GET /api/community/posts?cursor=&limit=20` — paginated feed, newest first, includes author name/avatar, reaction counts, comment counts, viewer's reaction state
- `POST /api/community/posts` — create post, body required (1–5000 chars), media_urls optional
- `GET /api/community/posts/:id` — single post with comments
- `PATCH /api/community/posts/:id` — author edit (body only) within 30 min OR admin anytime
- `DELETE /api/community/posts/:id` — soft delete, author OR admin
- `POST /api/community/posts/:id/comments` — add comment, body required (1–2000 chars)
- `PATCH /api/community/comments/:id` — author edit within 30 min OR admin
- `DELETE /api/community/comments/:id` — soft delete, author OR admin
- `POST /api/community/reactions` — body: `{ target_type, target_id, type }`, toggle (insert or delete)
- Admin-only:
  - `POST /api/admin/community/posts/:id/hide` and `/unhide`
  - `POST /api/admin/community/comments/:id/hide` and `/unhide`

### Frontend
None this task.

### Dependencies
None — fully independent.

### Acceptance Criteria
- A user with `community:access` can create a post, see it in the feed, edit it within 30 min, delete it.
- A user without `community:access` gets 403 on all write endpoints AND on GET /posts (no read access without entitlement).
- Reaction toggle is idempotent — pressing like twice removes the like.
- Hidden posts return 404 to non-admins, full payload to admins.
- Soft deletes never hard-remove rows; `status` flips to `deleted`.

### Implementation Notes
- Use existing `requireEntitlement('community:access')` middleware.
- Counts (reaction_count, comment_count) should be computed in the SELECT, not stored — keep schema simple.
- For pagination use cursor on `created_at + id` for stable ordering.
- Author edit window: enforce server-side via `created_at` comparison.

---

## Task 2: DM Backend

### What This Does
Direct messaging system with role-based restrictions: members can only DM admins; admins can DM anyone (members or other admins); coaches receive zero DMs from members. Either party can initiate a thread.

### Files Created
- `shared/schema/dm.ts` — Drizzle tables
- `server/routes/dm.ts` — REST endpoints
- `server/storage/dm.ts` — DB access methods
- `server/middleware/dmPermissions.ts` — role-pair validation (the critical piece)

### Files Modified
- `shared/schema.ts` — add `export * from './schema/dm'` line at bottom
- `server/index.ts` — register `dm` router at `/api/dm`

### Schema Changes
New tables:
- `dm_threads` — `id, member_id (fk users), admin_id (fk users), created_at, last_message_at` + UNIQUE(member_id, admin_id)
- `dm_messages` — `id, thread_id (fk), sender_id (fk users), body (text, 1–5000 chars), created_at, read_at (nullable)`

**Note:** Thread is ALWAYS modeled as one member + one admin. Even if an admin initiates with another admin, store the initiator as `admin_id` and recipient as `member_id` — OR forbid admin↔admin DMs in v1. Default below: forbid admin↔admin in v1 to keep the model clean.

### API Endpoints
All require auth.
- `GET /api/dm/threads` — list of threads for current user, sorted by `last_message_at` desc, includes other-party name/avatar/role, last message preview, unread count
- `POST /api/dm/threads` — body: `{ recipient_user_id }`, returns thread (creates if not exists). **Permission rules enforced by `dmPermissions` middleware** — see below.
- `GET /api/dm/threads/:id/messages?cursor=&limit=50` — paginated message history, newest first
- `POST /api/dm/threads/:id/messages` — body: `{ body }`, sender must be a participant
- `POST /api/dm/threads/:id/read` — mark all unread messages in thread as read for current user
- `GET /api/dm/recipients` — list of valid DM recipients for the current user (members see admin list; admins see members list + admin list if admin↔admin allowed)
- `GET /api/dm/unread-count` — total unread across all threads (for nav bell)

### Permission Middleware Logic (`dmPermissions.ts`)
This is the linchpin — implement carefully.

```
canDM(sender, recipient):
  if sender.role === 'member':
    return recipient.role === 'admin'        // members → admins only
  if sender.role === 'admin':
    return recipient.role === 'member' || recipient.role === 'admin'
      // ⬆ v1 decision: set to `=== 'member'` to forbid admin↔admin
  if sender.role === 'coach':
    return false                              // coaches do not DM
  return false
```

Reject thread creation AND message posting if `canDM` returns false. Return `403 { error: "DMs not permitted between these users" }`.

### Frontend
None this task.

### Dependencies
None — fully independent.

### Acceptance Criteria
- A member calling `POST /api/dm/threads` with another member's user_id → 403.
- A member calling `POST /api/dm/threads` with a coach's user_id → 403.
- A member calling `POST /api/dm/threads` with an admin's user_id → 200, thread created.
- An admin calling `POST /api/dm/threads` with a member's user_id → 200, thread created (admin-initiated).
- Coaches calling any DM endpoint → 403.
- Duplicate thread creation for same (member, admin) pair → returns existing thread, no duplicate row.
- `GET /api/dm/recipients` as a member returns ONLY admins (active users with role=admin).
- Unread count decrements correctly after `POST /read`.

### Implementation Notes
- Role source of truth is `users.role` column (should already exist; flag if not).
- All endpoints log to existing audit log if available; otherwise stub a console log.
- v1: forbid admin↔admin DMs — keeps the (member_id, admin_id) shape clean.

---

## Task 3: Community Frontend

### What This Does
Feed page, post composer, comment threads, reaction button.

### Files Created
- `client/src/pages/community/feed.tsx` — main feed page
- `client/src/pages/community/post.tsx` — single-post detail page (route `/community/:postId`)
- `client/src/components/community/post-composer.tsx` — create/edit post form
- `client/src/components/community/post-card.tsx` — post in the feed
- `client/src/components/community/comment-thread.tsx` — comments under a post
- `client/src/components/community/reaction-button.tsx` — like toggle
- `client/src/hooks/useCommunity.ts` — TanStack Query hooks (`usePosts`, `useCreatePost`, `useComments`, `useReaction`, etc.)

### Files Modified
- None (routing wired in Task 5)

### Schema Changes
None.

### Frontend Behavior
- Feed: infinite scroll via cursor pagination, optimistic reaction toggle, "What's on your mind?" composer pinned at top.
- Post detail: full post + comment thread + composer for comments.
- Edit-in-place for own posts/comments within 30 min (UI hides edit button after).
- Markdown rendering for post/comment bodies (use existing renderer if present, else `react-markdown`).
- Media: v1 allows pasting image URLs into `media_urls`; full upload UI deferred.
- Empty state: "Be the first to post" CTA.
- 403 response → show "Community access requires 3-Month Mentorship or higher" with upgrade CTA.

### Dependencies
Depends on: Task 1 (Community Backend) complete.

### Acceptance Criteria
- Member with `community:access` sees feed and can post/comment/react.
- Member without `community:access` sees a paywall card with upgrade CTA.
- Reaction button updates count optimistically and rolls back on error.
- Posts created appear at top of feed without full refetch (use mutation `onSuccess` → `setQueryData`).

### Implementation Notes
- Use shadcn/ui `Card`, `Textarea`, `Button`, `Avatar`, `DropdownMenu` (for edit/delete actions).
- Author edit dropdown visible only when `viewer.id === post.user_id` AND within 30 min.

---

## Task 4: DM Frontend

### What This Does
Inbox view + thread view + new-conversation modal. Members see only admin recipients; admins see member recipients.

### Files Created
- `client/src/pages/dm/inbox.tsx` — thread list (left rail or full page on mobile)
- `client/src/pages/dm/thread.tsx` — message view for a single thread (`/dm/:threadId`)
- `client/src/components/dm/thread-list.tsx`
- `client/src/components/dm/message-list.tsx`
- `client/src/components/dm/message-composer.tsx`
- `client/src/components/dm/new-conversation-modal.tsx` — recipient picker
- `client/src/components/dm/unread-badge.tsx` — small badge for nav
- `client/src/hooks/useDM.ts` — `useThreads`, `useMessages`, `useSendMessage`, `useRecipients`, `useUnreadCount`

### Files Modified
- None (routing wired in Task 5)

### Schema Changes
None.

### Frontend Behavior
- Inbox: list of threads sorted by `last_message_at`, unread bold + count badge.
- Thread view: messages bottom-anchored, polling refetch every 10s while focused (TanStack Query `refetchInterval`), `POST /read` on thread mount + on new message arrival when focused.
- New conversation modal: searchable list from `GET /api/dm/recipients`. For members the heading reads "Message an admin" (since that's all they'll see).
- Composer: textarea + send button, Cmd/Ctrl+Enter to send, disabled while sending.
- Mobile: inbox and thread are separate full-screen routes with back button.
- Empty state on inbox for new members: "Need help? Start a conversation with an admin." + button.

### Dependencies
Depends on: Task 2 (DM Backend) complete.

### Acceptance Criteria
- Member sees only admin users in the recipient picker — coaches and other members must not appear.
- Sending a message updates the thread's `last_message_at` and pops it to the top of the inbox.
- Unread badge in nav reflects `GET /api/dm/unread-count` and clears when threads are read.
- Coach login (if testable) sees no DM nav link at all.

### Implementation Notes
- Polling-based for v1 (no WebSockets) — `refetchInterval: 10000` on the messages query, `refetchInterval: 30000` on the inbox + unread count queries.
- Hide DM nav entirely for users with `role === 'coach'`.

---

## Task 5: Routing + Nav Integration

### What This Does
Wires all new routes and nav links. Runs LAST to avoid conflicts on shared files.

### Files Modified
- `client/src/App.tsx` — add routes:
  - `/community` → `pages/community/feed.tsx`
  - `/community/:postId` → `pages/community/post.tsx`
  - `/dm` → `pages/dm/inbox.tsx`
  - `/dm/:threadId` → `pages/dm/thread.tsx`
- `client/src/layouts/portal-layout.tsx` (or equivalent sidebar component) — add nav items:
  - **Community** — visible if user has `community:access` entitlement
  - **Messages** — visible if `user.role !== 'coach'` (members and admins only); show `unread-badge` next to label

### Files Created
None.

### Schema Changes
None.

### Dependencies
Depends on: Task 3 AND Task 4 complete.

### Acceptance Criteria
- All four routes render their pages correctly.
- Sidebar shows "Community" only for entitled users, "Messages" only for non-coaches.
- Unread badge appears next to "Messages" when unread count > 0.

### Implementation Notes
- Use the existing `navItems` array pattern (see BTS skill — `Conditional Navigation` section).

---

## Out of Scope (Future)

- File/image uploads to R2 inside posts and DMs (v1 uses URL paste)
- WebSocket real-time messaging (v1 polls)
- Push notifications, email digests on community activity
- Threaded/nested comments (v1 is flat)
- @mentions
- Pinned posts, post categories/tags
- Block/mute member-to-member (not needed since members don't DM each other and posts are moderation-only)
- Admin↔admin DMs (forbidden in v1 by `dmPermissions` middleware)
