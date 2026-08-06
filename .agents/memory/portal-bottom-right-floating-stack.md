---
name: Portal bottom-right floating stack
description: Coordination rules for the portal's fixed bottom-right controls (AI launcher, TicketDesk bubble, LiveChatCallout, FE call bar, back-to-top).
---

The member portal's bottom-right corner is a coordinated stack of fixed overlays: AI chat launcher, TicketDesk/Chatwoot bubble, LiveChatCallout, the FE "book your call" bar, and the back-to-top button.

**Rule:** the TicketDesk bubble's real position is CSS-forced in the portal's `index.css` (`bottom: 96px !important`), NOT the widget script's own default — never derive placement from widget.js. When two fixed controls must share the same vertical band, separate them horizontally (the callout is anchored left of the back-to-top column) because z-index alone makes the higher layer swallow clicks.

**Why:** a new floating control was rejected repeatedly for overlapping the chat bubble (placed off the script's default offset) and for being covered by the higher-z callout in the raised state.

**How to apply:** before adding/moving any fixed bottom-right element, read the current offsets in `index.css`, `LiveChatCallout.tsx`, and `BackToTopButton.tsx`, and keep the rendered positioning tests beside `BackToTopButton` in lockstep.
