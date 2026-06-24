---
name: Voice assistant naming/TTS phrasing control
description: How to control what the Retell voice assistant says (e.g. forcing "ninety-day" not "90 refund")
---

The Retell voice assistant's spoken wording is controlled by the NAMING rules in
the voice system prompt built in `buildVoiceSystemPrompt` (retell-agent-setup.ts),
NOT by KB content.

**Rule:** to make TTS pronounce a number/term reliably, spell it out in the prompt
the way it should be spoken (e.g. instruct the agent to say "ninety-day refund
guarantee", number as the word "ninety", "day" always present) and explicitly ban
the bad variants ("90 refund").

**Why:** members reported the assistant saying "90 refund policy" (dropping "day").
The fix is a prompt directive, not a content edit — the LLM paraphrases KB content,
so retrieval being correct does not guarantee correct spoken phrasing.

**How to apply:** edit the NAMING section of buildVoiceSystemPrompt. On the next
api-server boot the setup routine diffs the live Retell LLM prompt and re-pushes if
changed (look for `[RetellSetup] ✅ Done ... prompt_changed=true`). Reaches prod
only on publish. Same mechanism already enforces "The Blitz" naming.
