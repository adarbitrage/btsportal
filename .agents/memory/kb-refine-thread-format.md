---
name: KB refine-thread persisted format
description: How refine chat turns are persisted/rebuilt and the delimiter + cap contract
---
The AI Document Review refine chat has no thread table — turns are rebuilt from `kb_triage_audit_log.aiReasoning` rows shaped `…per instruction: <instr> — <assistant>`.

**Rules:**
- The portal parser splits on the FIRST ` — ` after `per instruction:`; the backend must neutralize any ` — ` inside the reviewer's instruction (em→en dash via `neutralizeThreadDelimiter`) before persisting, or rebuilt turns garble.
- Persistence caps ARE the visible reply length after reload (live JSON response is full-length, but reload shows only what was persisted). Caps were raised to instruction 2000 / assistant 12000; never re-tighten them or long replies truncate again (the "response got truncated" bug).
- `redrafted` rows persist instruction-only (no ` — `), so the parser shows them as a single assistant bubble — intentional.

**Why:** user-visible truncation on long discussion replies was traced to a 1200-char persistence cap, not the LLM token budget (refine gets 12000 tokens).
**How to apply:** any new refine-mode persistence must use the neutralizer + generous caps and keep the `per instruction: … — …` shape in lockstep with the portal parser.
