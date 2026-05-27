# BTS Portal — Community Moderation Build Spec

**Reference:** Builds on the Community + DM spec (`bts-community-dm-spec.md`)
**Stack:** Express.js + Drizzle + PostgreSQL / React + Vite + Tailwind + shadcn/ui + TanStack Query
**Dependency:** Community + DM build (Tasks 1–5 in prior spec) must be complete and merged before starting this spec.

---

## Policy Summary (Decisions Locked)

| Decision | Choice |
|---|---|
| Categories filtered | profanity, anti-BTS, defeatist, self-harm, spam/links |
| Scope | Community posts + comments only (DMs excluded) |
| Detection | Layered — wordlist for profanity/spam, Claude classifier for sentiment categories |
| Action on trigger | Shadow-ban: author sees post as normal, everyone else doesn't; entry added to admin moderation queue |
| Self-harm escalation | None special — same queue |
| Admin approve | Restores post live, no author notification |
| Admin reject | Stays hidden, no author notification, **+1 strike** to author |
| Repeat offender | 3 confirmed rejections (strikes) → posting privileges auto-suspended |
| Wordlist management | Full admin CRUD from day 1 (per-word category + severity) |

---

## Dependency Graph

```
TIER 1: Task 1 (Moderation backend foundation — schema, services, admin API)
TIER 2 (parallel): Task 2 (Wire into community endpoints)
                   Task 3 (Admin moderation queue UI)
                   Task 4 (Admin wordlist UI)
                   Task 5 (Admin strikes UI)
TIER 3: Task 6 (Routing + nav integration)
```

---

## Task 1: Moderation Backend Foundation

### What This Does
Stands up all moderation infrastructure: schema, wordlist matcher, AI classifier service, moderation engine, admin endpoints for queue/wordlist/strikes, posting-ban middleware. Does NOT wire into community endpoints yet (Task 2 does that).

### Files Created
- `shared/schema/moderation.ts` — Drizzle tables
- `server/services/moderation/engine.ts` — orchestrator: takes content, returns verdict
- `server/services/moderation/wordlist.ts` — matcher (loads list, runs scan)
- `server/services/moderation/classifier.ts` — Claude classifier client
- `server/middleware/postingBan.ts` — checks `users.posting_banned_at`
- `server/routes/admin/moderation.ts` — queue review endpoints
- `server/routes/admin/wordlist.ts` — wordlist CRUD
- `server/routes/admin/strikes.ts` — strike view + manual ban/unban
- `server/seed/moderation-wordlist.ts` — seed initial wordlist (~50 starter words across profanity + spam categories)

### Files Modified
- `shared/schema.ts` — add `export * from './schema/moderation'`
- `shared/schema/community.ts` — extend post status + comment status enums to include `shadow_hidden` (in addition to existing active/hidden/deleted)
- `shared/schema/users.ts` (or wherever `users` table lives) — add column `posting_banned_at TIMESTAMP NULL`
- `server/index.ts` — register `/api/admin/moderation`, `/api/admin/wordlist`, `/api/admin/strikes`

### Schema Changes
New tables:
- `moderation_wordlist`
  - `id, word (varchar, unique, lowercase), category (enum: profanity|spam), severity (enum: hard|soft), created_at, created_by_user_id`
- `moderation_queue`
  - `id, target_type (enum: post|comment), target_id, author_user_id, body_snapshot (text), triggered_by (jsonb), status (enum: pending|approved|rejected, default pending), reviewed_by_user_id (nullable), reviewed_at (nullable), created_at`
  - `triggered_by` shape: `{ wordlist_matches: [{ word, category, severity }], ai_scores: { profanity, anti_bts, defeatist, self_harm, spam } }`
- `user_strikes`
  - `id, user_id, queue_item_id (fk moderation_queue), category (varchar — primary category that triggered), created_at`

Schema modifications:
- `community_posts.status` enum: add `shadow_hidden`
- `community_comments.status` enum: add `shadow_hidden`
- `users` table: add `posting_banned_at TIMESTAMP NULL`

### Moderation Engine Behavior
Single entry point: `engine.evaluate({ body, targetType, authorId })` → returns `{ flagged: boolean, triggers: {...} }`

Algorithm:
1. Run `wordlist.scan(body)` — case-insensitive substring match against active wordlist. Returns matches with category + severity.
2. If any HARD-severity match → return `{ flagged: true, triggers: { wordlist_matches, ai_scores: null } }` — skip AI call.
3. Else call `classifier.classify(body)` → returns `{ profanity, anti_bts, defeatist, self_harm, spam }` each 0.0–1.0.
4. If any AI score > 0.5 OR any SOFT-severity wordlist match → flagged.
5. Return verdict with full trigger details for the queue.

Engine is **synchronous** within the request — adds ~1–2s to post submit. Acceptable for v1.

### Classifier Service (`classifier.ts`)
- Calls Anthropic Claude API using existing `ANTHROPIC_API_KEY` env var.
- Model: `claude-haiku-4-5-20251001` (speed + cost; quality is sufficient for binary-ish category scoring).
- System prompt:
  ```
  You are a content moderator for a Christian-led affiliate marketing mentorship community.
  Classify the user's text against five categories. For each, return a score from 0.0 to 1.0:
  - profanity: vulgar language, slurs, sexual content
  - anti_bts: disparagement of the program, coaches, or fellow members
  - defeatist: language likely to discourage other members from continuing
                ("this doesn't work", "I'm quitting", "waste of money")
  - self_harm: signals of suicidal ideation, self-harm, or crisis
  - spam: solicitations, external offer links, MLM pitches, off-topic promotion
  Respond ONLY with a JSON object — no preamble, no markdown fences.
  ```
- User message: just the body text being evaluated.
- Strip ```json fences defensively before parsing.
- Timeout: 8 seconds. On timeout or parse failure → fail OPEN (return all zeros). Log the failure to a `moderation_errors` log table or just console for v1.

### Wordlist Matcher
- Loads active wordlist into memory cache (refresh every 60s or on admin CRUD).
- Case-insensitive, whole-word AND substring match (use word boundaries `\b` where word is alphabetic only; for phrases like "fuck this" match as substring).
- Returns all matches with their severity + category.

### Posting Ban Middleware
- `requireNotBanned`: if `users.posting_banned_at IS NOT NULL`, return 403 with `{ error: "Your community posting privileges have been suspended. Contact support." }`
- Applies to: post create, comment create, reaction create.

### Admin API Endpoints
All require admin role.

**Queue (`/api/admin/moderation`):**
- `GET /queue?status=pending&cursor=&limit=20` — list queue items, includes author info + body_snapshot + triggered_by
- `GET /queue/:id` — single queue item with full context
- `POST /queue/:id/approve` — sets queue status=approved, unsets target's status (post/comment → `active`)
- `POST /queue/:id/reject` — sets queue status=rejected, target stays `shadow_hidden`, **inserts user_strikes row**, runs strike check (see below)

**Wordlist (`/api/admin/wordlist`):**
- `GET /` — list all words, sortable/filterable by category + severity
- `POST /` — add word `{ word, category, severity }`
- `PATCH /:id` — update category/severity
- `DELETE /:id` — remove word

**Strikes (`/api/admin/strikes`):**
- `GET /users/:userId` — strike history for a user + current ban status
- `POST /users/:userId/ban` — manual ban (sets `posting_banned_at = now()`)
- `POST /users/:userId/unban` — sets `posting_banned_at = null`, optionally clears prior strikes (query param `?clearStrikes=true`)

### Strike Check Logic
After inserting a `user_strikes` row (on reject):
```
strikeCount = count of strikes for user_id
if strikeCount >= 3 AND users.posting_banned_at IS NULL:
  set users.posting_banned_at = now()
  log audit event
```

### Dependencies
- Community schema must exist (`community_posts`, `community_comments` from prior build).
- Existing `users` table.
- Existing admin role check middleware.

### Acceptance Criteria
- Wordlist seed creates ~50 starter words (profanity + spam categories) on first migration.
- `engine.evaluate()` correctly flags a body containing a HARD-severity word without calling the classifier.
- `engine.evaluate()` returns flagged=true when classifier returns `anti_bts: 0.7` even with no wordlist matches.
- Approving a queue item flips the post/comment status from `shadow_hidden` to `active`.
- Rejecting a queue item leaves status as `shadow_hidden` AND inserts a strike row.
- After the 3rd strike on a user, `posting_banned_at` is set automatically.
- A banned user calling community POST endpoints (after Task 2 wires the middleware) gets 403.
- Wordlist CRUD invalidates the in-memory cache.

### Implementation Notes
- Use shadcn/ui patterns existing in the codebase for any reused components.
- Classifier failures must fail open (allow the post through), NOT closed — better to let one slip than block legitimate posts due to API hiccups. The wordlist still catches hard-blocks regardless.
- Body snapshot in queue stores the original text — never updated even if the post is edited later. Audit trail.
- Wordlist words stored lowercase; matcher lowercases input before scan.

---

## Task 2: Wire Moderation Into Community Endpoints

### What This Does
Hooks the moderation engine into post/comment creation, updates feed queries to enforce shadow-ban visibility, applies posting-ban middleware.

### Files Modified
- `server/routes/community.ts`:
  - Add `requireNotBanned` middleware to `POST /api/community/posts`, `POST /api/community/posts/:id/comments`, `POST /api/community/reactions`
  - On post create: after insert, call `engine.evaluate()`. If flagged → update post status to `shadow_hidden` + insert moderation_queue row. Same for comments.
- `server/storage/community.ts`:
  - `getPosts(viewerId, cursor)`: `WHERE status = 'active' OR (status = 'shadow_hidden' AND user_id = :viewerId)` — admins see everything regardless.
  - `getComments(postId, viewerId)`: same shadow-ban filter.
  - `getReactionCount(postId, viewerId)`: do not count reactions on shadow_hidden items for non-author viewers (edge case — won't typically matter since no one else can see them to react).

### Files Created
None.

### Schema Changes
None (handled in Task 1).

### Dependencies
Depends on: Task 1 complete.

### Acceptance Criteria
- Post containing a hard-block word: API returns 200, post saves, but immediately becomes `shadow_hidden` and queue entry exists.
- Same post visible in author's own feed query, not in any other user's feed query.
- Admin's feed query shows the shadow-hidden post (admins always see everything).
- Banned user attempts to post → 403.
- Approving the post via admin queue → next feed query returns it as normal.

### Implementation Notes
- The engine call adds latency to the POST. Wrap it in try/catch — if engine throws unexpectedly, fail open and let the post through with status `active`, log the error.

---

## Task 3: Admin Moderation Queue UI

### What This Does
Admin page to review and approve/reject flagged content.

### Files Created
- `client/src/pages/admin/moderation/queue.tsx` — main queue page
- `client/src/components/admin/moderation/queue-item-card.tsx` — single item with approve/reject buttons + trigger details
- `client/src/components/admin/moderation/trigger-details.tsx` — formatted view of `triggered_by` JSON (wordlist matches + AI scores)
- `client/src/hooks/useAdminModeration.ts` — TanStack Query hooks

### Files Modified
None (routing in Task 6).

### Frontend Behavior
- Default view: pending items, newest first, infinite scroll.
- Each card shows: author name + avatar, target type (Post/Comment), body snapshot in a quote block, timestamp, trigger details (wordlist matches highlighted in red, AI scores with bars).
- Approve button: green, optimistic UI, removes card from queue.
- Reject button: red, confirmation dialog ("This will add a strike. 3 strikes auto-suspends posting."), then removes card.
- Filter tabs: Pending | Approved | Rejected.
- Empty state: "Queue is clear. Nothing to review."

### Dependencies
Depends on: Task 1 (admin API endpoints exist).

### Acceptance Criteria
- Approving an item removes it from the pending list AND restores the post in the public feed.
- Rejecting an item increments author strike count (visible in Task 5).
- Filter tabs correctly show approved/rejected history.

---

## Task 4: Admin Wordlist UI

### What This Does
Admin CRUD page for the moderation wordlist.

### Files Created
- `client/src/pages/admin/moderation/wordlist.tsx` — main page
- `client/src/components/admin/moderation/word-form.tsx` — add/edit form (word + category + severity)
- `client/src/components/admin/moderation/wordlist-table.tsx` — data table with sort/filter

### Files Modified
None.

### Frontend Behavior
- Table columns: Word, Category (badge), Severity (badge — red for hard, yellow for soft), Added By, Added At, Actions (edit, delete).
- Filter by category + severity. Search by word.
- "Add Word" button → modal with form.
- Edit row inline OR via modal.
- Delete with confirm.

### Dependencies
Depends on: Task 1.

### Acceptance Criteria
- Adding a word causes new posts matching that word to be flagged on next submit (cache refresh within 60s).
- Bulk view of all words sortable by category + severity.

---

## Task 5: Admin Strikes UI

### What This Does
Admin view of per-user strike count + ban status + manual ban/unban.

### Files Created
- `client/src/pages/admin/moderation/strikes.tsx` — list of users with strikes
- `client/src/pages/admin/moderation/user-strikes.tsx` — detail page per user (`/admin/moderation/strikes/:userId`)
- `client/src/components/admin/moderation/strike-row.tsx`
- `client/src/components/admin/moderation/ban-controls.tsx` — manual ban/unban buttons

### Files Modified
None.

### Frontend Behavior
- List page: members with strikes > 0, columns = Name, Strikes (badge with count), Banned? (yes/no), Last Strike, Actions.
- Detail page: full strike history (each strike linked to the queue item that produced it), current ban status, manual ban/unban buttons.
- Unban modal: checkbox "Also clear all prior strikes" (passes `?clearStrikes=true`).
- Confirmation required for ban/unban actions.

### Dependencies
Depends on: Task 1.

### Acceptance Criteria
- User with 3 strikes appears at top of list with "Banned" badge.
- Manual ban immediately blocks posting.
- Manual unban (without clearing strikes) restores posting but next rejection re-bans them.

---

## Task 6: Routing + Nav Integration

### Files Modified
- `client/src/App.tsx` — add admin routes:
  - `/admin/moderation/queue`
  - `/admin/moderation/wordlist`
  - `/admin/moderation/strikes`
  - `/admin/moderation/strikes/:userId`
- `client/src/layouts/portal-layout.tsx` (or admin sidebar component) — add admin nav group "Moderation" with three sub-items: Queue, Wordlist, Strikes. Visible only when `user.role === 'admin'`. Show a count badge next to "Queue" showing pending count (fetched via existing query hook).

### Dependencies
Depends on: Tasks 3, 4, 5.

### Acceptance Criteria
- All four routes render correctly.
- Sidebar Moderation group hidden for non-admins.
- Queue badge updates within 30s of new flagged content (TanStack Query polling).

---

## Seed Wordlist (Task 1 — `server/seed/moderation-wordlist.ts`)

Initial seed (~50 words). Categories: `profanity` or `spam`. Severities: `hard` (auto-block guaranteed) or `soft` (contributes to flag).

**Profanity — hard:** fuck, shit, bitch, asshole, cunt, pussy, dick, motherfucker, faggot, nigger (and common variants)
**Profanity — soft:** damn, hell, crap, bastard
**Spam — hard:** bitcoin, crypto, forex, telegram me, dm me for, click my link, my new course, free money, guaranteed income, mlm
**Spam — soft:** check out my, visit my, my offer, my funnel, my pitch

(Admin can add/remove anything post-launch.)

---

## Out of Scope (Future)

- Image/media moderation (v1 only filters text bodies)
- Filter on DMs (deliberate — DMs to admins ARE the support escape valve)
- User-facing report button ("Report this post")
- ML retraining feedback loop (admin decisions don't retrain anything in v1)
- Granular ban tiers (temp ban, posting-only ban vs full ban)
- Appeals process / contact form for banned users (banned users see message to email support)
- @mention detection / coach pinging
- Multi-language support (English only in v1)
