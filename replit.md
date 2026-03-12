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

### Pages
- **Dashboard** (`/`) — Welcome banner, stats cards, training progress, upcoming calls, announcements
- **Training Library** (`/training`) — Tracks, modules, lessons with progress tracking
- **Coaching Calls** (`/coaching`) — Upcoming/past calls, coach profiles, tier-gated access
- **Support Center** (`/support`) — Ticket management with message threads

### Design
- Primary brand color: BTS blue (#1a56db)
- Background: warm off-white (#faf9f7)
- Font: Roboto (modern sans-serif)
- Editorial card layout with warm borders (#e8e4dc)
- Tier system: Bronze, Silver, Gold, Diamond

### Database Tables
- `tiers` — Membership tier definitions
- `users` — Member profiles with tier references
- `tracks` — Training tracks
- `modules` — Modules within tracks
- `lessons` — Individual lessons within modules
- `progress` — User lesson completion tracking
- `coaches` — Coach profiles
- `coaching_calls` — Scheduled coaching sessions
- `tickets` — Support tickets
- `ticket_messages` — Message threads on tickets
- `announcements` — Portal announcements

### API Routes (all under `/api`)
- `GET /dashboard` — Aggregated dashboard data
- `GET /tiers` — List membership tiers
- `GET /tracks` — List tracks with modules and progress
- `GET /modules/:id` — Module detail with lessons
- `GET /lessons/:id` — Single lesson
- `GET/POST /progress` — Track/mark lesson completion
- `GET /coaching-calls` — List coaching calls (supports `?upcoming=true`)
- `GET /coaches` — List coaches
- `GET/POST /tickets` — List/create support tickets
- `GET /tickets/:id` — Ticket with message thread
- `POST /tickets/:id/messages` — Add message to ticket
- `GET /announcements` — List announcements

### Seed Data
Demo user: Marcus Johnson (Gold tier, 12 of 20 lessons completed, 5-day streak)

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

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

### `artifacts/portal` (`@workspace/portal`)

BTS Member Portal frontend. React + Vite with Tailwind CSS, shadcn/ui components, wouter routing, and React Query hooks from `@workspace/api-client-react`.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Schema files in `src/schema/`.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec and Orval codegen config. Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec.
