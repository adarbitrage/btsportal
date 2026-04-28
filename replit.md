# Workspace

## Overview

This pnpm monorepo powers the "Build Test Scale" (BTS) affiliate marketing mentorship program. It features a customer-facing member portal, an administrative dashboard, and a robust backend. The platform manages user authentication, product-based content access, community interaction, coaching, support, and affiliate commission tracking. The goal is to provide a scalable, feature-rich environment that fosters learning, community, and financial growth for BTS members, while streamlining operations and supporting program expansion. Key capabilities include personalized onboarding, AI-powered tools, dynamic content delivery, and integrated CRM synchronization with GoHighLevel.

## User Preferences

No specific user preferences were provided in the original document.

## System Architecture

The project is structured as a pnpm workspace monorepo using Node.js 24 and TypeScript 5.9.

**Frontend (`artifacts/portal`):**
-   **Technology Stack:** React, Vite, Tailwind CSS, shadcn/ui, wouter for routing, and React Query for data fetching (via Orval-generated hooks).
-   **UI/UX Design:** Features a BTS blue primary brand color (#1a56db), warm off-white background (#faf9f7), Roboto font, editorial card layouts with warm borders, and distinct product badge coloring. Full mobile responsiveness is implemented with a hamburger menu, responsive typography, mobile-first grid layouts, and a mobile header bar.
-   **Authentication & Authorization:** Custom email/password authentication with JWTs (short-lived access, longer-lived refresh tokens with rotation), bcryptjs for password hashing, account lockout, email verification, password reset, and CSRF protection. Authorization uses granular {resource}:{action} permissions and Role-Based Access Control (RBAC) for various admin roles.
-   **Entitlement System:** Access to content and features is determined by product purchases.
-   **Key Pages/Features:** Includes comprehensive authentication flows, a 5-step onboarding wizard, dynamic dashboards, Core Training with progress tracking (with animated progress bars), a detailed Blitz™ campaign guide (comprehensive, path-based instructions), community feed, member directory, coaching scheduling, support center, and AI chat.
-   **Admin Panels:** Dedicated interfaces for managing members, audit logs, system health, settings, community moderation, content (tracks, modules, lessons, resources), revenue intelligence, affiliate commissions, and communications.
-   **AI Chat UI:** Provides real-time SSE streaming, session management, saved prompts for premium users, and direct support ticket creation.
-   **Branding Rule:** All content from the Cherrington Experience website must be rebranded to "Build Test Scale" / "BTS," removing all previous branding and personal imagery/mentions.

**Backend (`artifacts/api-server`):**
-   **Technology Stack:** Express 5, PostgreSQL with Drizzle ORM, Zod for validation.
-   **API Design:** OpenAPI 3.1 specification, with Orval generating client and schema code. Built using esbuild for CJS bundles.
-   **Security:** API Key authentication with granular permissions and Redis-backed sliding window rate limiting. Includes `X-Request-Id` generation.
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
-   **Member Account Page:** Allows members to manage profile details, change passwords (with session revocation), and set notification preferences.

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
-   **Routing (Frontend):** wouter
-   **Data Fetching (Frontend):** React Query
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
