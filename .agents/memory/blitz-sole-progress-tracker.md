---
name: Blitz is the sole progress tracker; Training Library retired
description: Pre-launch decision — Blitz completion is the only progress signal; legacy Training Library is decoupled and admin-only.
---

# Blitz is the sole progress tracker

**Decision (pre-launch):** The legacy Training Library (Tracks/Modules/Lessons — `/training`,
`/core-training`, `Training.tsx`, `CoreTraining.tsx`, `ModuleDetail.tsx`, `LessonView.tsx`, the
`progress` table, `/api/progress`) is being **retired from member-facing BTS functionality**. It is
kept ONLY as an admin-only visual reference for possible future reuse. Blitz lesson completion is the
single source of truth and trigger for "progress."

**Why:** Portal has NOT launched yet; all accounts are test accounts. Owner is streamlining the
backend before launch and wants one progress system (Blitz), not two parallel ones.

**How to apply:**
- Don't re-couple the Training Library into member flows. Keep its routes admin-gated.
- Anything that currently reads the legacy `progress` table as a progress/engagement signal should be
  repointed at Blitz completion (`course_progress`, `blitz-hub-step-v2-N`). Known consumers to migrate:
  `lib/member-health.ts` (legacy lessons ~20% of health score), `lib/churn-upgrade-scoring.ts`,
  `routes/dashboard.ts` (member home stats — dashboard is being hidden at launch anyway),
  `routes/admin-panel.ts` member detail "lessons completed" stat.
- Onboarding copy (Welcome / QuickStart / Orientation) currently funnels members to the Training
  Library — must be repointed to Blitz or 7 Pillars (owner to decide; reminder owed).

**Blitz curriculum cleanup golden rule:** When consolidating the 23-step list to a DB source of truth,
**do NOT change the courseId format `blitz-hub-step-v2-N` or the 23 ids** — existing `course_progress`
rows key off them. The phases already live in `blitz_phases` (auto-seeded via `ensurePhasesSeed()` in
`routes/blitz-progress.ts`); reconcile with it rather than double-seeding. The 80% phase-gate threshold
stays hardcoded for now (owner deferred making it configurable).
