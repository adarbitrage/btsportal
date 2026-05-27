# BTS Community — Page Fixes

**Context:** Community page is live but has three issues to fix:
1. Production has seed/dummy posts that need to be deleted.
2. Composer is non-functional — no clear way for members to actually create a post.
3. Page content area is too narrow; tons of empty space on the right.
4. Revenue tracking on "Wins" posts was added by the agent but is not wanted — strip it from schema, API, and UI.

**Tabs/categories stay** (Wins, Questions, Strategies, Introductions, Accountability, Resources, Off-Topic). The composer must let members pick one.

This is a single task — one agent, sequential file changes.

---

## Task: Community Page Cleanup + Composer + Layout

### Files Modified
- `shared/schema/community.ts` — remove `revenue_amount` (or whatever the column is named) from `community_posts` table
- `server/routes/community.ts` — strip revenue from POST/PATCH validation and GET response payload
- `server/storage/community.ts` — strip revenue from insert/update/select
- `client/src/components/community/post-composer.tsx` — full rebuild (see spec below)
- `client/src/components/community/post-card.tsx` — remove "Revenue: $X" display
- `client/src/pages/community/feed.tsx` OR `client/src/layouts/portal-layout.tsx` — widen content area (see spec below)

### Files Created
- `server/migrations/00XX_remove_post_revenue.sql` — Drizzle migration to drop the revenue column

### 1. Delete Dummy Posts

Production currently has seed/test posts (Jake Rivera, Lisa Thompson, Marcus Johnson with "First $1K Day", "First Campaign Launched", etc. — clearly seed data). Delete them.

Approach: identify them via the seed script or by the test user accounts they were posted under (likely `jake.rivera@`, `lisa.thompson@`, `marcus.johnson@` or similar). Delete via SQL run from the Database pane in Production:

```sql
DELETE FROM community_reactions
WHERE target_type = 'post' AND target_id IN (
  SELECT id FROM community_posts WHERE user_id IN (
    SELECT id FROM users WHERE email LIKE '%@bts-seed.test'  -- adjust filter to match seed accounts
  )
);

DELETE FROM community_comments
WHERE post_id IN (
  SELECT id FROM community_posts WHERE user_id IN (
    SELECT id FROM users WHERE email LIKE '%@bts-seed.test'
  )
);

DELETE FROM community_posts
WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@bts-seed.test'
);

-- Optionally delete the seed users themselves if they aren't real accounts:
-- DELETE FROM users WHERE email LIKE '%@bts-seed.test';
```

Agent: find the actual seed account pattern (check `server/seed/` or wherever the agent seeded these) and adjust the WHERE clause. Confirm with Adam before running if the filter is ambiguous.

ALSO: remove or guard the seed script so it doesn't re-run on next deploy. Add `if (process.env.NODE_ENV !== 'production')` around the seed function, or delete the call entirely.

### 2. Composer Rebuild

The current composer is just a non-functional "What's on your mind?" input. Rebuild as a click-to-expand component:

**Collapsed state (default):**
- Single row: avatar (left) + "What's on your mind?" placeholder input (full width).
- Same visual as today.

**Expanded state (on focus/click):**
- Title input — `<Input>` — placeholder "Title (e.g., First $1K Day)" — required, max 120 chars.
- Body textarea — `<Textarea>` — placeholder "Share the details..." — required, 1–5000 chars, autosize.
- Category dropdown — `<Select>` — required — options match the existing tabs: Wins, Questions, Strategies, Introductions, Accountability, Resources, Off-Topic.
- Footer row: "Cancel" button (left, ghost) + "Post" button (right, primary, disabled until title + body + category all valid).
- Cancel collapses back to the single-row state.

**Submit behavior:**
- POSTs to `/api/community/posts` with `{ title, body, category }`.
- On success: composer collapses + clears, the new post appears at the top of the feed (use TanStack Query `setQueryData` to inject optimistically).
- On error: red toast with the error message, composer stays open with values preserved.

**Schema check:** confirm `community_posts` already has `title` and `category` columns. If `title` is missing (the agent may have only added `body`), add it via a new migration. Looking at the seed data on screen, posts clearly have both a category badge and a separate bold title above the body — so the columns probably exist. Verify.

### 3. Width Fix

Current page wastes ~40% of horizontal space on desktop. Other portal pages may have the same issue, but for now scoped to Community.

Two options for the agent to pick based on existing pattern:
- **Option A (preferred):** widen the global content container in `portal-layout.tsx`. If the layout uses `max-w-3xl` or similar, bump to `max-w-5xl` or `max-w-6xl`.
- **Option B:** if other pages depend on the narrower width, only widen the Community page by wrapping its content in a wider container that overrides the layout's max-width.

Target: content area should be roughly 900–1100px wide on desktop (1440px viewport). Posts should fill that width comfortably without becoming uncomfortably long lines of text.

Agent: pick the option that doesn't break the Dashboard, Account, or other portal pages. If unsure, go with Option B (Community-only widening) for safety.

### 4. Strip Revenue Tracking

The agent added a `revenue_amount` field (or similar) on `community_posts` and rendered "Revenue: $1,247.5" below Wins posts. Remove entirely:
- Drizzle migration: `ALTER TABLE community_posts DROP COLUMN revenue_amount;` (adjust column name).
- Strip from Zod schemas, API validation, storage layer, frontend types, post-card render.
- Strip from any seed script that referenced it.

### Acceptance Criteria
- After deploy: Community feed loads empty (no dummy posts) for fresh users.
- Composer expands properly on click, submits a real post, and the new post appears in the feed.
- All seven category tabs work as filters.
- No "Revenue: $X" line anywhere in the UI.
- On a 1440px viewport, Community content area fills at least 900px width.
- Dashboard and other portal pages render at their original width (no collateral damage).

### Implementation Notes
- The composer should reuse existing shadcn/ui primitives (`Input`, `Textarea`, `Select`, `Button`).
- Optimistic insert: when `useCreatePost` mutation fires, `setQueryData(['community-posts'], (old) => [newPost, ...old.pages[0].items, ...])` or equivalent.
- If migration drops a column that exists in production data, no rollback worries — revenue was never user-facing input, just seed-generated values.
- If seed accounts aren't easily identifiable, fall back to deleting ALL posts older than the deployment timestamp (paste a precise cutoff timestamp). Confirm with Adam first.
