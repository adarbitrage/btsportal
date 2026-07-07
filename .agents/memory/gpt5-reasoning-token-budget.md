---
name: gpt-5 reasoning tokens eat max_completion_tokens
description: Small completion budgets on gpt-5 return EMPTY content with finish_reason=length; LLM JSON pipelines need large headroom.
---

**Rule:** gpt-5 (and other reasoning models) count hidden reasoning tokens against `max_completion_tokens`. A "reasonable" budget like `Math.min(4000, 300 + inputLen*180)` can be fully consumed by reasoning, so the API returns HTTP 200 with `finish_reason: "length"` and **empty `content`** — downstream `JSON.parse` fails, retries burn out identically, and every item lands in an `error` disposition. The AI backend looks perfectly healthy the whole time.

**Why:** Diagnosed July 2026 when the KB value screener "broke" — 100% of segments errored with "classifier error after retries" on 3 docs. A live curl repro showed empty completions with finish=length. Fix was raising the classifyChunk budget to `4000 + chunk.length * 300` (generous headroom scaling with input).

**How to apply:**
- Any `callLLM`/chat-completions call to gpt-5 that parses structured output needs a budget with thousands of tokens of headroom beyond the expected visible output. Never cap tightly.
- When an LLM pipeline suddenly 100%-errors but the provider probe is fine, check `finish_reason` and whether `content` is empty before suspecting the backend.
- Log failed classify/parse attempts (attempt count + finish reason) so this is diagnosable from workflow logs next time.
