# Workspace

## Overview

This pnpm monorepo houses a comprehensive platform for "Build Test Scale" (BTS), an affiliate marketing mentorship program. It includes a customer-facing member portal, an administrative dashboard, and a robust backend infrastructure. The platform focuses on user authentication, product-based entitlement management, community engagement, coaching, support, and affiliate commission tracking.

The business vision is to provide a scalable, feature-rich environment for BTS members, fostering learning, community, and financial growth through affiliate marketing. Key capabilities include personalized onboarding, AI-powered tools, dynamic content delivery, and integrated CRM synchronization with GoHighLevel. The project aims to enhance member experience, streamline operations, and support the expansion of the BTS mentorship program.

## User Preferences

No specific user preferences were provided in the original document.

## System Architecture

The project is structured as a pnpm workspace monorepo, utilizing Node.js 24 and TypeScript 5.9.

**Frontend (`artifacts/portal`):**
-   **Frameworks:** React, Vite, Tailwind CSS, shadcn/ui.
-   **Routing:** wouter.
-   **Data Fetching:** React Query (via Orval-generated hooks).
-   **UI/UX:** Primary brand color BTS blue (#1a56db), warm off-white background (#faf9f7), Roboto font. Editorial card layouts with warm borders. Product badges use a distinct color scheme.
-   **Authentication:** Custom email/password system with JWT access tokens (15-min httpOnly cookie expiry) and refresh tokens (7-day httpOnly cookie expiry, rotation). Features include password hashing (bcryptjs), account lockout, email verification, password reset, and CSRF protection.
-   **Authorization:** Granular `{resource}:{action}` permissions and Role-Based Access Control (RBAC) for admin roles (`super_admin`, `admin`, `support_agent`, `content_manager`).
-   **Entitlement System:** Product-based access model where users gain entitlements from purchased products. Entitlements determine access to content, features, and support levels.
-   **Pages:** Includes authentication flows (login, register, forgot/reset password), a 5-step onboarding wizard, a Welcome Home page (`/`), a dynamic dashboard (`/dashboard`), Core Training overview with progress tracking (`/core-training`), Quick-Start Guide (`/core-training/quick-start`), training library, The Blitz™ campaign guide (`/blitz`) — a comprehensive step-by-step guide with modules for Build/Test/Scale, path-based instructions (Media Mavens/ClickBank/MaxWeb × Caterpillar/Grasshopper/Crane), glossary, exit gates, and scaling methods, community feed, member directory, coaching page with live 6-day schedule + 1-on-1 BTS Concierge booking (`/coaching`), support center with general contact form (`/support/contact`), AI chat, and comprehensive admin panels for content, users, and system management.
-   **Branding Rule:** All content brought from the Cherrington Experience website must be rebranded for BTS — no photos of Adam or his family, no mention of Adam Cherrington's name, no "Cherrington Experience" or "TCE" branding. Replace with "Build Test Scale" / "BTS" throughout.
-   **Admin Panels:** Dedicated UI for managing members, audit logs, system health, settings, community moderation, content (tracks, modules, lessons, resources), revenue intelligence, affiliate commissions, and communications.
-   **Mobile Responsive:** Full mobile optimization with hamburger menu drawer navigation (slide-out sidebar), responsive padding/typography across all pages, mobile-first grid layouts, body scroll lock when drawer is open, and auto-close on navigation. Mobile header bar with BTS logo at top.
-   **AI Chat UI:** Features real-time SSE streaming, session management, saved prompts for premium users, and direct support ticket creation from chat.

**Backend (`artifacts/api-server`):**
-   **Framework:** Express 5.
-   **Database:** PostgreSQL with Drizzle ORM.
-   **Validation:** Zod for API request and response validation.
-   **API Design:** OpenAPI 3.1 specification, with Orval used for client and schema code generation (`api-client-react`, `api-zod`).
-   **Build System:** esbuild for CJS bundles.
-   **Security:** API Key authentication (`bts_{env}_{type}_{random}`) with granular permissions and rate limiting. Request ID generation (`X-Request-Id`).
-   **Rate Limiting:** Redis-backed sliding window rate limiter per API key prefix.
-   **Audit Logging:** All admin actions are logged to an `audit_log` table.
-   **Pagination:** Cursor-based pagination for API responses.
-   **Communication:** Integrated email (SendGrid) and SMS (Twilio) services with BullMQ for asynchronous processing, template management, unsubscribe handling, and event webhooks.
-   **Background Processing:** BullMQ queues for CRM sync, communication sequences, and revenue metric computations.
-   **Revenue Intelligence Engine:** Computes and caches over 16 revenue metrics (MRR, LTV, CAC, churn rates), performs cohort analysis, member health scoring, churn/upgrade probability, funnel performance, and forecasting.

**Monorepo Structure:**
-   `artifacts/`: Deployable applications (API server, portal, mockup sandbox).
-   `lib/`: Shared libraries (OpenAPI spec, generated clients/schemas, Drizzle DB schema, Anthropic AI integration).
-   `scripts/`: Utility scripts.

**Core Features:**
-   **Core Training Progress Tracking:** `course_progress` table tracks per-user completion of the 6 Core Training courses (quick-start, finding-your-edge, 21-day-blitz, live-coaching, 7-pillars, direct-edge). API routes at `/api/course-progress` (GET/POST/DELETE). CoreTraining page shows animated progress bar with percentage and checkmark toggles per course.
-   **Training Content Management:** CRUD for tracks, modules, lessons, rich text editor (TipTap), video embeds, resource uploads, version history. All 76 lessons populated with rich TipTap JSON text content covering affiliate marketing fundamentals through advanced strategies. 8 tracks published: Affiliate Marketing Foundations, Traffic & Audience Building, Advanced Strategies, Scaling & Optimization, Getting Started with BTS, Email Traffic Mastery, Optimization & Scaling, Advanced Strategies. Lesson detail view at `/training/lessons/:id` renders TipTap content (headings, paragraphs, bullet/ordered lists, callouts, bold/italic text). API `GET /lessons/:id` maps DB `textContent` → response `content` field.
-   **Resource Vault:** Admin management of downloadable resources, collections, and analytics.
-   **Coaching System:** Scheduling, 1-on-1 sessions, availability management, action items, and session ratings.
-   **Community System:** Categorized posts, threaded comments, reactions, badges, member directory, notifications, and moderation tools.
-   **Affiliate Commission System:** Multi-tier commission rates, referral link tracking, automated attribution via webhooks, approval lifecycle, and fraud detection.
-   **AI Chat System:** Anthropic Claude integration via Replit AI, tiered access, RAG retrieval from knowledge base, SSE streaming, session management, and admin controls.
-   **AI Assistant (OpenAI):** `/ai-assistant` page with OpenAI GPT integration, SSE streaming, conversation CRUD (`/api/ai-chat/*`), ownership-enforced access, and BTS knowledge base RAG (Q&A articles, glossary, 52 coaching transcripts, 97 video transcripts at `artifacts/api-server/src/knowledge-base/`). Video transcripts sourced from Vidalytics API, transcribed with OpenAI gpt-4o-mini-transcribe, and rebranded TCE→BTS. No entitlement gate — accessible to all members.
-   **KB Training Document Pipeline:** Transcript-to-training-document pipeline at `/api/admin/knowledgebase/pipeline/*` and `/api/admin/knowledgebase/staging/*`. Processes three document sources: (1) 97 raw coaching video transcripts, (2) 81 Blitz training videos from Vidalytics, and (3) 179 1-on-1 coaching call transcripts (.docx files from coaches Neil and John). Blitz pipeline downloads videos from Vidalytics API, extracts audio, transcribes with gpt-4o-mini-transcribe (with automatic chunking for >25min videos), matches to 93-lesson curriculum map, and extracts structured docs with Blitz-specific metadata. Coaching call pipeline reads .docx files, extracts WebVTT text, cleans transcripts, and runs through GPT-4o with coaching-specific prompts that extract reusable guidance while removing member-specific details. All pipelines auto-rebrand TCE→BTS. Admin review UI at `/admin/chat/knowledgebase/review` with status filters, source badges (Blitz blue, Coaching Call violet), metadata badges (phase, module, lesson, coach name), inline editing, bulk approve, merge duplicates, and push-to-KB. Push rebuilds `training-documents.txt` from all approved+pushed docs (idempotent, non-destructive) and reloads knowledge base. Seed files (`blitz-seed.json`, `coaching-seed.json`) auto-populate production database on startup. All pipeline/staging endpoints require admin auth.
-   **Blitz Curriculum Map:** Full 93-entry curriculum at `artifacts/api-server/src/routes/admin/blitz-curriculum.ts` covering Build/Test/Scale phases with modules, lesson types (conceptual/technical/strategy), network paths (universal/media-mavens/clickbank/maxweb), publisher paths (all/caterpillar/grasshopper-crane), and blitz ordering. Fuzzy matching engine handles title variations between Vidalytics and curriculum.
-   **Outgoing Webhooks:** BullMQ-based delivery system for custom event types, HMAC-SHA256 signing, exponential backoff retries, and admin management.
-   **Member Account Page:** `/account` (member-facing, sidebar-linked under "Account") consolidates profile editing (name, phone, timezone), password change, and notification preferences (smsOptIn, marketingOptIn). Backed by `GET /api/members/me`, `PATCH /api/members/me/profile` (now also accepts marketingOptIn), and `POST /api/members/me/password` (verifies current password via bcrypt, hashes new one with `BCRYPT_ROUNDS=12`, revokes ALL sessions for the user — user typically remains authenticated until short-lived access token expires).

## QA Fixes Applied

- **Vite proxy**: `artifacts/portal/vite.config.ts` proxies `/api` → `localhost:8080` for dev
- **Commission hooks**: All commission API hooks unwrap wrapped responses (`{ links: [] }` → `[]`, `{ rates: [] }` → `[]`, etc.)
- **PayoutInfo mapping**: Backend `{ payouts: [] }` mapped to frontend `PayoutInfo.history` with sensible defaults
- **Wins API contracts**: `/wins/mine`, `/wins/streak`, `/wins/summary` return `achievedCount`, `totalCount`, `percentage`, `nextMilestone`, `achievedMilestoneIds` matching frontend `WinStreakInfo`/`WinsSummary` interfaces
- **Vault entitlements**: Null/empty `requiredEntitlement` treated as accessible (public content) across all vault endpoints
- **Vault column mapping**: Backend uses `resourceType`/`previewImageUrl`/`contentHtml`/`downloadCount` (not `type`/`thumbnailUrl`/`markdownContent`/`viewCount`)
- **Community data transform**: `fetchPosts` maps backend `content`→`body`, flat `authorId`/`authorName`→`author` object
- **PostCard null safety**: Guards for null `post.body` and `post.author`
- **Chat sessions**: Response unwrapped from `{ sessions: [] }` to array

## External Dependencies

-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **API Code Generation:** Orval (from OpenAPI spec)
-   **Frontend Framework:** React
-   **UI Components:** shadcn/ui
-   **Styling:** Tailwind CSS
-   **Routing (Frontend):** wouter
-   **Data Fetching (Frontend):** React Query
-   **Task Queue/Message Broker:** BullMQ
-   **In-memory Data Store:** Redis (for rate limiting, BullMQ, ioredis)
-   **Email Service:** SendGrid
-   **SMS Service:** Twilio
-   **AI Integration:** Anthropic Claude (via Replit AI Integrations), OpenAI GPT (via Replit AI Integrations)
-   **CRM/Marketing Automation:** GoHighLevel (GHL)
    -   **Flexy app (white-labeled GHL):** Agency JWT (`GHL_CHERRINGTON_AGENCY_JWT` — base64-encoded `{apiKey, firebaseToken, userId, companyId}`) + `GHL_FLEXY_SNAPSHOT_ID` for the snapshot loaded into each new sub-account. Provisions a `Flexy - {member name}` GHL sub-account (US/Central) and a `type=account role=admin` staff user per member. The staff password is intentionally **not** persisted (`providerStaffPasswordEncrypted` stays null) — GHL emails an activation link to the member on user creation, and the member sets/manages their own password from there. `GET /apps/flexy/credentials` returns just the staff email so the portal can show members which address to log in with. The member-facing Apps card (`artifacts/portal/src/pages/Apps.tsx` → `FlexyCredentialsBlock`) consumes this endpoint via `useGetFlexyCredentials` and renders the email next to the **Open** button with a one-click copy and a "first-time? click Forgot password" hint, only when the Flexy card is in the `installed` state. **Auto-login (one-time SSO URL) is not available**: a live April 2026 probe of every plausible GHL host returned 404. The `mintFlexyLoginUrl` helper short-circuits to null by default (`GHL_LOGIN_TOKEN_PATH=""`); if GHL ever ships such an endpoint, an operator can drop in `GHL_LOGIN_TOKEN_PATH=/users/{userId}/whatever` and it starts working without a code change. The Open route therefore returns `https://dashboard.getflexy.app/` for members (or `…/v2/location/{locationId}/dashboard` for admins with `?admin=1`); members log in with their email + Flexy "Forgot password" flow on first open, then GHL's session cookie keeps them in. `FLEXY_PORTAL_URL` defaults to `https://dashboard.getflexy.app`. Full evidence + decision: `artifacts/api-server/docs/flexy-sso-verification.md`.
-   **Payment Gateway/E-commerce:** ThriveCart (for webhooks)
-   **Password Hashing:** bcryptjs
-   **Rich Text Editor:** TipTap
-   **Object Storage:** (Implicit, for lesson resources and inline editor images)
-   **Video Embeds:** YouTube, Vimeo, Wistia (supported in lesson editor)
-   **Video Hosting/Transcription:** Vidalytics (97 training videos, account ID `trR5xdVa`)