# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Routing**: wouter
- **Data fetching**: React Query (via Orval-generated hooks)
- **Auth**: Custom email/password with JWT access tokens + refresh tokens (httpOnly cookies), bcryptjs
- **CRM Sync**: GoHighLevel (GHL) bidirectional sync via BullMQ queue + ioredis (rate-limited 90 req/min, exponential backoff retries)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   ├── portal/             # BTS Member Portal (React + Vite)
│   └── mockup-sandbox/     # Design mockup preview server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## BTS Member Portal

The main application is a customer member portal for "Build Test Scale" (BTS), an affiliate marketing mentorship platform.

### Authentication System

Custom email/password auth with:
- **Access tokens**: JWT in httpOnly cookies, 15-minute expiry
- **Refresh tokens**: Random 48-byte tokens, SHA-256 hashed in `sessions` table, 7-day expiry, rotation on refresh
- **Password hashing**: bcryptjs with 12 rounds
- **Account lockout**: 5 failed attempts = 15-minute lockout
- **Email verification**: Token-based (logged to console in dev)
- **Password reset**: Token-based with 1-hour expiry (logged to console in dev)
- **CSRF**: Token in non-httpOnly cookie for client-side access

**Auth middleware** (`artifacts/api-server/src/middleware/auth.ts`): Verifies JWT from `access_token` cookie, sets `req.userId` and `req.userEmail`. Public paths bypass auth.

**Auth routes** (`artifacts/api-server/src/routes/auth.ts`):
- `POST /auth/register` — Create account (validates email, password strength)
- `POST /auth/login` — Login with lockout protection
- `POST /auth/refresh` — Rotate refresh token, issue new access token
- `POST /auth/logout` — Revoke session, clear cookies
- `POST /auth/forgot-password` — Request password reset (always returns success)
- `POST /auth/reset-password` — Reset with token
- `POST /auth/verify-email` — Verify email with token
- `GET /auth/me` — Current authenticated user

**Frontend auth** (`artifacts/portal/src/lib/auth.tsx`): AuthProvider with login/register/logout/refreshAuth. Protected routes redirect to `/login`. Guest routes redirect authenticated users to `/`.

### Product-Based Entitlement System

The portal uses a **product-based entitlement model** (not simple tiers). Users purchase products, each product grants a set of entitlement keys, and access is determined by the union of all active entitlements.

**8 Products:**
1. Reserve Income System (front-end) — `content:frontend`, `support:basic`, `chat:basic`
2. Backroad System (front-end) — `content:frontend`, `support:basic`, `chat:basic`
3. Off-Market Affiliate System (front-end) — `content:frontend`, `support:basic`, `chat:basic`
4. BTS LaunchPad (back-end) — `content:frontend`, `content:advanced`, `software:base`, `support:standard`, `chat:full`
5. 3-Month Mentorship — adds `coaching:group`, `community:access`, `commissions:entry`, `support:enhanced`
6. 6-Month Mentorship — adds `coaching:mastermind`, `software:expanded`, `commissions:mid`, `support:unlimited`
7. 1-Year Mentorship — adds `coaching:one_on_one:monthly`, `commissions:premium`
8. Lifetime Mentorship — adds `coaching:one_on_one:weekly`, `commissions:top`, `support:vip`, `chat:custom`, `access:lifetime`

**Entitlement resolution:** `artifacts/api-server/src/lib/entitlements.ts` — loads user's active products, unions their entitlement keys, and provides helpers (`getUserEntitlements`, `hasEntitlement`, `getHighestProductLabel`, `getSupportTicketLimit`).

### Pages
- **Login** (`/login`) — Email/password sign in with BTS branding
- **Register** (`/register`) — Account creation with password validation
- **Forgot Password** (`/forgot-password`) — Password reset request
- **Onboarding** (`/onboarding/*`) — 5-step wizard (welcome, documents, profile, orientation, quick-start)
- **Dashboard** (`/`) — Welcome banner with product badge, stats cards, training progress, upcoming calls, entitlement display, announcements
- **Training Library** (`/training`) — Tracks with locked/unlocked state based on `requiredEntitlement`, modules with progress
- **Community Feed** (`/community`) — Categorized post feed with reactions, comments, new post composer; gated by `community:access` entitlement
- **Member Directory** (`/community/members`) — Searchable/filterable grid of community members
- **Member Profile** (`/community/members/:userId`) — Member profile with stats, badges, and recent posts
- **Coaching Calls** (`/coaching`) — Calls gated by entitlement (coaching:group, coaching:mastermind, etc.)
- **Support Center** (`/support`) — Ticket management with entitlement-based limits

### Community Frontend (UI Layer)

The community frontend is a UI layer built for integration with community backend API endpoints (`/api/community/*`). It uses a custom fetch-based API layer (`src/lib/community-api.ts`) with React Query hooks (`src/hooks/use-community.ts`), since the community backend routes are not yet in the OpenAPI spec.

**Key files:**
- `src/lib/community-api.ts` — API client with typed interfaces for all community endpoints
- `src/hooks/use-community.ts` — React Query hooks with infinite scroll, optimistic reaction updates
- `src/pages/community/CommunityFeed.tsx` — Main feed with category tabs, pinned posts, pagination
- `src/pages/community/MemberDirectory.tsx` — Member grid with search, tier filter, sort
- `src/pages/community/MemberProfile.tsx` — Individual member profile page
- `src/components/community/PostCard.tsx` — Post cards with markdown rendering, reactions, edit/delete
- `src/components/community/CommentThread.tsx` — Comment threads with replies, inline input, edit/delete
- `src/components/community/NewPostModal.tsx` — Post composer modal with category, markdown, image URL
- `src/components/community/NotificationBell.tsx` — Bell dropdown with notification list, mark-all-read
- `src/components/community/TierBadge.tsx` — Tier badge colors and engagement badge components
- `src/components/community/ProfilePopover.tsx` — Hover/click profile card popover, AuthorAvatar
- `src/components/community/MemberCard.tsx` — Member card for directory grid

**Expected backend endpoints:** `GET/POST /community/posts`, `GET/POST /community/posts/:id/comments`, `POST /community/reactions`, `GET /community/categories`, `GET /community/members`, `GET /community/members/:id`, `GET /community/notifications`, `POST /community/notifications/read`

### Design
- Primary brand color: BTS blue (#1a56db)
- Background: warm off-white (#faf9f7)
- Font: Roboto (modern sans-serif)
- Editorial card layout with warm borders (#e8e4dc)
- Product badge colors: Frontend=#6b7280, LaunchPad=#92400e, 3-Month=#b45309, 6-Month=#d97706, 1-Year=#0891b2, Lifetime=purple gradient

### Database Tables
- `users` — Member profiles with auth fields, onboarding state (`onboarding_complete`, `onboarding_step`, `experience_level`, `primary_goal`, `sms_opt_in`)
- `sessions` — JWT refresh token sessions (refresh_token_hash, expires_at, revoked_at, ip_address, user_agent)
- `products` — Product definitions with entitlement key mappings (JSON)
- `user_products` — User-product ownership with status and expiration
- `entitlements` — Reference table of all entitlement keys
- `legal_documents` — Legal document templates (type, version, title, content as markdown)
- `signed_documents` — User document signatures (user_id, document_type, document_version, signature, signed_at, ip_address)
- `tracks` — Training tracks with `required_entitlement` key, `status` (draft/published), `archived` flag
- `modules` — Modules within tracks
- `lessons` — Lessons with `required_entitlement` key, `content_type`, `status` (draft/published), `text_content` (JSONB for TipTap), `action_items` (JSONB)
- `lesson_resources` — File attachments for lessons (via Object Storage presigned URLs), with download tracking
- `lesson_versions` — Version snapshots created on publish, supports restore (max 20 per lesson)
- `progress` — User lesson completion tracking
- `coaches` — Coach profiles
- `coaching_calls` — Scheduled coaching sessions with `required_entitlement`
- `tickets` — Support tickets (with `assigned_to` column for agent assignment)
- `ticket_messages` — Message threads on tickets (with `is_internal` flag for internal notes)
- `ticket_sla` — SLA tracking per ticket (tier-based targets, breach/warning flags, business-hours clock)
- `canned_responses` — Pre-built response templates with category and variable support
- `ticket_routing_rules` — Auto-routing rules for ticket assignment (category, priority, tier matching)
- `ticket_satisfaction` — Post-resolution satisfaction surveys (1-5 rating + feedback)
- `announcements` — Portal announcements
- `webhook_logs` — ThriveCart webhook event log with payload, status, and idempotency tracking
- `ghl_sync_log` — GHL sync event log (user_id, action, direction, payload, ghl_contact_id, status, error_message, attempts)
- `ghl_config` — GHL configuration key-value store (sync_enabled flag, pipeline/stage IDs, tag prefix)
- `tiers` — Legacy tier definitions (kept for backward compat)
- `users.ghl_contact_id` — GHL contact ID cross-reference on user record
- `chat_sessions` — AI chat sessions with soft delete support
- `chat_messages` — Chat message history (user + assistant roles)
- `chat_daily_usage` — Daily message count per user for rate limiting
- `chat_prompts` — User-saved prompt templates (chat:custom tier only, max 20)
- `chat_system_prompts` — Admin-editable system prompts with active flag
- `knowledgebase_docs` — RAG knowledge base documents with GIN index for full-text search

### Onboarding Flow

New members (`onboarding_complete === false`) are redirected to a 5-step onboarding wizard:
1. **Welcome** (`/onboarding/welcome`) — Personalized greeting, product list, optional welcome video
2. **Documents** (`/onboarding/documents`) — Scroll-enforced Membership Agreement + Terms of Service with typed signature
3. **Profile** (`/onboarding/profile`) — Name, phone, timezone (auto-detected), experience level, primary goal, SMS opt-in
4. **Orientation** (`/onboarding/orientation`) — Dynamic display of owned entitlements vs. upgrade options
5. **Quick Start** (`/onboarding/quick-start`) — Product-tier-specific first mission, quick links preview, "Go to My Dashboard" button

Progress is saved per step (`onboarding_step` column). Server-side validates prerequisites (docs must be signed before step 2 advances, profile fields required before step 3). Step 5 completion sets `onboarding_complete = true`.

**Out of scope (TODO placeholders):** PDF generation, SendGrid email delivery, canvas signature, GHL contact sync, admin panel for document editing.

### API Routes (all under `/api`)
- Auth: `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `GET /auth/me`
- `GET /members/me` — Current member profile with entitlements, products, and onboarding fields
- `GET /members/me/products` — List owned products
- `GET /members/me/entitlements` — Resolved entitlement set
- `GET /members/me/onboarding` — Current onboarding state (step, completed steps, signed docs)
- `PATCH /members/me/onboarding` — Advance onboarding step (validates prerequisites)
- `PATCH /members/me/profile` — Update profile fields (name, phone, timezone, experience_level, primary_goal, sms_opt_in)
- `GET /documents` — Fetch legal document content (optional `?type=` filter)
- `POST /documents/sign` — Record document signature with version tracking
- `GET /products` — List all available products
- `GET /dashboard` — Aggregated dashboard data with entitlements
- `GET /tracks` — List tracks with modules, progress, and locked state
- `GET /modules/:id` — Module detail with lessons (locked/unlocked)
- `GET /lessons/:id` — Single lesson with locked state
- `GET/POST /progress` — Track/mark lesson completion
- `GET /coaching-calls` — List coaching calls with accessibility flag
- `GET /coaches` — List coaches
- `GET/POST /tickets` — List/create support tickets (auto-creates SLA, auto-routes)
- `GET /tickets/:id` — Ticket with message thread (excludes internal notes)
- `POST /tickets/:id/messages` — Add message to ticket
- `POST /tickets/:id/satisfaction` — Submit satisfaction survey (1-5 rating)
- `GET /tickets/:id/satisfaction` — Check satisfaction survey status
- `GET /announcements` — List announcements
- `POST /webhooks/thrivecart` — ThriveCart webhook receiver (public, signature-verified)
- `POST /dev/simulate-purchase` — Dev-only simulated purchase (disabled in production)
- `POST /dev/simulate-refund` — Dev-only simulated refund (disabled in production)
- `POST /dev/simulate-cancellation` — Dev-only simulated cancellation (disabled in production)
- `POST /admin/run-expiration-check` — Nightly expiration check for time-limited products (admin-only)
- `GET /admin/tickets` — List all tickets with filters (admin-only)
- `GET /admin/tickets/:id` — Get ticket with all messages including internal notes (admin-only)
- `PUT /admin/tickets/:id/status` — Update ticket status with SLA pause/resume (admin-only)
- `POST /admin/tickets/:id/reply` — Admin reply with first-response SLA tracking (admin-only)
- `POST /admin/tickets/:id/internal-note` — Add internal note (admin-only)
- `GET /admin/tickets/:id/sla` — Per-ticket SLA details (admin-only)
- `POST /admin/tickets/merge` — Merge duplicate tickets (admin-only)
- `GET /admin/tickets/sla-dashboard` — SLA compliance overview (admin-only)
- `GET /admin/tickets/analytics` — Volume, categories, trends (admin-only)
- `GET /admin/tickets/agent-performance` — Per-agent metrics (admin-only)
- `GET/POST /admin/canned-responses` — CRUD canned responses (admin-only)
- `PUT/DELETE /admin/canned-responses/:id` — Update/delete canned responses (admin-only)
- `GET/POST /admin/ticket-routing` — CRUD routing rules (admin-only)
- `PUT/DELETE /admin/ticket-routing/:id` — Update/delete routing rules (admin-only)
- `GET /admin/webhook-logs` — List/filter webhook logs (admin-only)
- `GET /admin/webhook-logs/:id` — Single webhook log with full payload (admin-only)
- `GET /admin/product-mappings` — List ThriveCart product ID mappings (admin-only)
- `PUT /admin/product-mappings/:id` — Update ThriveCart product ID mapping (admin-only)
- `POST /webhooks/ghl` — GHL inbound webhook (tag/pipeline triggers: vip_override, force_expire, manual_upgrade_{product})
- `POST /members/me/onboarding-complete` — Mark onboarding complete (with GHL sync)
- `GET /admin/ghl/status` — GHL sync system status (queue counts, sync log stats)
- `GET /admin/ghl/log` — GHL sync log with pagination and filters (?status, ?userId, ?limit, ?offset)
- `POST /admin/ghl/sync/:userId` — Manually sync a single user to GHL
- `POST /admin/ghl/sync-all` — Bulk sync all users to GHL
- `GET /admin/ghl/config` — List GHL config key-value pairs
- `PATCH /admin/ghl/config` — Upsert a GHL config value (sync_enabled, pipeline_id, etc.)
- `POST /admin/ghl/retry/:jobId` — Retry a failed BullMQ job
- `POST /chat` — Send message to AI chat assistant (SSE streaming, entitlement-gated)
- `GET /chat/sessions` — List chat sessions (paginated)
- `GET /chat/sessions/:sessionId` — Get session with full message history
- `DELETE /chat/sessions/:sessionId` — Soft-delete a chat session
- `GET /chat/status` — Get chat tier, daily limit, usage, reset time
- `GET/POST /chat/prompts` — List/create saved prompt templates (chat:custom only, max 20)
- `PATCH/DELETE /chat/prompts/:promptId` — Update/delete saved prompt templates
- `POST /chat/create-ticket` — Create support ticket from chat session (chat:full/chat:custom only)

### AI Chat System

Uses Anthropic Claude (via Replit AI Integrations) for an AI chat assistant with:
- **3 chat tiers**: `chat:basic` (20/day, 1000 tokens), `chat:full` (50/day, 2000 tokens), `chat:custom` (100/day, 4000 tokens)
- **RAG retrieval**: PostgreSQL full-text search (tsvector/GIN) on knowledgebase_docs, filtered by tier-accessible categories
- **SSE streaming**: Real-time response streaming via `POST /chat`
- **Session management**: Conversation history with configurable depth per tier
- **Saved prompts**: Custom prompt templates for chat:custom users (max 20)
- **Ticket creation**: Create support tickets from chat context (chat:full/chat:custom)
- **System prompt**: Admin-editable, stored in DB with template variables ({{member_name}}, {{chat_tier}}, {{daily_limit}})

Integration package: `lib/integrations-anthropic-ai` (`@workspace/integrations-anthropic-ai`)

- **Admin Content Management (all admin-only):**
  - `GET/POST /admin/tracks` — List all tracks (with counts) / Create track
  - `PUT /admin/tracks/:id` — Update track
  - `PATCH /admin/tracks/reorder` — Reorder tracks
  - `PATCH /admin/tracks/:id/archive` — Soft-delete (archive) track
  - `PATCH /admin/tracks/:id/unarchive` — Unarchive track
  - `POST /admin/tracks/:id/duplicate` — Deep copy track with modules/lessons
  - `GET /admin/tracks/:trackId/modules` — List modules in track
  - `POST /admin/modules` — Create module
  - `PUT /admin/modules/:id` — Update module
  - `PATCH /admin/modules/reorder` — Reorder modules
  - `PATCH /admin/modules/:id/move` — Move module to different track
  - `DELETE /admin/modules/:id` — Delete module (with progress warning)
  - `GET /admin/modules/:moduleId/lessons` — List lessons in module
  - `POST /admin/lessons` — Create lesson
  - `PUT /admin/lessons/:id` — Update lesson (full update: title, content, status, etc.)
  - `PATCH /admin/lessons/reorder` — Reorder lessons
  - `POST /admin/lessons/:id/duplicate` — Duplicate lesson
  - `DELETE /admin/lessons/:id` — Delete lesson
  - `POST /admin/lessons/:id/publish` — Publish lesson + create version snapshot
  - `GET /admin/lessons/:id/versions` — List version history
  - `POST /admin/lessons/:id/restore/:versionId` — Restore from previous version
  - `POST /admin/lessons/:lessonId/resources/upload-url` — Get presigned upload URL for resource
  - `GET/POST /admin/lessons/:lessonId/resources` — List / create lesson resources
  - `PATCH /admin/lessons/:lessonId/resources/reorder` — Reorder resources
  - `DELETE /admin/resources/:id` — Delete resource
  - `POST /admin/content/images/upload-url` — Upload URL for inline editor images
  - `POST /admin/lessons/bulk-publish` — Bulk publish lessons
  - `POST /admin/lessons/bulk-move` — Bulk move lessons between modules
  - `GET /admin/content/export` — Export content structure as JSON
  - `POST /admin/content/import` — Import content from JSON
- `GET /lessons/:lessonId/resources/:resourceId/download` — Member resource download (entitlement-checked)
- **Storage:**
  - `POST /storage/uploads/request-url` — Request presigned upload URL
  - `GET /storage/public-objects/*` — Serve public assets
  - `GET /storage/objects/*` — Serve uploaded objects

### Community System

The portal includes a community discussion feature gated behind the `community:access` entitlement (mentorship-tier products). Built with categorized posts, threaded comments (one-level replies), fire reactions, badges, member directory, and notifications.

**Database Tables:**
- `community_categories` — Categorized feeds (Wins, Questions, Strategies, Introductions, Accountability, Resources, Off-Topic)
- `community_posts` — User posts with soft delete, pinning, denormalized counters
- `community_comments` — Comments with optional one-level replies (`parent_id`)
- `community_reactions` — Fire reactions (toggle) on posts or comments
- `community_badges` — User badges (newcomer, contributor, first_win, mentor, streak)
- `community_notifications` — Notifications for comments, replies, reactions, @mentions
- `users.community_bio` — Optional 200-char bio column

**Community API Routes (all under `/api/community`):**
- `GET /categories` — Active categories with post counts
- `GET/POST /posts` — Paginated feed (pinned first) + create post
- `PATCH/DELETE /posts/:postId` — Edit (15-min window) / soft delete
- `GET/POST /posts/:postId/comments` — List + create (with optional `parentId`)
- `PATCH/DELETE /comments/:commentId` — Edit (5-min window) / soft delete
- `POST /reactions` — Toggle fire reaction (post or comment)
- `GET /members` — Paginated directory (search, filter by badge, sort by activity/newest/alpha)
- `GET /members/:userId` — Profile with badges, activity stats, recent posts
- `GET /notifications` — Paginated with unread count
- `PATCH /notifications/:id/read` — Mark single as read
- `POST /notifications/read-all` — Mark all as read

**Rate Limits:** 10 posts/day, 30 comments/day per user.
**Validation:** Post content 10-5000 chars, comment max 2000 chars.

### Seed Data
Demo users (all password: Demo1234):
- Marcus Johnson (marcus@example.com) — Backroad System + 6-Month Mentorship, 12/25 lessons, 5-day streak
- Sarah Chen (sarah@example.com) — Reserve Income System (frontend only)
- Admin User (admin@bts.com) — Lifetime Mentorship, admin role

Chat seed data: 1 system prompt, 10 knowledgebase documents, 3 demo chat sessions for Marcus

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly`

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence. Entitlement resolution in `src/lib/entitlements.ts`. Auth middleware in `src/middleware/auth.ts`.

### `artifacts/portal` (`@workspace/portal`)

BTS Member Portal frontend. React + Vite with Tailwind CSS, shadcn/ui components, wouter routing, and React Query hooks from `@workspace/api-client-react`. Auth context in `src/lib/auth.tsx`.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Schema files in `src/schema/`.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec and Orval codegen config. Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec.

### `lib/integrations-anthropic-ai` (`@workspace/integrations-anthropic-ai`)

Anthropic Claude SDK client via Replit AI Integrations proxy. Provides pre-configured client and batch processing utilities. Env vars `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` and `AI_INTEGRATIONS_ANTHROPIC_API_KEY` are auto-provisioned.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec. Custom fetch includes `credentials: "include"` for cookie-based auth.
