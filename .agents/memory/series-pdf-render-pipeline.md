---
name: Series PDF render pipeline (member doc series)
description: How branded member-doc-series PDFs are generated, committed, and delivered to the Creative Drive
---

Member doc series (Copywriting Foundations, Image Foundations) are delivered as **build-time PDFs committed to the repo**, never generated at server boot (prod has no Chromium). Second series = literal clone (render-image-foundations.ts + seed-image-foundations-drive.ts, lock keys 727_2012/1); a frozen md filename can diverge from the committed PDF via a FILENAME_OVERRIDES map (02-faces-gaze-and-hands.md → 02-the-attention-devices.pdf) so member-visible names never leak a retired title.

- Renderer: `scripts/src/render-copywriting-foundations.ts` (`pnpm --filter @workspace/scripts run render-foundations-pdfs [NN]`). HTML/CSS template printed via playwright-core driving the **nix `chromium`** binary with `--no-sandbox`. Output committed under `artifacts/api-server/src/assets/copywriting-foundations/`.
- **Fonts:** pages loaded with `page.setContent()` cannot fetch `file://` URLs — @font-face fonts must be inlined as base64 data URLs or Chromium silently falls back to system DejaVu. Committed Liberation Sans TTFs live in `scripts/pdf-assets/fonts/`.
- Chromium print-to-PDF **does** produce clickable internal TOC anchor links and embeds subset fonts; verify with `pdffonts` / Link annot count.
- Emoji (🟢/🟡) are replaced by CSS badge spans pre-render — don't rely on emoji fonts in headless chromium.
- Delivery: idempotent boot-seed `seed-copywriting-foundations-drive.ts` — content-addressed object paths (`<slug>-<sha256:12>.pdf`) make the upload check a pure existence test; file rows keyed by (folderId, sortOrder) are repointed in place on hash change, never duplicated; folder keyed by exact name; all row writes under `pg_advisory_xact_lock`.

**Why:** side-task merges only carry git-tracked files; prod data lands only via boot code. Content-addressing gives hash-gating for free.
**How to apply:** new doc series = reuse the renderer (new manifest) + clone the seed pattern; regen after a markdown edit is one command + commit + boot.
