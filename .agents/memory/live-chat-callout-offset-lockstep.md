---
name: Live-chat callout offset lockstep
description: TicketDesk bubble is pinned at bottom 96px; the attention callout's bottom offset must clear it.
---

The portal pins the TicketDesk bubble at `bottom: 96px !important` (`.woot-widget-bubble` in portal index.css) so it clears the AI chat launcher. The bubble renders ~64px tall, so its top edge is ~160px.

**Why:** the LiveChatCallout attention pointer must sit fully above the bubble (arrow pointing down at it) — a callout at bottom-24 (96px) overlaps the bubble. Default is `bottom-44` (176px), `raised` (FE call bar visible) is `bottom-56`.

**How to apply:** if the index.css widget offset or launcher stack changes, update LiveChatCallout's bottom classes + its class-contract test in lockstep. Any mockup-sandbox preview simulating the bubble must use bottom:96px, not the widget's stock 20px.
