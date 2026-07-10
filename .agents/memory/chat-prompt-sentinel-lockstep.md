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
