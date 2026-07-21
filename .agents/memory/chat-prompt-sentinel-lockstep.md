---
name: Chat system-prompt behavior-rule sentinel lockstep
description: Adding/renaming a behavior rule in the chat assistant system prompt requires 3 files changed together or boot enforcement/tests break.
---

The chat assistant's system prompt (`ANTI_HALLUCINATION_SYSTEM_PROMPT` in
`artifacts/api-server/src/lib/chat-system-prompt.ts`) is DB-stored but
boot-enforced: `ensureKBGrounding()` in `bootstrap-critical-prerequisites.ts`
overwrites the active row whenever ANY exported `*_SENTINEL` substring is
missing, so numbered "Rule N" behaviors can't silently drift away in dev or
prod.

**Rule:** a new behavior rule needs a unique `*_SENTINEL` (a phrase from the
rule's header) added in lockstep to THREE places:
1. the prompt text + the sentinel export in `chat-system-prompt.ts`,
2. the OR-chain check + import in `ensureKBGrounding()`,
3. the sentinel list/`it.each` in `__tests__/chat-blitz-naming-rule.test.ts`.

**Why:** the boot check and the test both enumerate the sentinels explicitly;
omitting the prompt→check link means the rule can drop out unnoticed, and
omitting the test means nothing guards the prompt substring. The sentinel must
be a phrase that a legacy/custom prompt can't accidentally already contain.

**How to apply:** when asked to change assistant behavior via the system prompt,
change all three or the drift guard is incomplete. Portal-page hyperlinking is
Rule 14 / `PORTAL_LINK_SENTINEL`.

**Body-edit trap:** boot enforcement only overwrites the DB row when a sentinel
substring is MISSING. Editing a rule's body text without changing any sentinel
value will NOT propagate to an already-upgraded DB row — either bump a sentinel
value or manually re-sync the active row (`UPDATE ... SET content = canonical`)
after the edit. Prod rows that still lack the new sentinel self-upgrade at next
deploy boot.

Rule map updates: Rule 12 = no-answer escalation ladder (Blitz section pointer
→ narrow with video titles → 1-on-1 session/live coaching); ladder step gating
explicitly overrides Rule 14 links until Step 3. Support-ticket/support-email
routing is banned from the prompt (Rule 5); the [SUGGEST_TICKET] mechanism
stays dormant in code/UI only.
