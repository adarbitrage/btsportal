---
name: Blitz v2 color system
description: Color-meaning convention for the v2 Blitz feature (hub + guide). Apply to any future styling so the two color axes never collide again.
---

**Rule:** green / amber / purple are reserved **exclusively for phase identity** — one canonical hex each, used identically across hub badges, in-guide `.mod-badge`, the lesson pager, and the phase roadmap:
- Build (Phase 1) = `#047857` (emerald-700)
- Test (Phase 2) = `#b45309` (amber-700)
- Scale (Phase 3) = `#6b21a8` (purple-800)

Networks & publishers (Media Mavens, ClickBank, MaxWeb, Affiliati, Caterpillar, Grasshopper, Crane) are **neutral slate, differentiated by label** — never colored: chips/tags `#334155` text / `#f8fafc`(or slate-100) bg / `#cbd5e1` border. In the hub this is the shared `NETWORK_TAG_CLS`; in the guide it's the `--mm/cb/mw/af/cat-*` CSS vars (all set to slate).

**Why:** the two axes (phase = progress, network = routing) previously shared green/amber/purple, so Media Mavens read as "Phase 1," ClickBank as "Phase 2," Caterpillar as "Phase 3" — confusing. User chose neutral networks to free the trio for phases only.

**How to apply / gotchas:**
- Two phase elements had borrowed network vars — keep them decoupled: roadmap p3 title uses literal `#6b21a8` (not `--cat-color`), and `.gate.pass` bg uses literal `#f0fdf4` (not `--mm-bg`).
- Don't recolor by hue inside the campaign-architecture flow diagram or publisher tables — keep nodes/badges neutral slate, identity carried by label text.
- Success/profit/status greens (`.alert.success`, `--success`, video-slot ready states, profit-row tints) are a separate semantic axis and are intentionally kept — they don't collide with networks (now slate) and aren't phase badges.
- Print button is `variant="outline"` (was green) so green never means "action."
