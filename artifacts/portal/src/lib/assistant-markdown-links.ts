import { PORTAL_NAVIGATION_MAP } from "@workspace/portal-nav-map";

/**
 * Deterministic backstop for LLM link-formatting failures in assistant
 * messages.
 *
 * The system prompt requires portal links to be written as
 * `[Canonical Label](/path)`, but the model occasionally emits variants like:
 *
 *   1. `The Blitz ([/blitz](/blitz))`  — label as plain text, path as link
 *   2. `The Blitz (/blitz)`            — no link at all
 *   3. `[/blitz](/blitz)`              — self-link with the path as its text
 *
 * This normalizer rewrites those patterns into proper Markdown links whose
 * visible text is always the canonical label from the shared portal
 * navigation map, so members see the page name as the clickable text
 * regardless of what the model produced. Only paths present in the
 * navigation map are touched, and code spans / fenced code blocks are left
 * untouched.
 */

const PATH_TO_LABEL: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const section of PORTAL_NAVIGATION_MAP) {
    for (const item of section.items) {
      if (!map.has(item.path)) map.set(item.path, item.label);
    }
  }
  return map;
})();

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits markdown into alternating text / code segments (fences + inline). */
function splitCodeSegments(markdown: string): Array<{ code: boolean; text: string }> {
  const segments: Array<{ code: boolean; text: string }> = [];
  // Fenced blocks first (``` … ```), then inline code (`…`) within the rest.
  const pattern = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
  let last = 0;
  for (const match of markdown.matchAll(pattern)) {
    const idx = match.index ?? 0;
    if (idx > last) segments.push({ code: false, text: markdown.slice(last, idx) });
    segments.push({ code: true, text: match[0] });
    last = idx + match[0].length;
  }
  if (last < markdown.length) segments.push({ code: false, text: markdown.slice(last) });
  return segments;
}

function normalizeTextSegment(text: string): string {
  let out = text;

  for (const [path, label] of PATH_TO_LABEL) {
    if (!out.includes(path)) continue;
    const p = escapeRegExp(path);
    const l = escapeRegExp(label);
    const canonical = `[${label}](${path})`;

    // 1. `Label ([/path](/path))` → `[Label](/path)` (case-insensitive label
    //    match; the canonical label always wins as the link text)
    out = out.replace(
      new RegExp(`${l}\\s*\\(\\[${p}\\]\\(${p}\\)\\)`, "gi"),
      canonical,
    );

    // 2. `Label (/path)` plain text → `[Label](/path)` (skip when the label
    //    is already Markdown link text, i.e. `[Label](/path)`)
    out = out.replace(
      new RegExp(`(?<!\\[)${l}(?!\\])\\s*\\(${p}\\)(?!\\))`, "gi"),
      canonical,
    );

    // 3. Any remaining self-link `[/path](/path)` → `[Label](/path)`
    out = out.replace(new RegExp(`\\[${p}\\]\\(${p}\\)`, "g"), canonical);
  }

  return out;
}

export function normalizeAssistantLinks(markdown: string): string {
  if (!markdown || !markdown.includes("(/")) return markdown;

  return splitCodeSegments(markdown)
    .map((seg) => (seg.code ? seg.text : normalizeTextSegment(seg.text)))
    .join("");
}
