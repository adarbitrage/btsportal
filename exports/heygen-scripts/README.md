# BTS Training Video Scripts (HeyGen-Ready)

**97 scripts** cleaned from raw video transcripts and prepared for AI avatar narration in HeyGen.

## What's inside

- **scripts/** — One `.txt` file per video. The first three lines are metadata; everything below the `---` is the spoken script ready to paste into HeyGen.
- **ALL-SCRIPTS.md** — All 97 scripts in one document for easy review.
- **manifest.json** — Machine-readable index (filename, title, video ID, word count).

## How they were cleaned

Each raw transcript was processed by GPT-4o-mini with instructions to:
- Strip filler words (um, uh, you know, like, okay so, right?)
- Tighten run-on sentences and remove redundant repetition
- Fix transcription artifacts (correct casing for MediaMavens, ClickBank, DIYTrax, Flexy)
- Preserve the original instructional voice and second-person tone
- Apply BTS branding (any residual TCE / "The Conversion Engine" mentions swept)
- Open with a clean hook and close on a complete thought

**No new facts, URLs, prices, or steps were invented** — only existing content was restructured.

## Using with HeyGen

1. Open any `scripts/NNN-*.txt` file.
2. Copy everything below the `---` line.
3. Paste into the HeyGen script field for your avatar.
4. Adjust voice, pacing, and pauses inside HeyGen as needed.

