# BTS Portal — AI Assistant Category Cards Build Spec

**Reference:** Builds on the existing AI Chat Assistant (BTS PRD Spec #4 — Claude + RAG, streaming SSE, tiered access). That system is already deployed with 175 KB documents indexed.
**Goal:** Replace the four hardcoded suggestion pills on the AI Assistant empty state with a structured category-card system that drills into pre-curated, KB-verified questions.
**Stack:** Express.js + Drizzle + PostgreSQL / React + Vite + Tailwind + shadcn/ui + TanStack Query

---

## Design Summary

### Member Flow
1. Member opens AI Assistant → sees the same greeting + groups of cards below it.
2. Cards are organized into **groups** (e.g., "Portal Navigation," "Getting Started," "Apps & Tools").
3. Cards the member is entitled to → full color, clickable.
4. Cards the member is NOT entitled to → greyed/locked with a small lock icon. Click triggers an upgrade modal pointing to the cheapest product granting access.
5. Click an entitled card → cards collapse; ~30 sub-questions for that card display as a scrollable list with a back arrow.
6. Click a sub-question → the question is sent through the existing AI chat pipeline as the user's first message; RAG retrieves from the KB, Claude streams the answer.
7. After the answer, the member can keep typing free-form follow-ups in the same thread (existing chat behavior).

### Admin Flow
- Full CRUD on groups, cards, and questions.
- Per-card entitlement key + "if locked, upgrade product" target.
- **"Generate Questions" AI tool** per card: admin selects which KB documents/tags belong to the card → Claude proposes 40–50 candidate questions → each candidate is tested through the existing RAG pipeline → top 30 by retrieval confidence are returned to the admin for review/edit/approve. This is Adam's quality gate: every shipped question must be answerable from the KB.

### Category List (Built by Replit at Build Time)
Replit agent should inspect the live portal nav + the BTS knowledge base tags during the build task and seed a reasonable starter set:
- **Portal Navigation:** Dashboard, Account & Billing, Coaching, Community, Resources, Earn
- **Getting Started:** general onboarding, first-week tasks, 7 Pillars overview, Blitz introduction
- **The Blitz:** one card OR sub-categories — agent decides based on Blitz module structure (81 videos)
- **Apps & Tools:** one card per app in Tools & Apps section (DIYTrax, MetricMover, etc. — agent reads the live nav)

Admin can adjust everything post-launch.

---

## Dependency Graph

```
TIER 1 (parallel):  Task 1 (Schema + Member API + Admin CRUD API)
                    Task 2 (AI Question Generator service)
TIER 2 (parallel):  Task 3 (Member empty state UI)
                    Task 4 (Admin UI — groups/cards/questions CRUD)
                    Task 5 (Admin UI — Generate Questions tool)
TIER 3:             Task 6 (Routing + nav integration + seed)
```

---

## Task 1: Schema + Member API + Admin CRUD API

### What This Does
Stands up the data model, member-facing read endpoint, and admin CRUD endpoints. Does NOT include the AI generator (Task 2) — just storage + CRUD.

### Files Created
- `shared/schema/assistant-cards.ts`
- `server/routes/assistant-cards.ts` — member-facing endpoint
- `server/routes/admin/assistant-cards.ts` — admin CRUD
- `server/storage/assistant-cards.ts` — DB access methods

### Files Modified
- `shared/schema.ts` — `export * from './schema/assistant-cards'`
- `server/index.ts` — register `/api/assistant/cards` and `/api/admin/assistant`

### Schema
**`assistant_card_groups`**
- `id, label (varchar), slug (varchar, unique), description (text, nullable), sort_order (int), is_active (boolean default true), created_at, updated_at`

**`assistant_cards`**
- `id, group_id (fk), label (varchar), description (text, nullable), icon_name (varchar, default 'sparkles' — lucide-react icon name), sort_order (int), entitlement_key (varchar, nullable — null means visible to all), upgrade_product_id (fk products, nullable — what to push if locked), is_active (boolean default true), created_at, updated_at`

**`assistant_card_questions`**
- `id, card_id (fk), question_text (text), sort_order (int), source_kb_doc_ids (jsonb default []), generated_by (enum: manual|ai default manual), retrieval_confidence (numeric, nullable — populated only by AI-gen + verification flow), is_active (boolean default true), created_at, updated_at`

### Member API
- `GET /api/assistant/cards` — auth required. Returns:
  ```json
  {
    "groups": [
      {
        "id": 1,
        "label": "Apps & Tools",
        "sort_order": 3,
        "cards": [
          {
            "id": 5,
            "label": "DIYTrax",
            "description": "Campaign tracker setup and reports",
            "icon_name": "bar-chart-3",
            "locked": false,
            "entitlement_key": "software:base",
            "upgrade_product": null,
            "questions": [
              { "id": 12, "question_text": "How do I set up my first DIYTrax campaign?" },
              ...
            ]
          },
          {
            "id": 7,
            "label": "MetricMover",
            "locked": true,
            "entitlement_key": "software:expanded",
            "upgrade_product": { "id": 6, "name": "BTS 6-Month Mentorship", "price_cents": 297000 },
            "questions": []  // empty when locked — don't leak question list
          }
        ]
      }
    ]
  }
  ```
- `locked` is computed server-side using `resolveEntitlements(userId)` (existing function from the entitlement engine).
- Locked cards never include questions in the payload (no leakage).

### Admin API (all require admin role)
- `GET /api/admin/assistant/groups` — list
- `POST /api/admin/assistant/groups` — create
- `PATCH /api/admin/assistant/groups/:id`
- `DELETE /api/admin/assistant/groups/:id` — soft delete (set `is_active=false`)
- `POST /api/admin/assistant/groups/reorder` — body: `{ ordered_ids: [3,1,2] }`
- `GET /api/admin/assistant/cards?group_id=`
- `POST /api/admin/assistant/cards`
- `PATCH /api/admin/assistant/cards/:id`
- `DELETE /api/admin/assistant/cards/:id`
- `POST /api/admin/assistant/cards/reorder`
- `GET /api/admin/assistant/cards/:cardId/questions`
- `POST /api/admin/assistant/cards/:cardId/questions` — manual create (sets `generated_by='manual'`)
- `PATCH /api/admin/assistant/questions/:id`
- `DELETE /api/admin/assistant/questions/:id`
- `POST /api/admin/assistant/cards/:cardId/questions/reorder`

### Dependencies
None — fully independent.

### Acceptance Criteria
- A member with no `software:base` entitlement gets `locked: true` on the DIYTrax card with empty questions array.
- An admin's GET returns the same shape but `locked` always false (admins see everything).
- Reorder endpoints update `sort_order` correctly and atomically.
- Soft-deleted groups/cards/questions don't appear in member GET but DO appear in admin GET with a `is_active: false` flag.

### Implementation Notes
- Use existing `resolveEntitlements` (entitlement engine, already built).
- `upgrade_product_id` should be the cheapest product granting the required entitlement — admin sets this manually per card.
- Icon names: use lucide-react names. Provide a list of suggested icons in the admin UI (Task 4) but accept any valid name.

---

## Task 2: AI Question Generator Service

### What This Does
Backend service + endpoint that takes a card + a set of KB documents, generates candidate questions via Claude, verifies each one through the existing RAG pipeline, and returns the top 30 by confidence.

### Files Created
- `server/services/assistantCards/questionGenerator.ts` — orchestrator
- `server/services/assistantCards/questionVerifier.ts` — RAG verification
- `server/routes/admin/assistant-generator.ts` — endpoint

### Files Modified
- `server/index.ts` — register the generator route

### Schema
None.

### Endpoint
- `POST /api/admin/assistant/cards/:cardId/generate-questions`
  - Body: `{ kb_doc_ids?: number[], kb_tags?: string[], target_count?: number (default 30) }`
  - Returns: `{ candidates: [{ question_text, source_kb_doc_ids, retrieval_confidence }, ...], discarded_count }`
  - Does NOT persist — admin reviews in the UI (Task 5) and approves the ones they want.
  - On approve: admin calls `POST /api/admin/assistant/cards/:cardId/questions` with `generated_by='ai'` and the retrieval_confidence value.

### Generator Algorithm
1. Load the specified KB docs (by id) or all docs matching the tags.
2. Chunk them (or use existing chunks from RAG index).
3. Build a Claude prompt that includes the card label, description, and a representative sample of KB content (~6000 tokens of content max).
4. Ask Claude to produce 40–50 candidate questions a real BTS member would ask about this topic, each answerable from the provided content. Output as JSON array.
5. Model: `claude-sonnet-4-5-20250929` (quality matters here; not Haiku).
6. For each candidate, call the existing RAG retrieval function with the question and grab the top retrieval score.
7. Sort candidates by score, take top `target_count`.
8. Return.

### System Prompt for Claude (Generator)
```
You are helping admins of an affiliate marketing mentorship platform (Build, Test, Scale)
curate suggested questions for their AI Assistant.

You will be given:
- A card label and description (the topic area)
- A sample of knowledge base content related to that topic

Your job: generate 40–50 questions a real member would actually ask about this topic.

Rules:
- Each question must be answerable from the provided knowledge base content.
- Phrase questions as a member would naturally type them (casual, first-person).
- Mix difficulty: some basic "how do I..." questions, some intermediate troubleshooting,
  a few advanced strategy questions.
- Avoid yes/no questions — favor "how", "what", "when", "why".
- Avoid duplicate questions or near-duplicates.

Respond ONLY with a JSON array of strings — no preamble, no markdown.
```

### Dependencies
- Existing RAG retrieval function (from PRD Spec #4 — already built).
- Existing KB document storage (175 docs already indexed).

### Acceptance Criteria
- Endpoint returns within ~15s for a typical card (40 candidates × RAG verify).
- Discarded candidates (low retrieval score, threshold ~0.5) are filtered out and counted in `discarded_count`.
- Re-running the generator on the same card may return different candidates each time (Claude is non-deterministic) — that's expected.

### Implementation Notes
- This is a long-running request — bump server timeout for this route to 60s.
- If RAG verification fails for >50% of candidates, return what's there but include a `warning` in the response so the admin knows the KB might be sparse for that topic.
- Run RAG verifications in parallel batches of 5 to keep latency reasonable.

---

## Task 3: Member Empty State UI

### What This Does
Replaces the four hardcoded suggestion pills on the AI Assistant empty state with the card-and-questions UI.

### Files Created
- `client/src/components/assistant/empty-state.tsx` — top-level container
- `client/src/components/assistant/card-groups.tsx` — renders all groups + cards
- `client/src/components/assistant/category-card.tsx` — single card (with locked/upgrade variant)
- `client/src/components/assistant/question-list.tsx` — sub-questions view after card click
- `client/src/components/assistant/upgrade-modal.tsx` — shown when locked card is clicked
- `client/src/hooks/useAssistantCards.ts` — TanStack Query hook

### Files Modified
- `client/src/pages/ai-assistant.tsx` (or wherever the AI Assistant page lives) — replace existing suggestion pills with `<EmptyState />`

### Frontend Behavior
- Empty state shows below the greeting only when the current chat session has zero messages.
- Once the user sends a message (via card click OR free type), the cards disappear and standard chat UI takes over.
- **Card click (entitled):** smooth transition — cards fade out, question list fades in. Back arrow at top returns to cards.
- **Card click (locked):** upgrade modal opens. Title: "[Card Label] requires [Product Name]". Body: short pitch + price. CTA: "Upgrade" button linking to ThriveCart checkout for `upgrade_product_id`.
- **Question click:** the question text is sent through the existing chat send function — same code path as if the user typed it manually. Card empty state hides, normal chat begins.
- Loading state for `useAssistantCards`: skeleton cards (3 group rows × 4 cards each).
- Error state: hide the empty state entirely, show "Suggestions unavailable — type below to start a chat" fallback.
- Mobile: cards stack single-column, questions same.

### Visual
- Match existing portal dark theme (the screenshot shows a dark chat panel inside a light page).
- Card: rounded, dark surface, icon top-left (lucide-react), label + 1-line description, hover lifts slightly.
- Locked card: 40% opacity, small lock icon top-right, "Upgrade to unlock" microcopy at the bottom.
- Group header: small uppercase label + thin separator.
- Question list: each question a tappable row, hover highlights, arrow icon right.

### Dependencies
Depends on: Task 1 (member API exists).

### Acceptance Criteria
- Empty state renders within 500ms on a warm cache.
- Locked card shows lock icon + opens upgrade modal on click, never reveals questions.
- Clicking a question sends it to the existing chat endpoint (verify by checking the chat history records the message correctly).
- Back arrow on question list returns to cards without losing scroll position.

### Implementation Notes
- The question-click handler should call whatever function the existing free-type input calls to submit a message — do not duplicate the send logic.
- Cards should not re-render when the chat starts; the empty state component just unmounts when `messages.length > 0`.

---

## Task 4: Admin UI — Groups, Cards, Questions CRUD

### Files Created
- `client/src/pages/admin/assistant/groups.tsx` — top-level groups list with reorder
- `client/src/pages/admin/assistant/cards.tsx` — cards within a group (`/admin/assistant/groups/:groupId/cards`)
- `client/src/pages/admin/assistant/questions.tsx` — questions within a card (`/admin/assistant/cards/:cardId/questions`)
- `client/src/components/admin/assistant/group-form.tsx`
- `client/src/components/admin/assistant/card-form.tsx` — includes entitlement dropdown + upgrade product picker + icon picker
- `client/src/components/admin/assistant/question-form.tsx`
- `client/src/components/admin/assistant/sortable-list.tsx` — reusable drag-and-drop component (use `@dnd-kit/sortable`)

### Files Modified
None.

### Frontend Behavior
- Three-level breadcrumb nav: Groups → [Group Name] → Cards → [Card Name] → Questions.
- Drag-to-reorder at all three levels, calls the reorder endpoint on drop.
- Card form fields:
  - Group (dropdown)
  - Label, description, icon (icon picker — searchable lucide-react names with previews)
  - Entitlement key (dropdown from the existing 22 entitlement keys, or "None / visible to all")
  - Upgrade product (dropdown from `products` table — only enabled when entitlement key is set)
  - Is active toggle
- Question form: just textarea + active toggle. Source KB doc IDs are populated automatically when created via AI generator.
- Show `generated_by` badge on each question row ("Manual" or "AI-Generated • 0.82 confidence").

### Dependencies
Depends on: Task 1.

### Acceptance Criteria
- Admin can create a group, add a card to it, add questions to the card — all from the UI.
- Drag-reorder persists after refresh.
- Setting an entitlement key requires choosing an upgrade product (or accepting null — show a warning that locked-state members will see no upgrade CTA).
- Soft-deleted items can be toggled back to active.

---

## Task 5: Admin UI — Generate Questions Tool

### Files Created
- `client/src/components/admin/assistant/generate-questions-modal.tsx` — modal triggered from the Questions page
- `client/src/components/admin/assistant/kb-doc-picker.tsx` — searchable multi-select of KB documents

### Files Modified
- `client/src/pages/admin/assistant/questions.tsx` — add a "Generate Questions with AI" button at the top

### Frontend Behavior
- Button on Questions page: "Generate Questions with AI"
- Opens modal:
  - Step 1: pick KB documents (search + multi-select) OR specify KB tags
  - Step 2: target count (default 30)
  - Step 3: "Generate" button → shows loading state (this takes ~15s, show progress message: "Claude is generating candidate questions...", then "Verifying against knowledge base...")
  - Step 4: returned candidates display as a checkable list, sorted by confidence score (badge next to each: 0.92, 0.81, etc.). Each row editable in place. Admin checks the ones they want.
  - Step 5: "Add Selected" button → POSTs each checked candidate to `POST /api/admin/assistant/cards/:cardId/questions` with `generated_by='ai'` + the retrieval_confidence.
- Modal supports cancel at any step.
- If the API returns a `warning` (sparse KB), display a yellow notice.

### Dependencies
Depends on: Task 2 (generator endpoint exists) AND Task 4 (Questions page exists to add the button to — careful, this means Task 4 and Task 5 modify a file in dependency order: Task 4 creates the page, Task 5 adds the button to it).

### Sequencing Note
Since Task 5 modifies a file Task 4 creates, run Task 4 FIRST and Task 5 after. Or fold Task 5 into Task 4 if both are short enough. Recommendation: keep them split, run Task 4 then Task 5 sequentially.

### Acceptance Criteria
- Admin can generate, review, edit, and save AI-suggested questions in one flow.
- Saved questions appear in the Questions list with the "AI-Generated" badge and confidence score.

---

## Task 6: Routing + Nav Integration + Seed

### Files Modified
- `client/src/App.tsx` — add admin routes:
  - `/admin/assistant/groups`
  - `/admin/assistant/groups/:groupId/cards`
  - `/admin/assistant/cards/:cardId/questions`
- Admin sidebar (existing portal-layout or similar) — add admin nav group "AI Assistant" with one item: "Card Library" (links to /admin/assistant/groups).
- AI Assistant page — verify the empty state component is wired in (should be from Task 3, but final sanity check).

### Files Created
- `server/seed/assistant-cards.ts` — seeds the starter category structure on first run.

### Seed Logic
**Replit agent: read the live portal sidebar nav AND the BTS knowledge base tags during this task to seed an appropriate starter set.** Recommended starting structure:

```
Group: "Portal Navigation"  (visible to all — no entitlement gate)
  - Dashboard
  - Account & Billing
  - Community
  - Coaching
  - Resources
  - Earn (Commissions)

Group: "Getting Started"  (visible to all)
  - First Week Checklist
  - 7 Pillars Overview
  - Blitz Introduction
  - Setting Up Your Profile

Group: "Training"  (entitlement: content:frontend)
  - The Blitz  (entitlement: content:advanced — LaunchPad+ only)
  - 7 Pillars
  - Tips & Tricks

Group: "Apps & Tools"  (mostly entitlement: software:base — LaunchPad+)
  - One card per app the agent finds in the live Tools & Apps nav
    (DIYTrax, MetricMover, Compliance Review, etc.)
```

Seed groups + cards only. Questions left empty — admin uses the Generate tool (Task 5) to populate.

### Dependencies
Depends on: Tasks 3, 4, 5.

### Acceptance Criteria
- All admin routes render.
- Admin nav shows "AI Assistant → Card Library" for admins only.
- Seed runs idempotently (won't duplicate on re-deploy).
- After seeding, member-facing empty state shows the seeded groups with empty questions on each card (or hide cards with zero questions — flag for Adam).

### Implementation Notes
- Cards with zero questions: hide on member side OR show with "Coming soon" microcopy. Default: hide. Admin can verify after Q&A is generated.

---

## Out of Scope (Future)

- Member-side search across all questions ("What can I ask?" search bar)
- Question analytics (which questions get clicked most → surface popular ones)
- Per-member personalized question ranking based on chat history
- Multi-language question variants
- Card images (icons only in v1)
- Drag-and-drop reorder via touch on mobile admin
