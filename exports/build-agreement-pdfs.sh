#!/usr/bin/env bash
#
# build-agreement-pdfs.sh
#
# Regenerates the agreement PDFs from their HTML previews so the PDFs can never
# silently drift from the legal wording in the HTML.
#
# For every "*_Agreement_Preview.html" in this directory it renders a matching
# "*_Agreement_Preview.pdf" using headless Chromium with no header/footer
# (no URL, page numbers, or print date baked into the page margins).
#
# Usage:
#   ./exports/build-agreement-pdfs.sh
#
# Run it whenever you edit any "*_Agreement_Preview.html". It overwrites the
# existing PDFs in place. Note: PDFs are not byte-for-byte reproducible because
# Chromium embeds a creation timestamp and document ID on each run; the rendered
# content, however, always matches the current HTML.
#
# Requirements: a "chromium" (or "chromium-browser" / "google-chrome") binary on
# PATH. The HTML references "bts-logo.png" relatively, so rendering happens from
# this directory.

set -euo pipefail

# Resolve the directory this script lives in, so it works from any CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Find a usable Chromium/Chrome binary.
CHROME=""
for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
  if command -v "$candidate" >/dev/null 2>&1; then
    CHROME="$candidate"
    break
  fi
done
if [ -z "$CHROME" ]; then
  echo "error: no chromium/chrome binary found on PATH" >&2
  exit 1
fi

shopt -s nullglob
html_files=(*_Agreement_Preview.html)
if [ ${#html_files[@]} -eq 0 ]; then
  echo "no *_Agreement_Preview.html files found in $SCRIPT_DIR" >&2
  exit 1
fi

for html in "${html_files[@]}"; do
  pdf="${html%.html}.pdf"
  echo "rendering $html -> $pdf"
  "$CHROME" \
    --headless \
    --no-sandbox \
    --disable-gpu \
    --no-pdf-header-footer \
    --print-to-pdf="$pdf" \
    "$html" >/dev/null 2>&1
done

echo "done: regenerated ${#html_files[@]} agreement PDF(s)"
