# Workspace

## Overview

This pnpm monorepo powers the "Build Test Scale" (BTS) affiliate marketing mentorship program. It features a customer-facing member portal, an administrative dashboard, and a robust backend. The platform manages user authentication, product-based content access, community interaction, coaching, support, and affiliate commission tracking. The goal is to provide a scalable, feature-rich environment that fosters learning, community, and financial growth for BTS members, while streamlining operations and supporting program expansion. Key capabilities include personalized onboarding, AI-powered tools, dynamic content delivery, and integrated CRM synchronization with GoHighLevel.

## User Preferences

No specific user preferences were provided in the original document.

## Blitz: canonical `/blitz` + admin-only `/blitz-archive` (restyle completed by user sasha206)

**Read before modifying anything Blitz-related.** The Blitz v2 restyle is **done and promoted**. The restyled version is now the canonical **`/blitz`** ("the Blitz"). The original Blitz was retired to an admin-only **`/blitz-archive`** (gated by `AdminRoute` + `permission="content:manage"`), fully separated as a frozen backup. The old `/blitzv2` route no longer exists.

**Key facts to respect:**
- **All Blitz content updates go into the live `/blitz` only.** It is the single source of truth. Do NOT reference, edit, or mention `/blitz-archive` in normal work unless the user specifically asks you to look into the archive.
- The live `/blitz` guide (`artifacts/portal/src/pages/Blitz.tsx`) is **hand-maintained** — edit it directly. The HTML regenerator (`artifacts/api-server/src/scripts/build-blitz-from-html.ts`) is disabled (it would overwrite the live guide) and only runs if `ALLOW_BLITZ_REGEN` is set. Don't re-enable it to make edits.
- The live guide has **no Lesson Library section by design** — it was intentionally removed. Do not add it back or treat its absence as a bug.
- The in-guide video review counter marked `TEMP: REMOVE BEFORE GO-LIVE` is intentionally **kept for now** — remove only when the user asks.
- `/blitz-archive` is a frozen, admin-only backup the user intends to delete before launch; its lesson library reads a static snapshot, not the live DB. Leave it alone unless asked.

## Standing directive: publish + canary is a required close-out

Any task that changes **member-visible behavior** (portal UI, member-facing API responses, emails/SMS members receive, or anything else a member sees or experiences) is not complete until:
1. It is **published to production**, and
2. The **served bundle/response is canary-verified** to actually contain the change (not just "deploy succeeded").

This is expected **by default**, without the user needing to ask. A "Done looks like" for a member-visible task plan should include an explicit publish + canary-verify step. Canary technique: grep the live content-hashed asset for a changed string/identifier as a fast check, with rebuild-and-match-hash as the gold standard for byte-for-byte proof. (This directive exists because a past task shipped merged-but-never-published-or-verified.)

## System Architecture

The project is structured as a pnpm workspace monorepo using Node.js 24 and TypeScript 5.9.

**Frontend (`artifacts/portal`):**
-   **Technology Stack:** React, Vite, Tailwind CSS, shadcn/ui, wouter for routing, and React Query for data fetching (via Orval-generated hooks).
-   **UI/UX Design:** Features a BTS blue primary brand color (#1a56db), warm off-white background (#faf9f7), Roboto font, editorial card layouts with warm borders, and distinct product badge coloring. Full mobile responsiveness is implemented with a hamburger menu, responsive typography, mobile-first grid layouts, and a mobile header bar.
-   **Authentication & Authorization:** Custom email/password authentication with JWTs (short-lived access, longer-lived refresh tokens with rotation), bcryptjs for password hashing, account lockout, email verification, password reset, and CSRF protection. Authorization uses granular {resource}:{action} permissions and Role-Based Access Control (RBAC) for various admin roles.
-   **Entitlement System:** Access to content and features is determined by product purchases. **VIP status product (Task #1660):** `vip` is a pure status product carrying only the `vip:status` entitlement (a badge/level upgrade) — it confers no coaching, partner, or onboarding access on its own. It is ranked 6 in `PRODUCT_RANK` (above `lifetime` at 5) purely for level-badge/content-access ordering. There is no standalone VIP checkout: an admin always grants `vip` + `1year` together via the Products tab, and each carries its own independent expiry clock — VIP for 730 days, 1year (mentorship) for 365 days. If the 1year grant lapses while VIP is still active, the member keeps their VIP badge/entitlement but loses mentorship access (partner assignment ends, onboarding variant drops) since VIP alone is excluded from every rank-based mentorship/partner-eligibility check (`PARTNER_INELIGIBLE_SLUGS` in `partner-assignment.ts`, reused by `resolveOnboardingVariant` in `onboarding-variant.ts`). Granting `lifetime` later as an upsell to an existing VIP+1year member elevates their level label without re-opening onboarding or duplicating their partner assignment (lifetime is already at/above the "full" onboarding bucket and `assignRoundRobin` is a no-op once an active assignment exists). The `vip` product row is boot-seeded idempotently (`seed-vip-product.ts`).
-   **Key Pages/Features:** Includes comprehensive authentication flows, a 5-step onboarding wizard, dynamic dashboards, Core Training with progress tracking (with animated progress bars), a detailed Blitz™ campaign guide (comprehensive, path-based instructions), community feed, member directory, coaching scheduling, support center, and AI chat.
-   **Admin Panels:** Dedicated interfaces for managing members, audit logs, system health, settings, community moderation, content (tracks, modules, lessons, resources), revenue intelligence, affiliate commissions, and communications.
-   **AI Chat UI:** Provides real-time SSE streaming, session management, saved prompts for premium users, and direct support ticket creation.
-   **Branding Rule:** All content from the Cherrington Experience website must be rebranded to "Build Test Scale" / "BTS," removing all previous branding and personal imagery/mentions.

**Backend (`artifacts/api-server`):**
-   **Technology Stack:** Express 5, PostgreSQL with Drizzle ORM, Zod for validation.
-   **API Design:** OpenAPI 3.1 specification, with Orval generating client and schema code. Built using esbuild for CJS bundles.
-   **Security:** API Key authentication with granular permissions and Redis-backed sliding window rate limiting. Includes `X-Request-Id` generation. The member email-change request endpoint (`POST /members/me/email`) has its own per-user rate limit (3 per hour, 10 per day) tracked in the `email_change_attempts` table so the cap is enforced even when Redis is offline.
-   **Audit Logging:** All admin actions are logged to an `audit_log` table.
-   **Pagination:** Cursor-based pagination for API responses.
-   **Communication:** Integrates SendGrid for email and Twilio for SMS, using BullMQ for asynchronous processing, template management, and event webhooks.
-   **Background Processing:** BullMQ queues handle CRM sync, communication sequences, and revenue metric computations.
-   **Revenue Intelligence Engine:** Computes and caches over 16 revenue metrics, performs cohort analysis, member health scoring, churn/upgrade probability, funnel performance, and forecasting.
-   **Core Training Progress Tracking:** Tracks per-user completion of 6 Core Training courses.
-   **Training Content Management:** CRUD operations for tracks, modules, lessons, supporting rich text (TipTap), video embeds, resource uploads, and version history. Includes 76 pre-populated lessons.
-   **Resource Vault:** Admin-managed downloadable resources with analytics.
-   **Coaching System:** Features scheduling, 1-on-1 sessions, availability, action items, and session ratings.
-   **Community System:** Supports categorized posts, threaded comments, reactions, badges, member directory, notifications, and moderation.
-   **Affiliate Commission System:** Multi-tier rates, referral tracking, automated attribution, approval lifecycle, and fraud detection.
-   **AI Chat System:** Integrates Anthropic Claude via Replit AI for tiered access, RAG retrieval from knowledge base, SSE streaming, and session management.
-   **AI Assistant:** Uses OpenAI GPT via Replit AI for conversations, ownership-enforced access, SSE streaming, and RAG from a BTS knowledge base (Q&A, glossary, coaching/video transcripts).
-   **KB Training Document Pipeline:** Processes coaching videos (Vidalytics), video transcripts, and call transcripts (.docx) into structured knowledge base documents, including rebranding and metadata extraction. An admin review UI facilitates editing, approval, and pushing content to the knowledge base.
-   **Blitz Curriculum Map:** A 93-entry curriculum covering Build/Test/Scale phases, modules, lesson types, and network/publisher paths.
-   **Outgoing Webhooks:** BullMQ-based system for custom events with HMAC-SHA256 signing and exponential backoff retries.
-   **Member Account Page:** Allows members to manage profile details, change passwords (with session revocation), update their email address through a verification flow (current password required, confirmation link sent to the new address with a notification to the old one, all sessions revoked on confirmation), and set notification preferences.

**Dev Database Sync (Testing):**
-   Schema renames can make `drizzle-kit push` stop on an interactive prompt that hangs on non-TTY shells, silently blocking the admin-config vitest suites. `pnpm --filter @workspace/db sync-dev` (wrapper around the `lib/db/drizzle/*.sql` companion migrations + `drizzle-kit push --force`, see `lib/db/scripts/sync-dev-db.sh`) resolves this non-interactively and idempotently.
-   This sync runs automatically before the api-server vitest suite via `artifacts/api-server/vitest.globalSetup.ts`, so a fresh/recovered dev DB picks up new companion migrations without a manual step. Set `SKIP_DEV_DB_SYNC=1` to opt out for fast local iteration; it is skipped when `DATABASE_URL` is unset. The merge path (`scripts/post-merge.sh`) applies the equivalent migrations inline.
-   The `db-drift` workflow (`pnpm --filter @workspace/db test`) runs a **migrations-only** variant first via `lib/db/vitest.globalSetup.ts` (which calls `sync-dev` with `SYNC_MIGRATIONS_ONLY=1`): it applies the idempotent companion `.sql` files but **not** `drizzle-kit push --force`. This clears the schema-rename foot-gun (e.g. `community_reactions.target_type`, `users.posting_banned_at`) so the live-schema-drift test stops failing falsely, while a genuinely un-migrated schema column still surfaces as real drift (push-force would mask it). It is best-effort and obeys the same `SKIP_DEV_DB_SYNC=1` / `DATABASE_URL` skip conditions.

**Monorepo Structure:**
-   `artifacts/`: Deployable applications (API server, portal).
-   `lib/`: Shared libraries (OpenAPI spec, generated clients/schemas, Drizzle DB schema, AI integrations).
-   `scripts/`: Utility scripts.

## External Dependencies

-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **API Code Generation:** Orval
-   **Frontend Framework:** React
-   **UI Components:** shadcn/ui
-   **Styling:** Tailwind CSS
-   **Frontend Routing:** wouter
-   **Frontend Data Fetching:** React Query
-   **Task Queue/Message Broker:** BullMQ
-   **In-memory Data Store:** Redis
-   **Email Service:** SendGrid
-   **SMS Service:** Twilio
-   **AI Integration:** Anthropic Claude (via Replit AI), OpenAI GPT (via Replit AI)
-   **CRM/Marketing Automation:** GoHighLevel (Flexy app for sub-account provisioning)
-   **Payment Gateway/E-commerce:** ThriveCart (for webhooks)
-   **Password Hashing:** bcryptjs
-   **Rich Text Editor:** TipTap
-   **Video Hosting/Transcription:** Vidalytics (for training videos)
