---
name: Kickoff-coach tiering (LaunchPad vs full)
description: How kickoff-coach round-robin pools are partitioned by member tier and why the "no coach available" state must never silently fall back or 404.
---

Kickoff-coach round-robin selection is partitioned into tier buckets (e.g. a LaunchPad-only bucket vs the standard bucket) keyed off the member's current entitlement tier, derived at call time rather than stored on the user.

**Why:** the business rule is a hard tier wall — a member in one tier must never land on another tier's coach, even transiently, and there is deliberately no cross-tier fallback if a tier's coach roster is momentarily unconfigured (e.g. a new coach's calendar hasn't been wired up yet).

**How to apply:** when a tier has no active, fully-configured coach, both the availability and booking endpoints must return a successful (200) response with an explicit "setup pending" signal — never a 404, never a silently empty slot list, and never routing to another tier's coaches. Seed/bootstrap logic for such rosters must never let a placeholder value clobber a real one already saved through the admin UI — only overwrite when the seed itself carries a real value. If a new column added to a shared DB package doesn't typecheck ("Property does not exist on type ...Table..."), rebuild the composite lib packages first before assuming the code is wrong — see `monorepo-typecheck-cache.md`.

Once a roster row's seed value is armed with a REAL calendar ID (no longer a null placeholder), the "never clobber" branch stops applying to that row — the seed then always re-syncs it on every boot, same as any other fully-configured coach. Tests written against the old "null placeholder" era (asserting a tier's pool has exactly N coaches, or asserting a tier is entirely unconfigured) must isolate by deactivating every OTHER real active coach in that tier for the test's duration and reactivating in a `finally`, or the newly-armed real row silently joins the pool and breaks count-based assertions.
