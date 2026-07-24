---
name: Assistant portal-link renderer backstop
description: Deterministic client-side normalizer guarantees canonical portal link labels in AI assistant chat, regardless of LLM output.
---

The rule: prompt instructions alone cannot guarantee LLM link formatting — the model emitted `The Blitz ([/blitz](/blitz))` despite an explicit prompt rule forbidding it. The guarantee lives in a deterministic pre-render normalizer in the portal that rewrites malformed portal links to `[Canonical Label](/path)` using labels from the shared portal nav map, applied to assistant messages before markdown rendering.

**Why:** Prompt rules are probabilistic; the renderer-side rewrite is model-proof and was chosen INSTEAD of further prompt tightening (user asked "do we need both?" — answer was no, backstop only). Prompt changes would also require the 3-place sentinel lockstep.

**How to apply:** Only nav-map paths are touched; code spans/fences are protected; bare paths after non-label words are deliberately left alone (over-linkifying was an architect-flagged risk). If the assistant gains new render surfaces, route them through the same normalizer rather than duplicating regexes.
