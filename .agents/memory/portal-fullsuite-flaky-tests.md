---
name: Portal full-suite flaky tests
description: Which portal vitest tests flake under full-suite load and how to tell it's not your change
---

Running the whole portal suite (`pnpm --filter @workspace/portal test`) can fail a
rotating set of timing/date-sensitive tests purely from concurrency load, while the
same tests pass when run in isolation.

Observed flaky files (pass alone, fail under full suite):
- src/pages/admin/__tests__/CoachingCalls.templates.test.tsx
- src/components/voice/__tests__/PastCalls.test.tsx ("custom date-range UI")
- src/pages/admin/__tests__/MemberDetail.emailAttemptsPaging.test.tsx
- src/pages/admin/__tests__/SystemHealth.moderationFailuresCard.test.tsx

**Why:** vitest runs many jsdom suites in parallel; these admin/date tests are
sensitive to event-loop/timer scheduling under load. Validation also reruns the
whole suite, so the same green diff can pass one validation run and fail the next.

**How to apply:** if validation reports a portal-test failure in one of these files
and your diff doesn't touch that component, re-run the file(s) in isolation
(`cd artifacts/portal && pnpm exec vitest run <file>`). If they pass alone, treat the
full-suite failure as flaky/environment-blocked, not a regression.
