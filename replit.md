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
-   **Pages:** Includes authentication flows (login, register, forgot/reset password), a 5-step onboarding wizard, a Welcome Home page (`/`), a dynamic dashboard (`/dashboard`), Core Training overview (`/core-training`), training library, community feed, member directory, coaching call scheduling, support center, AI chat, and comprehensive admin panels for content, users, and system management.
-   **Branding Rule:** All content brought from the Cherrington Experience website must be rebranded for BTS — no photos of Adam or his family, no mention of Adam Cherrington's name, no "Cherrington Experience" or "TCE" branding. Replace with "Build Test Scale" / "BTS" throughout.
-   **Admin Panels:** Dedicated UI for managing members, audit logs, system health, settings, community moderation, content (tracks, modules, lessons, resources), revenue intelligence, affiliate commissions, and communications.
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
-   **Training Content Management:** CRUD for tracks, modules, lessons, rich text editor (TipTap), video embeds, resource uploads, version history.
-   **Resource Vault:** Admin management of downloadable resources, collections, and analytics.
-   **Coaching System:** Scheduling, 1-on-1 sessions, availability management, action items, and session ratings.
-   **Community System:** Categorized posts, threaded comments, reactions, badges, member directory, notifications, and moderation tools.
-   **Affiliate Commission System:** Multi-tier commission rates, referral link tracking, automated attribution via webhooks, approval lifecycle, and fraud detection.
-   **AI Chat System:** Anthropic Claude integration via Replit AI, tiered access, RAG retrieval from knowledge base, SSE streaming, session management, and admin controls.
-   **Outgoing Webhooks:** BullMQ-based delivery system for custom event types, HMAC-SHA256 signing, exponential backoff retries, and admin management.

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
-   **AI Integration:** Anthropic Claude (via Replit AI Integrations)
-   **CRM/Marketing Automation:** GoHighLevel (GHL)
-   **Payment Gateway/E-commerce:** ThriveCart (for webhooks)
-   **Password Hashing:** bcryptjs
-   **Rich Text Editor:** TipTap
-   **Object Storage:** (Implicit, for lesson resources and inline editor images)
-   **Video Embeds:** YouTube, Vimeo, Wistia (supported in lesson editor)