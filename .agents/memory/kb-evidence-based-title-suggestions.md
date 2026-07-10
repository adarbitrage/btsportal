---
name: KB evidence-based title suggestions
description: Title suggestions during AI analysis are gated on measured retrieval improvement or a brand fix, plus an off-by-default auto-accept.
---

During KB analysis (`runAutoTriageOnDoc`), an LLM-proposed title is NOT surfaced
just because it differs from the stored one. Both the stored title and the
proposal are scored through the SAME retrieval self-test questions, and the
suggestion is persisted to `aiCleanedTitle` only when it is `improved`
(more passes, or a question that failed to surface now surfaces) OR `brandFix`
(stored title matches `STALE_LEGACY_PATTERNS`, proposal does not). Otherwise
`aiCleanedTitle` is written `null` and the stored title stands — everything
downstream (flags, self-test verdict, duplicate context) judges the stored
title.

**Why:** Cosmetic title churn created review noise and could silently degrade
retrieval; suggestions must earn their place with evidence.

**How to apply:**
- The comparison is stored on the standing self-test as `titleComparison`
  (same `retrievalSelfTest` jsonb column — no schema change). The review UI
  renders a plain-language "Current: X of N / Suggested: Y of N" side-by-side.
- Pure helpers live in `kb-triage.ts`: `compareTitleOutcomes` (improved /
  strictlyBetter), `titleViolatesBrandRules`, `preservesCanonicalNames`
  (CANONICAL_TITLE_TERMS = flexy/blitz/7 pillars/bts). Unit-test these directly.
- Auto-accept is an off-by-default admin setting (`system_settings` key
  `kb_title_auto_accept`, read via `isTitleAutoAcceptEnabled`, fails CLOSED).
  It fires ONLY when `strictlyBetter && preservesCanonicalNames && !violates`,
  applies the title + `aiTitleDecision:"accepted"`, and writes a
  `title_auto_accepted` row to `kbTriageAuditLogTable` (eventType is free text).
  A brand-fix-only suggestion is surfaced but never auto-accepted.
- Preserves the title-lock: `aiTitleDecision != null` ⇒ no proposal is ever
  generated (single self-test against the stored title).
- Setting routes (`GET`/`PUT /admin/knowledgebase/staging/title-auto-accept`)
  must be registered BEFORE the `GET /:id` catch-all route.
