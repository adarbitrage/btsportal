---
name: Blitz branded design (archived)
description: The original branded visual identity of the Blitz Hub + Guide, removed during the restyle-to-site-style task. Specs + restore path so it can be re-added later.
---

User asked to keep the original Blitz branding "in case we want to add it back later." During the restyle, the Blitz Hub/Guide were converted to the standard portal style (AppLayout + Card + Inter/Roboto + 7-Pillars-style tints). The original branded look is preserved here.

**Where the full original lives:** git history at/before checkpoint commit `111af7fd` (state right before the Blitz restyle began). Files: `artifacts/portal/src/pages/BlitzHub.tsx` (HUB_CSS block), `artifacts/portal/src/pages/Blitz.tsx` (blitzCSS block + page-header).

**Display fonts (Google Fonts):** `Bebas Neue` (hero/display titles), `DM Sans` (300–700 + italic, body), `DM Mono` (eyebrows, labels, tags). Loaded via a `<link>` to `fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:...&family=DM+Mono:...`.

**Hub hero:** navy `#0f1e33` background, dotted SVG texture overlay, two radial gradients (blue `rgba(37,99,235,.25)` at 15%, purple `rgba(124,58,237,.2)` at 85%). Eyebrow in DM Mono (letter-spacing 3px, uppercase). Title "THE BLITZ™" in Bebas Neue `clamp(2.8rem,8vw,5rem)`, letter-spacing 6px. Progress bar fill gradient blue→`#a78bfa`.

**Guide page-header:** navy `#1a2e4a` band, white text, h1 `3rem`, pill `pub-badge`, sticky `nav.toc` of section anchors on navy.

**Phase color system (kept conceptually, re-mapped to site tints):** Build = green (`#15803d`/`#16a34a`, bg `#f0fdf4`), Test = orange (`#c2410c`/`#ea580c`, bg `#fff7ed`), Scale = purple (`#7c3aed`/`#8b5cf6`, bg `#faf5ff`), Intro = slate. Network tags: MM green, CB amber, MW blue, AF violet, Caterpillar purple.

**To restore:** pull the HUB_CSS / blitzCSS blocks and the font `<link>` from the pre-restyle commit and reinstate the hero/page-header JSX.
