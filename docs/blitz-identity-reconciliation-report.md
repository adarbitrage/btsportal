# Blitz Identity Reconciliation — Gap & Collision Report

**Workstream:** Blitz Identity Reconciliation (foundation of the *Blitz AI Knowledge* initiative — see `docs/blitz-ai-knowledge-roadmap.md`).
**Map:** `artifacts/api-server/src/lib/blitz-identity-map.ts` (code-owned, drift-guarded by `artifacts/api-server/src/__tests__/blitz-identity-map-drift.test.ts`).

This report lets a reviewer eyeball coverage and correctness before the later workstreams build on the crosswalk. It is generated from the same data as the map; if the map changes, regenerate the numbers.

## What the map reconciles

There are three disconnected Blitz numbering systems:

| System | Where | Numbering | Member-facing? |
|---|---|---|---|
| AI Source Knowledge reference docs | `ai_source_documents` (`source_type='reference_docs'`, 96 rows) | `The Blitz™ Lesson — 3.18b: …` | No (mining input only) |
| `blitz_lessons` | 94 granular rows | `lesson_id` `3.18b` + `phase`/`module`/`blitz_order` | No |
| `/blitz` guide | `@workspace/blitz-curriculum` | **23 sections** (ids 1–23), `sectionAnchor` (`s6c`), `courseId` (`blitz-hub-step-v2-N`) | **Yes — the only thing a member clicks** |

The map resolves each of the **96** reference docs (94 `blitz_lessons` + 2 core-training prose docs) to exactly one canonical member-facing section, and attaches that section's Process node via `BLITZ_SECTION_TO_NODE`.

### Why the mapping is by content, not by the video map

The task anticipated a structural bridge lesson→section via the guide video map (`getBlitzLessonsForVideo`). In practice the seed lessons' `source_video_id`s (81 distinct) **do not overlap** the current guide HTML's video ids (48) at all — the video bridge resolves **0/94** lessons, because the member guide was rebuilt with new Vidalytics ids after these lessons were captured. The crosswalk is therefore resolved by `lesson_id` / `phase` / `module` / title-and-content judgment. This is expected and documented, not a defect.

## Coverage by canonical section

96 source docs across 23 sections:

| # | Phase | Step | Section title | Anchor | Node | Sources |
|---|-------|------|---------------|--------|------|--------:|
| 1 | intro | Introduction | What Is Affiliate Arbitrage? | s1 | foundations | 2 |
| 2 | intro | Before You Start | Understand the System — The Three Phases, Your Budget, and the Phase Gates | s2 | foundations | 3 |
| 3 | build | Overview | How Phase 1 Works — Campaign Architecture and Your Path | s3 | foundations | **1** |
| 4 | build | Network Selection | Choose Your Affiliate Network | s4 | network-and-offer | **1** |
| 5 | build | Product Selection | Select Your Offer and Get Your Affiliate Link | s5 | network-and-offer | 3 |
| 6 | build | Creative Assets | Understanding Creative Assets — The Foundation of Your Campaign | s6 | creative-assets | 6 |
| 7 | build | Creative Assets | Create Your Native Ad Assets | s6b | creative-assets | 3 |
| 8 | build | Creative Assets | Create Your Landing Page Assets — Media Mavens | s6c | creative-assets | 5 |
| 9 | build | Creative Assets | Create Your Landing Page Assets — ClickBank | s6d | creative-assets | 9 |
| 10 | build | Compliance | Submit Your Assets for Compliance Review | s7 | compliance | 2 |
| 11 | build | Flexy™ Setup | Setting Up Your Website in Flexy™ | s8 | tracking-and-setup | 4 |
| 12 | build | DIYTrax Setup | Set Up DIYTrax | s9 | tracking-and-setup | 4 |
| 13 | build | MetricMover™ | Using MetricMover™ | s8b | tracking-and-setup | 22 |
| 14 | build | Go Live | Configure Caterpillar and Go Live | s10 | launch | 14 |
| 15 | test | Testing — Getting Started | Find Your Winners Through Data | s11 | testing | 2 |
| 16 | test | Round 1 · Min. $500 | Find Your Top Performing Headline | s12 | testing | 5 |
| 17 | test | Between Rounds 1 and 2 | Prepare Additional Static Images While Round 1 Runs | s13 | testing | 8 |
| 18 | test | Round 2 · Min. $500 | Find Your Top Performing Visual Creative | s14 | testing | **1** |
| 19 | test | Between Rounds 2 and 3 | Prepare Your Round 3 Placement Format Assets | s15 | testing | **0** |
| 20 | test | Round 3 · Min. $1,000 | Find Your Top Performing Placement Format | s16 | testing | **0** |
| 21 | scale | Method 1 | Increase Budget on Your Top Performing Placement | s17 | scaling | **1** |
| 22 | scale | Method 2 | Test New Placements and Publishers | s18 | scaling | **0** |
| 23 | scale | Method 3 | Master Publisher | s19 | scaling | **0** |

**Total: 96.**

## Gaps — canonical sections with NO source-doc coverage

These member sections have zero reference docs. The assistant will be able to *name* the section (from the curriculum skeleton) but has no mined source material to synthesize concept/lesson content from until the corpus grows.

| # | Section | Why it's empty |
|---|---------|----------------|
| 19 | Between Rounds 2 and 3 — Prepare Your Round 3 Placement Format Assets | The seed curriculum's test phase stops after "Preparing for Round 2"; no Round-3-prep lessons were captured. |
| 20 | Round 3 — Find Your Top Performing Placement Format | No Round 3 execution lessons in the seed. |
| 22 | Scaling Method 2 — Test New Placements and Publishers | The only scale-phase source is a single overview doc. |
| 23 | Scaling Method 3 — Master Publisher | Same — no dedicated scale-method lessons captured. |

## Thin coverage — sections resting on a single source doc

Flagged so reviewers know these are lightly supported (one doc each):

| # | Section | Sole source |
|---|---------|-------------|
| 3 | How Phase 1 Works — Campaign Architecture and Your Path | `Publisher Overview — Know Your Options` |
| 4 | Choose Your Affiliate Network | `2.1: Choose Your Affiliate Network` |
| 18 | Round 2 — Find Your Top Performing Visual Creative | `10.7: How to Create Ads and Launch Round 2` |
| 21 | Scaling Method 1 — Increase Budget | `Phase 3: SCALE — Multiplying Your Profits` |

## Judgment-call mappings (source docs that don't map to one clean home)

Each carries a `caveat` code in the map (`BLITZ_MAPPING_CAVEATS`):

- **`grasshopper-crane`** — the member `/blitz` guide is **Caterpillar-only**; it has no dedicated section for the Grasshopper/Crane secondary publishers or their banner workflow. These docs are mapped to the nearest equivalent Caterpillar section but represent supplemental-publisher content with no true member-facing home:
  - `4.5: Creating Ad Banner Variants for Testing` → §7 (Native Ad Assets)
  - `7B.2`–`7B.8` (7 Go-Live lessons) → §14 (Configure Caterpillar and Go Live)
  - `Understanding the Testing Reality — Grasshopper & Crane` → §15
  - `What's Working Now — Grasshopper/Crane Round 1 Recommendations` → §16
- **`round2-launch`** — `10.7: How to Create Ads and Launch Round 2` → §18. It is the only source touching Round 2 *execution*; the rest of the internal "Preparing for Round 2" module maps to §17 (Between Rounds 1 and 2).
- **`publisher-options`** — `Publisher Overview — Know Your Options` → §3. Traffic-source/publisher options have no dedicated member section; filed under the Phase 1 overview.
- **`conceptual-def`** — `Definitions: Landing Pages, Bridge Pages, Jump Pages, VSLs` → §6. A conceptual definitions doc, filed under the Creative Assets *foundation* rather than a hands-on landing-page section.
- **`core-training`** — the two prose docs are not Blitz lessons; each is mapped to the nearest foundations section:
  - `The 7 Pillars™ of a Profitable Digital Business (Core Training)` → §1
  - `What The Blitz™ Is — And Why It's Built the Way It Is (Core Training)` → §2

## `blitz_order` collisions (internal ordering, informational only)

`blitz_lessons.blitz_order` is **not** a stable key — distinct lessons share an order value. The crosswalk keys on the reference-doc title / `lesson_id`, never on order, so these collisions don't affect the map. Documented in `BLITZ_ORDER_COLLISIONS`:

| order | lessons sharing it |
|------:|--------------------|
| 27 | `3.18a: How to Use the Bridge Page Bot`, `3.19: Choosing a Jump Page Base to Clone` |
| 28 | `3.20: Create Your Landing Page Base Copy`, `3.18b: How to Generate Jump Page Body Copy` |

Also note: **13** of the 94 lessons carry a `null` `lesson_id` (strategy/overview docs like `Your Blitz Roadmap`, `Publisher Overview`); they are keyed by title. All 94 lesson **titles** are unique (the numeric prefix keeps `3.17a` vs `3.17b` distinct), so title is a safe key.
