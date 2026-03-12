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
- **Auth**: Custom email/password with JWT access tokens + refresh tokens (httpOnly cookies), bcryptjs + API key auth (`bts_{env}_{type}_{random}`)
- **Rate Limiting**: Redis-backed sliding window rate limiter (standard: 60/min, elevated: 300/min, unlimited)
- **CRM Sync**: GoHighLevel (GHL) bidirectional sync via BullMQ queue + ioredis (rate-limited 90 req/min, exponential backoff retries)
- **Communication Sequences**: Automated multi-step email/SMS flows via BullMQ (sequence engine every 5 min, scheduled comms every 15 min, nightly inactivity check at 2am)

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

**Auth middleware** (`artifacts/api-server/src/middleware/auth.ts`): Verifies JWT from `access_token` cookie OR `Authorization: Bearer bts_...` API key header. Sets `req.userId`, `req.userEmail`, and optionally `req.apiKeyContext`. Public paths bypass auth.

**API Key Auth**: Keys follow format `bts_{environment}_{type}_{random}` (e.g., `bts_live_sk_a1b2c3...`). Two types: `secret` (full access) and `publishable` (read-only). Key is shown once at creation, stored as bcrypt hash. Supports granular permissions (`members:read`, `training:write`, `*`, etc.) and rate limit tiers.

**Request ID**: Every API request gets a UUID v4 `requestId` via `X-Request-Id` header (`artifacts/api-server/src/lib/api-errors.ts`).

**Rate Limiting**: Redis-backed sliding window per API key prefix (`artifacts/api-server/src/middleware/rate-limiter.ts`). Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Tier`.

**API Request Logging**: API key requests logged to `api_request_log` table (`artifacts/api-server/src/middleware/api-request-logger.ts`).

**Permissions**: Granular `{resource}:{action}` permission checking (`artifacts/api-server/src/middleware/permissions.ts`). Usage: `requirePermission("members:read")`.

**Pagination**: Cursor-based pagination helper (`artifacts/api-server/src/lib/pagination.ts`). Returns `{ data, pagination: { hasMore, nextCursor, previousCursor, total } }`.

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
- **AI Chat** (`/chat`) — Full-width AI chat page with session sidebar, SSE streaming, markdown rendering, saved prompts (Lifetime), and support ticket creation from chat
- **Chat Widget** — Floating chat bubble on all authenticated pages (bottom-right), expandable 380px panel with the same chat features, hidden on `/chat` page. Requires `chat:ai` entitlement.
- **Admin: Community Categories** (`/admin/community/categories`) — Create, edit, reorder, deactivate categories
- **Admin: Content Moderation** (`/admin/community/moderation`) — View/pin/feature/delete posts
- **Admin: Community Analytics** (`/admin/community/analytics`) — Engagement metrics dashboard

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

### Admin Content Management
Admin CMS pages for managing training content (tracks, modules, lessons):

**Admin Pages:**
- **Content Management** (`/admin/content/tracks`) — Tree view of all tracks with expandable modules/lessons, create/edit/archive/duplicate tracks, create/edit/delete/move modules, create lessons, bulk publish/move
- **Lesson Editor** (`/admin/content/lessons/:id/edit`) — Full lesson editor with TipTap rich text, video embed preview (YouTube/Vimeo/Wistia), resource file upload, action items checklist editor, settings panel (status/sort/duration), autosave every 30s, version history panel, preview mode

**Admin Components** (`artifacts/portal/src/components/admin/`):
- `RichTextEditor.tsx` — TipTap editor with full toolbar (bold, italic, underline, strikethrough, headings H2-H4, lists, blockquote, code blocks, images, links, YouTube embeds, tables, callout boxes, horizontal rules, text alignment)
- `VideoEmbed.tsx` — Parses YouTube/Vimeo/Wistia URLs and renders responsive 16:9 iframe embeds
- `ResourceUpload.tsx` — Drag-and-drop file upload with file list, size/type display, remove/reorder
- `ActionItemsEditor.tsx` — Add/remove/reorder checklist items
- `VersionHistory.tsx` — Version list with preview and restore capabilities

**Admin API Layer** (`artifacts/portal/src/lib/admin-api.ts`):
Custom React Query hooks for admin content CRUD operations (tracks, modules, lessons, versions, bulk operations). Uses `/api/admin/content/*` endpoints.

**Route Protection:**
- `AdminRoute` component in `App.tsx` checks user's role === "admin"
- Admin nav section in Sidebar only visible to admin role users

**Member Lesson View** (`/training/lessons/:id`):
- `LessonView.tsx` — Renders TipTap JSON content as styled HTML, responsive video embeds, downloadable resources with entitlement checks, action item checklists

**Dependencies Added:**
- TipTap packages (react, starter-kit, extensions for underline, link, image, table, code-block-lowlight, placeholder, text-align, youtube, horizontal-rule)
- @dnd-kit (core, sortable, utilities)
- lowlight

### Design
- Primary brand color: BTS blue (#1a56db)
- Background: warm off-white (#faf9f7)
- Font: Roboto (modern sans-serif)
- Editorial card layout with warm borders (#e8e4dc)
- Product badge colors: Frontend=#6b7280, LaunchPad=#92400e, 3-Month=#b45309, 6-Month=#d97706, 1-Year=#0891b2, Lifetime=purple gradient

### Admin Support Ticket UI

Admin-facing support ticket management pages accessible at `/admin/*` routes. All pages use a dedicated `AdminLayout` with its own sidebar navigation. Currently uses mock data (backend APIs pending).

**Pages:**
- `/admin/tickets` — Priority queue sorted by SLA urgency (breached > approaching > within), then VIP tier, then priority, then age. Color-coded rows (red/orange/green). Filters: status, category, agent, tier, SLA status. Bulk actions: assign, close, categorize with confirmation dialogs.
- `/admin/tickets/:id` — Ticket detail with internal notes (yellow background), canned response picker modal (categorized, searchable, variable auto-replacement), internal note toggle, and ticket merge dialog.
- `/admin/routing-rules` — CRUD for auto-routing rules with drag-and-drop reordering, enable/disable toggle.
- `/admin/canned-responses` — CRUD for response templates grouped by category (tabbed), with variable documentation and live preview.
- `/admin/agent-performance` — Per-agent metrics: tickets handled, response/resolution times, SLA compliance, satisfaction. Bar chart + radar chart comparison.
- `/admin/analytics` — Overall support analytics: ticket volume trends (line chart), status breakdown (bar chart), SLA compliance by tier, category pie chart, satisfaction distribution, busy hours heatmap.

**Key files:**
- `artifacts/portal/src/pages/admin/` — All admin page components
- `artifacts/portal/src/components/layout/AdminLayout.tsx` — Admin sidebar layout
- `artifacts/portal/src/lib/admin-mock-data.ts` — Mock data and TypeScript interfaces

### Database Tables
- `users` — Member profiles with auth fields, onboarding state, GHL contact ID, communication preferences (sms_opt_in, marketing_opt_in)
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
- `coaches` — Coach profiles with timezone, max_daily_sessions, one_on_one_enabled, meet_link, average_rating, total_ratings
- `coaching_calls` — Scheduled group coaching sessions with `required_entitlement`
- `coach_availability` — Recurring weekly availability windows per coach (day_of_week, start_time, end_time, timezone)
- `coach_availability_overrides` — Date-specific availability overrides (blocked days, custom hours)
- `coaching_sessions` — 1-on-1 coaching sessions with booking, cancellation, rescheduling, notes, action items, reminders
- `coaching_ratings` — Session ratings (1-5) with denormalized average on coaches
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
- `affiliate_profiles` — Affiliate profiles linked to users, with tier, balances, click/conversion stats, fraud flags
- `commission_rates` — Commission rate table: rate_percent + flat_bonus per (tier × product) combination
- `referral_links` — Per-affiliate-per-product referral link tracking with click/conversion counts
- `referral_clicks` — Individual click events with IP dedup, user agent, referer
- `commissions` — Individual commission records with status lifecycle (pending → approved → paid | reversed | rejected)
- `commission_payouts` — Aggregated payout records for affiliate payouts
- `affiliate_resources` — Promotional resources (email swipes, social templates, banners) for affiliates
- `api_keys` — API key records with bcrypt hash, prefix, type (secret/publishable), permissions (JSONB), rate_limit_tier, revocation tracking
- `api_request_log` — API request log with request_id, method, path, status, response time, API key reference
- `sequences` — Communication sequence definitions (slug, trigger_event, product_type, active flag)
- `sequence_steps` — Individual steps within sequences (channel, template_ref, subject, delay_minutes, conditions JSONB)
- `sequence_enrollments` — User enrollments in sequences (status, current_step_order, enrolled_at, metadata)
- `community_categories` — Discussion categories with sort_order, is_active, posts_count
- `community_posts` — Community posts with is_pinned, is_featured, is_deleted, deleted_by
- `community_comments` — Threaded comments with parent_id nesting
- `community_reactions` — User reactions (fire type) on posts/comments
- `community_badges` — Achievement badges (newcomer, contributor, mentor, streak, first_win)
- `community_notifications` — In-app notification system for mentions, comments, reactions
- `win_milestones` — Pre-defined milestone types for win tracking (21 default: revenue, campaign, skill, lifestyle, custom categories) with slug, icon, category, sort_order, xp_reward
- `wins` — Member win submissions linked to milestones, with proof images, revenue metrics, community sharing, testimonial pipeline fields (requested/text/approved), curation status (published/featured/hidden/draft), and community post cross-reference
- `tool_categories` — Tool category definitions
- `tools` — Tool registry (slug, type, config, required entitlement, status)
- `tool_user_data` — Per-user per-tool saved data
- `tool_usage_log` — Tool usage event log
- `tool_daily_usage` — Daily rate limit counters per user per action
- `webhook_subscriptions` — Outgoing webhook subscriptions (name, target_url, secret, event_types, auto-disable after 3 days of failures)
- `webhook_deliveries` — Outgoing webhook delivery log (subscription_id, event_type, event_id, payload, status, http_status, response_body, retry tracking)

### Onboarding Flow

New members (`onboarding_complete === false`) are redirected to a 5-step onboarding wizard:
1. **Welcome** (`/onboarding/welcome`) — Personalized greeting, product list, optional welcome video
2. **Documents** (`/onboarding/documents`) — Scroll-enforced Membership Agreement + Terms of Service with typed signature
3. **Profile** (`/onboarding/profile`) — Name, phone, timezone (auto-detected), experience level, primary goal, SMS opt-in
4. **Orientation** (`/onboarding/orientation`) — Dynamic display of owned entitlements vs. upgrade options
5. **Quick Start** (`/onboarding/quick-start`) — Product-tier-specific first mission, quick links preview, "Go to My Dashboard" button

Progress is saved per step (`onboarding_step` column). Server-side validates prerequisites (docs must be signed before step 2 advances, profile fields required before step 3). Step 5 completion sets `onboarding_complete = true`.

**Out of scope (TODO placeholders):** PDF generation, canvas signature, admin panel for document editing.

### Communication Tables
- `email_templates` — Email templates with slug, subject, html/text body, category (transactional/marketing)
- `sms_templates` — SMS templates with slug, body, variables
- `communication_log` — Log of all sent emails/SMS with status tracking (queued, sent, delivered, bounced, etc.)
- `email_unsubscribes` — Marketing email unsubscribe records with resubscribe support
- `email_bounces` — Email bounce tracking (hard/soft) with auto-suppression logic

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
- `POST /webhooks/sendgrid` — SendGrid event webhook (delivery, open, click, bounce, unsubscribe, spam)
- `POST /webhooks/twilio` — Twilio delivery status webhook
- `GET /email/unsubscribe` — One-click unsubscribe (public, token-verified, CAN-SPAM compliant)
- `POST /email/resubscribe` — Opt back into marketing emails (authenticated, own email only)
- `GET /members/me/communications` — Member communication history (authenticated)
- `POST /dev/simulate-purchase` — Dev-only simulated purchase (disabled in production)
- `POST /dev/simulate-refund` — Dev-only simulated refund (disabled in production)
- `POST /dev/simulate-cancellation` — Dev-only simulated cancellation (disabled in production)
- `GET /coaching/one-on-one/status` — Member's booking eligibility, frequency, usage
- `GET /coaching/one-on-one/coaches` — Coaches offering 1-on-1 sessions
- `GET /coaching/one-on-one/coaches/:id/slots` — Available time slots for a coach
- `POST /coaching/one-on-one/book` — Book a 1-on-1 session (transactional, race-condition safe)
- `GET /coaching/one-on-one/sessions` — List member's sessions
- `GET /coaching/one-on-one/sessions/:id` — Session detail with rating
- `PATCH /coaching/one-on-one/sessions/:id/cancel` — Cancel session (24h+ = credit returned)
- `POST /coaching/one-on-one/sessions/:id/reschedule` — Reschedule session (transactional)
- `PATCH /coaching/one-on-one/sessions/:id/action-items` — Toggle action item completion
- `POST /coaching/one-on-one/sessions/:id/rate` — Rate a completed session (1-5)
- `POST /admin/run-expiration-check` — Nightly expiration check for time-limited products (admin-only)
<<<<<<< HEAD
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
- `GET /admin/coaching/sessions` — List all coaching sessions with filters (admin-only)
- `PATCH /admin/coaching/sessions/:id` — Update session status/notes (admin-only)
- `POST /admin/coaching/sessions/:id/return-credit` — Return credit for a session (admin-only)
- `POST /admin/coaching/run-nightly` — Run nightly auto-complete + reminders (admin-only)
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
- **Outgoing Webhooks (admin-only):**
  - `GET /admin/outgoing-webhooks/event-types` — List available event types
  - `GET /admin/outgoing-webhooks` — List subscriptions with delivery stats
  - `POST /admin/outgoing-webhooks` — Create subscription (generates HMAC secret)
  - `GET /admin/outgoing-webhooks/:id` — Get subscription details
  - `PUT /admin/outgoing-webhooks/:id` — Update subscription (name, URL, events, active)
  - `DELETE /admin/outgoing-webhooks/:id` — Delete subscription (cascade deletes deliveries)
  - `POST /admin/outgoing-webhooks/:id/rotate-secret` — Rotate signing secret
  - `POST /admin/outgoing-webhooks/:id/test` — Send test ping event
  - `GET /admin/outgoing-webhooks/:id/deliveries` — Delivery history per subscription (filtered)
  - `GET /admin/outgoing-webhook-deliveries` — All deliveries across subscriptions (filtered)
  - `POST /admin/outgoing-webhook-deliveries/:id/retry` — Retry a failed delivery

### Outgoing Webhooks System

BullMQ-based outgoing webhook delivery engine. When events fire in the BTS system, matching webhook subscriptions receive signed HTTP POST payloads.

**Event Types:** `member.created`, `member.verified`, `training.lesson_completed`, `training.module_completed`, `commission.earned`, `commission.paid`, `ticket.created`, `ticket.resolved`, `ticket.closed`, `community.post_created`, `community.comment_created`, `test.ping`

**Signature:** HMAC-SHA256 with headers `X-BTS-Webhook-Id`, `X-BTS-Webhook-Timestamp`, `X-BTS-Webhook-Signature`

**Retry:** Exponential backoff (30s, 2m, 15m, 1h, 6h — up to 5 attempts). Auto-disables subscription after 3 consecutive days of failures.

**Key files:**
- `lib/db/src/schema/webhook-subscriptions.ts` — Subscription table schema
- `lib/db/src/schema/webhook-deliveries.ts` — Delivery log table schema
- `artifacts/api-server/src/lib/webhook-events.ts` — Event emitter (`emitWebhookEvent()`)
- `artifacts/api-server/src/lib/outgoing-webhook-queue.ts` — BullMQ delivery engine
- `artifacts/api-server/src/routes/admin-outgoing-webhooks.ts` — Admin API routes

### AI Chat System

Uses Anthropic Claude (via Replit AI Integrations) for an AI chat assistant with:
- **3 chat tiers**: configurable per-tier rate limits stored in `chat_rate_limits` table (defaults: basic 20/day 1000 tokens, full 50/day 2000 tokens, custom 100/day 4000 tokens)
- **RAG retrieval**: PostgreSQL full-text search (tsvector/GIN) on knowledgebase_docs, filtered by tier-accessible categories
- **SSE streaming**: Real-time response streaming via `POST /chat`
- **Session management**: Conversation history with configurable depth per tier
- **Saved prompts**: Custom prompt templates for chat:custom users (max 20)
- **Ticket creation**: Create support tickets from chat context (chat:full/chat:custom)
- **System prompt**: Admin-editable, stored in DB with template variables ({{member_name}}, {{chat_tier}}, {{daily_limit}}), version history support

Integration package: `lib/integrations-anthropic-ai` (`@workspace/integrations-anthropic-ai`)

- **Admin Chat Panel** (`/admin/chat/*` routes, `admin-chat.ts`):
  - `GET /admin/chat/analytics` — Chat usage metrics (today/week/month/total counts, tier breakdown, peak hours, flagged count)
  - `GET /admin/chat/sessions` — Browse transcripts (paginated, filterable by search/userId/date/flagged/ticketCreated)
  - `GET /admin/chat/sessions/:id` — Full transcript with messages
  - `PATCH /admin/chat/messages/:id/flag` — Flag/unflag a message
  - `PATCH /admin/chat/messages/:id/notes` — Add admin notes to a message
  - `GET /admin/chat/system-prompts` — List all prompt versions
  - `POST /admin/chat/system-prompts` — Create new prompt version
  - `PATCH /admin/chat/system-prompts/:id/activate` — Activate prompt (transactional)
  - `POST /admin/chat/system-prompts/preview` — Preview prompt with test message
  - `GET /admin/chat/knowledgebase` — List knowledgebase docs
  - `POST/PUT/DELETE /admin/chat/knowledgebase` — CRUD for knowledgebase docs
  - `GET /admin/chat/rate-limits` — Get per-tier rate limit config
  - `PUT /admin/chat/rate-limits/:id` — Update rate limit config
  - Frontend pages: `ChatAnalytics.tsx`, `ChatTranscripts.tsx`, `SystemPrompts.tsx`, `Knowledgebase.tsx`, `RateLimits.tsx`

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
- **Public API:**
  - `GET /v1/health` — Service health check (database, Redis, SendGrid, Twilio status)
  - `GET /admin/api-keys` — List all API keys (admin-only)
  - `POST /admin/api-keys` — Create API key, returns plaintext once (admin-only)
  - `PATCH /admin/api-keys/:id` — Update key metadata/permissions (admin-only)
  - `POST /admin/api-keys/:id/revoke` — Revoke API key (admin-only)
- **Admin UI:** Settings → API Keys page at `/settings/api-keys` (admin-only)
- `GET /tools` — List tools with access state (requires software entitlement)
- `GET /tools/:slug` — Tool detail with config and user entitlements
- `GET /tools/:toolId/data` — List user's tool data
- `POST /tools/:toolId/data` — Save/upsert user tool data
- `POST /tools/:toolId/usage` — Log tool usage
- `POST /tools/headline-generator/generate` — AI headline generation (rate-limited)
- `POST /tools/campaign-calculator/analyze` — AI campaign analysis (expanded tier, rate-limited)

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
- `GET /go/:productSlug?ref=:affiliateCode` — Public referral redirect with click tracking and bts_ref cookie (30-day)
- **Commission Member Routes** (require `commissions:*` entitlement):
  - `GET /commissions/dashboard` — Affiliate dashboard summary
  - `GET /commissions/earnings` — Paginated earnings list with filters
  - `GET /commissions/referral-links` — Referral links with per-link stats
  - `GET /commissions/payouts` — Payout history
  - `GET /commissions/leaderboard` — Top affiliates leaderboard
  - `GET /commissions/rates` — Commission rate table
  - `GET /commissions/resources` — Promotional resources
  - `GET/PATCH /commissions/profile` — Affiliate profile (read/update PayPal email)
  - `POST /commissions/profile/tax-form` — Submit tax form URL
  - `GET /commissions/chart` — Earnings chart data
- **Commission Admin Routes** (require admin role):
  - `GET /admin/commissions` — All commissions with pagination/filters
  - `POST /admin/commissions/:id/approve|reject|reverse` — Commission lifecycle management
  - `POST /admin/commissions/run-approval` — Bulk approve commissions older than 30 days
  - `POST /admin/commissions/generate-payouts` — Generate payouts above threshold
  - `GET /admin/commissions/payouts` — All payouts
  - `POST /admin/commissions/payouts/:id/mark-paid` — Mark payout as paid
  - `GET /admin/affiliates` — List all affiliates
  - `PATCH /admin/affiliates/:id` — Update affiliate status/tier/fraud flags
  - `GET/POST/PUT/DELETE /admin/commissions/rates` — CRUD commission rates
  - `GET/POST/PUT/DELETE /admin/commissions/resources` — CRUD affiliate resources
  - `GET /admin/commissions/fraud-alerts` — Flagged commissions and affiliates

### Commission System

The affiliate commission system lets mentorship members earn referral commissions. Key components:
- **Tier resolution**: `commissions:top` > `commissions:premium` > `commissions:mid` > `commissions:entry` (from entitlements)
- **Affiliate profiles**: Auto-created when a user gains a commission entitlement
- **Referral tracking**: `/go/:productSlug?ref=:code` sets a 30-day `bts_ref` cookie with 5-min IP dedup
- **Commission attribution**: ThriveCart `order.success` webhook checks for `bts_ref` in custom fields, resolves rate, creates pending commission
- **Refund reversal**: `order.refund` reverses pending/approved commissions for the order
- **Approval lifecycle**: pending → approved (after 30 days) → in_payout → paid
- **Fraud detection**: Self-referral rejection, same-domain email flagging, high-click-low-conversion flagging
- **Config env vars**: `BTS_REF_COOKIE_DAYS`, `CLICK_DEDUP_MINUTES`, `COMMISSION_APPROVAL_DAYS`, `PAYOUT_THRESHOLD_CENTS`
- **Key files**: `lib/db/src/schema/affiliate-profiles.ts`, `commission-rates.ts`, `referral-links.ts`, `referral-clicks.ts`, `commissions.ts`, `commission-payouts.ts`, `affiliate-resources.ts`, `artifacts/api-server/src/lib/commissions.ts`, `routes/commissions.ts`, `routes/admin-commissions.ts`, `routes/referral-redirect.ts`

### Communications Infrastructure

Central communication system using SendGrid (email) and Twilio (SMS) with BullMQ queue processing.

**Key files:**
- `artifacts/api-server/src/lib/communication-service.ts` — Central `CommunicationService` with `queueEmail`, `queueSms`, `sendEmailNow`, `queueBroadcastEmail`
- `artifacts/api-server/src/lib/communication-worker.ts` — BullMQ workers for async email/SMS processing (3 retries, exponential backoff)
- `artifacts/api-server/src/lib/redis.ts` — Redis/IORedis connection management
- `artifacts/api-server/src/lib/seed-templates.ts` — Seeds 28 email templates (16 transactional + 12 marketing) + 7 SMS templates
- `artifacts/api-server/src/routes/communication-webhooks.ts` — SendGrid/Twilio event webhooks
- `artifacts/api-server/src/routes/email.ts` — Unsubscribe/resubscribe endpoints
- `artifacts/api-server/src/routes/member-communications.ts` — Member communication history
- `lib/db/src/schema/communications.ts` — Drizzle schema for all communication tables

**Environment variables (required for real sends):**
- `SENDGRID_API_KEY` — SendGrid API key
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — Twilio credentials
- `REDIS_URL` — Redis connection URL (required for BullMQ workers)
- `FROM_EMAIL_TRANSACTIONAL` — Transactional email from address (default: noreply@buildtestscale.com)
- `FROM_EMAIL_MARKETING` — Marketing email from address (default: team@buildtestscale.com)
- `PORTAL_URL` — Portal base URL for links in emails
- `UNSUBSCRIBE_SECRET` — HMAC secret for unsubscribe token generation

**Behavior without env vars:** All email/SMS calls gracefully skip sending and log to console. BullMQ workers only start if `REDIS_URL` is set. The system falls back to direct sends if Redis/BullMQ is unavailable.

**Template variable syntax:** `{{variable_name}}` — Common vars: `member_name`, `portal_url`, `support_email`, `company_name`, `current_year`

**Bounce handling:** Hard bounce → immediate suppression. Soft bounce → suppress after 3 in 7 days. All marketing sends check suppression before sending.

### Software & Tools System

An "internal app store" gated by `software:base`/`software:expanded` entitlements. Tools are registered in a DB-backed registry with category organization, access control, and usage tracking.

**Database Tables:**
- `tool_categories` — Tool categories with slug, description, icon, sort order
- `tools` — Tool registry with slug, type (builtin/external/embedded), config (JSON), required entitlement, status (active/beta/coming_soon)
- `tool_user_data` — Per-user per-tool data storage (favorites, saved calculations, etc.)
- `tool_usage_log` — Usage event logging (open, generate, etc.)
- `tool_daily_usage` — Daily rate limit tracking per user per action

**Tool Types:**
- `builtin` — React component rendered inline (config.component maps to component registry)
- `external` — Opens external URL in new tab
- `embedded` — Renders external URL in iframe with fullscreen toggle

**Built-in Tool Components** (`artifacts/portal/src/components/tools/`):
- `HeadlineGenerator` — AI-powered headline generation via Claude (claude-haiku-4-5), with rate limiting (5/day base, 25/day expanded)
- `CampaignCalculator` — ROI/breakeven/projection calculator with AI campaign analysis (expanded tier only, 15/day)
- `TrackingUrlBuilder` — UTM parameter builder with traffic source presets (FB, Google, TikTok, Native, Email, YouTube)

**Access States:**
- `granted` — User's entitlement matches tool's requiredEntitlement
- `locked` — Tool requires `software:expanded` but user only has `software:base` (shows upgrade prompt)
- `hidden` — User lacks any software entitlement

**Seeded Data:** 6 categories, 8 tools (3 active base, 2 expanded, 3 coming-soon)

**API Routes:**
- `GET /tools` — List all tools with access state
- `GET /tools/:slug` — Tool detail with config, userEntitlements
- `GET /tools/:toolId/data` — List user's saved data for a tool
- `POST /tools/:toolId/data` — Save/update user tool data (upsert by dataKey)
- `POST /tools/:toolId/usage` — Log usage event
- `POST /tools/headline-generator/generate` — AI headline generation with rate limiting
- `POST /tools/campaign-calculator/analyze` — AI campaign analysis (expanded tier only)

**AI Integration:** Uses Anthropic Claude (claude-haiku-4-5) via Replit AI Integrations proxy (`lib/integrations-anthropic-ai/`). No API key needed.

**Frontend Pages:**
- `/tools` — Tool listing with category tabs, search, featured section, access-gated cards
- `/tools/:slug` — Tool detail with dynamic component loading, locked state, external/embedded support

**Sidebar:** Wrench icon, conditional on `software:base` entitlement

**Dashboard Widget:** Shows recent tools with links to tool detail pages

### Seed Data
Demo users (all password: Demo1234):
- Marcus Johnson (marcus@example.com) — Backroad System + 6-Month Mentorship, 12/25 lessons, 5-day streak [affiliate: marcus01, tier: mid]
- Sarah Chen (sarah@example.com) — Reserve Income System (frontend only, no commission access)
- Admin User (admin@bts.com) — Lifetime Mentorship, admin role [affiliate: btsteam, tier: top]
- Jake Rivera (jake@example.com) — 1-Year Mentorship [affiliate: jaker23, tier: premium]
- Lisa Thompson (lisa@example.com) — 3-Month Mentorship [affiliate: lisat55, tier: entry]

Commission seed data: 32 rates (4 tiers × 8 products), 4 affiliate profiles, 32 referral links, 250 clicks, 28 commissions, 3 payouts, 10 promotional resources

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

**Admin Commission Panel** (`/admin/commissions/*`): Full admin UI for affiliate program management with 7 sub-pages:
- Overview — summary stats, quick actions (run approval, generate payouts, export CSV)
- All Commissions — filterable/sortable/paginated commission table with approve/reject/reverse actions
- Payouts — payout batch list with mark-paid workflow
- Affiliates — affiliate profile management with pause/unpause, edit tier/status, view tax form
- Rates — editable commission rates grid grouped by tier with add/edit/delete
- Resources — CRUD for promotional materials (email swipes, social posts, banners, guidelines)
- Fraud Alerts — tabbed view of flagged commissions, flagged affiliates, and suspicious click patterns

Key files: `src/lib/commission-admin-api.ts` (API layer), `src/components/layout/CommissionAdminLayout.tsx` (layout with sub-nav), `src/pages/admin/Commission*.tsx` (7 pages).

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
