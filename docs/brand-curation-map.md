# Brand Curation Map — Phase 1

Per-mention classification for every "BTS" / "Build Test Scale" occurrence across the seven
member-facing training pages. The rule is simple:

- **Program mention** — the member program they enrolled in → rebrand via `brand.full` / `brand.short`
- **Feature / platform / trademark / company** — a specific named tool, trademarked service, or
  sub-brand → **leave literal**

Default when ambiguous: **literal** (over-rebranding is trademark-risky).

---

## 1. `Home.tsx`

| Location | Snippet | Classification | Treatment |
|---|---|---|---|
| Pillar 6 desc (module-level const) | `"…the BTS Concierge™."` | Trademarked feature name | **Literal** |
| Welcome paragraph | `enrolled in {brand.full} Mentorship` | Program the member joined | `brand.full` ✓ |
| Welcome card | `{brand.full} ({brand.short}) Affiliate Marketing Mentorship` | Program | `brand.full` / `brand.short` ✓ |
| Why section heading | `Why {brand.short}?` | Program | `brand.short` ✓ |
| What's in Store paragraph | `the {brand.short} program` | Program | `brand.short` ✓ |

---

## 2. `onboarding/Welcome.tsx`

No BTS / Build Test Scale occurrences. The page already uses `brand.full` (wired before this task); there are no literal "BTS" or "Build Test Scale" strings remaining in source.

---

## 3. `SevenPillars.tsx`

| Location | Snippet | Classification | Treatment |
|---|---|---|---|
| Welcome section | `{brand.full} comes in. This program is designed to…` | Program | `brand.full` ✓ |
| Pillar 2 section | `As part of your enrollment in {brand.full}` | Program (enrollment) | `brand.full` ✓ |
| Pillar 6 section | `…{brand.full} comes into play…` | Program | `brand.full` ✓ |
| Pillar 6 section | `…our dedicated **BTS Concierge™**` | Trademarked feature name | **Literal** |
| Pillar 6 section | `As part of {brand.full}, you'll have access to the BTS Concierge™` | First ref → program; second → trademark | `brand.full` ✓ / `BTS Concierge™` literal ✓ |
| Pillar 7 section | `{brand.full} provides you with the tools…` | Program | `brand.full` ✓ |

---

## 4. `CoreTraining.tsx`

| Location | Snippet | Classification | Treatment |
|---|---|---|---|
| Course 1 title | `The ${brandShort} Quick-Start Guide` | Program | `brand.short` via `getCourses()` ✓ |
| Course 1 description | `leveraging the BTS Concierge™ for done-for-you ad creation` | Trademarked feature name | **Literal** |
| Course 1 description | `the BTS Community for round-the-clock guidance` | Platform / feature name | **Literal** |
| Page hero | `{brand.full} Training` | Program | `brand.full` ✓ |

---

## 5. `PillarsToBlitz.tsx`

| Location | Snippet | Classification | Treatment |
|---|---|---|---|
| Bridge 2 body | `Media Mavens (BTS's in-house network)` — the `BTS's` possessive | Feature / platform descriptor — Media Mavens is platform-owned (BTS), not owned by any front-end brand; the descriptor stays stable across all brands | **Literal** |
| Bridge 6 body | `BTS Concierge™ — your VA team` | Trademarked feature name | **Literal** |

> **Reasoning for Bridge 2:** Media Mavens is a BTS-owned affiliate network, not a front-end
> brand asset. Saying "Reserve Income's in-house network" (or any other front-end brand name)
> would be factually wrong — those brands do not own or operate the network. The descriptor
> "BTS's in-house network" is a platform fact, not a program reference, so it must stay literal.
> Compare: `BTS Concierge™` is also a platform-owned feature and is likewise literal.

---

## 6. `QuickStartGuide.tsx`

| Location | Snippet | Classification | Treatment |
|---|---|---|---|
| Hero heading | `The {brand.short} Quick-Start Guide` | Program | `brand.short` ✓ |
| Intro paragraph | `the {brand.short} framework` | Program | `brand.short` ✓ |
| Intro paragraph | `BTS Community` (link text) | Platform / community feature name | **Literal** |
| Intro paragraph | `the BTS Concierge™` | Trademarked feature name | **Literal** |
| ToC sub-item | `Building Banner Ads & Landing Pages with {brand.short} Tools` | Program toolset | `brand.short` ✓ |
| ToC section link | `{brand.short} Support & Resources` | Program | `brand.short` ✓ |
| ToC sub-item | `The BTS Concierge™ — Done-For-You Ad Creation` | Trademarked feature name | **Literal** |
| ToC sub-item | `The BTS Community — 24/7 Access to Mentors` | Platform / community feature name | **Literal** |
| Build section | `exclusive to {brand.short} members — 100%+ commissions` | Program membership | `brand.short` ✓ |
| Build section | `{brand.short} traffic sources` | Program | `brand.short` ✓ |
| Build section | `consult the BTS Concierge™` | Trademarked feature name | **Literal** |
| Build section | `with {brand.short} Tools` (sub-heading) | Program toolset | `brand.short` ✓ |
| Build section | `Use {brand.short} proprietary tools` | Program toolset | `brand.short` ✓ |
| Build section | `The BTS Concierge™ can do it for you!` | Trademarked feature name | **Literal** |
| Support section heading | `{brand.short} Support & Resources` | Program | `brand.short` ✓ |
| Support card | `The BTS Concierge™` | Trademarked feature name | **Literal** |
| Support card | `The BTS Community` | Platform / community feature name | **Literal** |

---

## 7. `DirectEdge.tsx`

No "BTS" or "Build Test Scale" occurrences. `useBrand()` is not imported and is not needed.

---

## Classification rules summary

| Pattern | Rule |
|---|---|
| `BTS Concierge™` | Always **literal** — trademarked feature name |
| `BTS Community` | Always **literal** — named platform / community feature |
| Program enrollment / membership (`enrolled in`, `member of`, `as part of [program]`) | `brand.full` |
| Short program reference (`the [BTS] program`, `[BTS] framework`, `[BTS] tools`, `[BTS] members`) | `brand.short` |
| Organizational possessive for platform-owned sub-brands (`Media Mavens (BTS's in-house …)`) | Always **literal** — platform fact, not a program reference; the descriptor stays stable across all brands |
| Named sub-brands with their own trademark (`Media Mavens™`, `Paid Media Suite™`) | Always **literal** |
