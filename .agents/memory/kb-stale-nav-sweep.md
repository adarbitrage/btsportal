---
name: One-time stale-nav sweep for KB review queue
description: Manual-only sweep flagging stale old-portal navigation in needs_review synthesis drafts; main must run it once after merge.
---
The stale-navigation sweep (`artifacts/api-server/src/scripts/sweep-stale-nav.ts`) is MANUAL-ONLY by explicit decision — never wire it into boot or a scheduler.

**Why:** it retroactively appends NAVIGATION CONFLICT reviewer callouts (deterministic crosswalk re-screen + LLM audit vs the current portal nav map) to drafts already sitting in the needs_review queue; the human review gate stays absolute and nothing is rewritten.

**How to apply:** run once after merge, in DEV (the review queue lives there; prod never runs the pipeline), via a console workflow so AI secrets are present: `npx tsx artifacts/api-server/src/scripts/sweep-stale-nav.ts`. Idempotent — safe to re-run; exits 1 if any LLM audit errored. The LLM audit ignores in-tool (DIYTrax/Flexy/etc.) and external-site (ClickBank, Media Mavens) navigation by prompt contract. Short "What is X?" definition drafts now get the same nav grounding as main drafts, and the crosswalk knows "BTS Software"→/apps and "Compliance Form"→/compliance.
