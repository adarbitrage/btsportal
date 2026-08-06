---
name: Live-chat callout offset lockstep
description: TicketDesk chat widget renders in an OPEN SHADOW ROOT — page CSS can never restyle it; repositioning must be injected into the shadow root, and bubble + panel + callout + back-to-top geometry move in lockstep.
---

The TicketDesk widget is NOT Chatwoot. It renders inside an **open shadow root** on a fixed host div it appends to `document.body`, so page-level stylesheets can never reach the bubble or panel — a CSS rule targeting widget class names silently matches nothing.

**Why:** the original bubble pin lived in portal CSS targeting Chatwoot class names; it never applied, so the bubble sat at the widget's stock corner while the attention callout pointed at empty air.

**How to apply:**
- Reposition the widget only via the portal's ticketdesk-bubble-pin module (style injected into the open shadow root; the host is created even when the widget's origin gate 403s in dev, so injection is testable everywhere). Never reintroduce page-CSS rules for it.
- Bubble and open panel must move together (the panel's bottom and max-height derive from the bubble's pinned top edge), and the callout/back-to-top offsets are locked to the same geometry — the pin module's doc comment is the single source; change all of them plus their class-contract tests in lockstep.
- The widget's origin gate blocks non-prod origins, so the bubble never fully renders in dev/preview; visual verification needs a replica of the widget's own host+bubble+panel markup (Playwright + nix chromium).
- Any mockup-sandbox preview simulating the bubble must copy the pinned geometry from the pin module, not the widget's stock offsets.
