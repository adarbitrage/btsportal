import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../../..");
const SRC = resolve(ROOT, "attached_assets/blitz_main_caterpillar_110_1778523623764.html");
const OUT = resolve(ROOT, "artifacts/portal/src/pages/Blitz.tsx");

const html = readFileSync(SRC, "utf8");

// Extract CSS
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) throw new Error("No <style> block found");
let cssRaw = styleMatch[1];

// Extract body
const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
if (!bodyMatch) throw new Error("No <body> block found");
let body = bodyMatch[1].trim();

// 0) Strip all <script>…</script> blocks — they don't execute via dangerouslySetInnerHTML.
body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");

// 0b) Strip the sticky section-nav-bar (needs JS to populate; links go off-portal).
body = body.replace(
  /<div class="section-nav-bar"[\s\S]*?<\/div>\s*/,
  "",
);

// 0c) For each unique data-section="sN" value, insert an invisible anchor
//     with id="sN" right before the first matching element so /blitz/guide#sN
//     scroll-targets land on the right module. The offset compensates for
//     the AppLayout sticky topbar.
const seenSections = new Set<string>();
body = body.replace(
  /<div class="module"[^>]*data-section="([^"]+)"[^>]*>/g,
  (match, sectionAttr: string) => {
    const tokens = sectionAttr.split(/\s+/).filter(Boolean);
    const newAnchors: string[] = [];
    for (const tok of tokens) {
      if (!seenSections.has(tok)) {
        seenSections.add(tok);
        newAnchors.push(
          `<span id="${tok}" style="display:block;position:relative;top:-80px;visibility:hidden;"></span>`,
        );
      }
    }
    return newAnchors.join("") + match;
  },
);

// 1) Remove the supplemental-link note (those files don't exist in the portal)
body = body.replace(/<div class="supp-note">[\s\S]*?<\/div>\s*/g, "");

// 1b) Replace anchor tags pointing at non-existent supplemental HTML files
//     with a neutral "Coming soon" label so users don't think there's a broken link.
body = body.replace(
  /<a\s+href="blitz_supplemental_[^"]+\.html"[^>]*>[\s\S]*?<\/a>/g,
  '<span style="color:var(--muted);font-style:italic;">Coming soon</span>',
);

// 1c) Neutralize stale onclick="blitzOpenVideo(...)" handlers — those JS
//     functions are stripped above, so the attributes would error if clicked.
body = body.replace(/\s+onclick="blitzOpenVideo\([^)]*\)"/g, "");

// 2) Add Lesson Library to the TOC, before "Key Terms" link
body = body.replace(
  '<a href="#glossary">Key Terms</a>',
  '<a href="#lesson-library">Lesson Library</a>\n  <a href="#glossary">Key Terms</a>',
);

// 3) Insert the Lesson Library module right after the WELCOME block, before GLOSSARY
const lessonLibraryHTML = `
<!-- LESSON LIBRARY -->
<div class="module" id="lesson-library">
  <div class="module-header"><span class="mod-badge">Library</span><h2>Step-by-Step Lesson Library</h2></div>
  <div class="module-intro">Every video lesson in The Blitz™, organized by phase and module in the order you should follow them. Click any lesson to read the full walkthrough — these are the same step-by-step instructions you'd see in the videos, written out so you can scan, search, and reference them at any time.</div>
  <div id="lesson-library-mount"></div>
</div>
`;
if (!body.includes("<!-- GLOSSARY -->")) {
  throw new Error("Expected <!-- GLOSSARY --> marker not found");
}
body = body.replace("<!-- GLOSSARY -->", `${lessonLibraryHTML}\n<!-- GLOSSARY -->`);

// 4) Namespace CSS selectors with .blitz-content prefix, and rename body / * rules.
//    Approach: split on rule blocks, prefix each comma-separated selector list, except @rules and :root.
function namespaceCss(css: string): string {
  const out: string[] = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    // Skip whitespace
    while (i < n && /\s/.test(css[i])) {
      out.push(css[i]);
      i++;
    }
    if (i >= n) break;

    // Handle @-rules: copy through up to matching '}' or ';' for @charset/@import
    if (css[i] === "@") {
      const atRuleStart = i;
      // Read until '{' or ';'
      while (i < n && css[i] !== "{" && css[i] !== ";") i++;
      if (i < n && css[i] === ";") {
        i++;
        out.push(css.slice(atRuleStart, i));
        continue;
      }
      if (i < n && css[i] === "{") {
        // Recurse: read inner block (could contain nested rules for @media)
        const blockStart = i + 1;
        let depth = 1;
        i++;
        while (i < n && depth > 0) {
          if (css[i] === "{") depth++;
          else if (css[i] === "}") depth--;
          if (depth === 0) break;
          i++;
        }
        const blockEnd = i;
        const atHeader = css.slice(atRuleStart, blockStart - 1);
        const innerBlock = css.slice(blockStart, blockEnd);
        i++; // consume '}'
        out.push(atHeader + "{" + namespaceCss(innerBlock) + "}");
        continue;
      }
      continue;
    }

    // Read selector up to '{'
    const selStart = i;
    while (i < n && css[i] !== "{") i++;
    if (i >= n) break;
    const selRaw = css.slice(selStart, i).trim();
    if (!selRaw) {
      out.push("{");
      i++;
      continue;
    }
    const newSel = selRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        // Scope :root tokens to .blitz-content so CSS variables don't leak globally
        if (s === ":root" || s.startsWith(":root")) return ".blitz-content";
        if (s === "body") return ".blitz-content";
        // Replace the universal "*" reset with a targeted set of handbook elements,
        // so the React-rendered LessonLibrary subtree (Tailwind-styled) isn't clobbered.
        if (s === "*") {
          return [
            ".blitz-content h1", ".blitz-content h2", ".blitz-content h3",
            ".blitz-content h4", ".blitz-content h5", ".blitz-content h6",
            ".blitz-content p", ".blitz-content ul", ".blitz-content ol",
            ".blitz-content li", ".blitz-content figure", ".blitz-content blockquote",
            ".blitz-content dl", ".blitz-content dd",
          ].join(", ");
        }
        if (s.startsWith(".blitz-content")) return s;
        return `.blitz-content ${s}`;
      })
      .join(", ");

    // Read body of rule (handle nested for safety)
    const bodyStart = i + 1;
    let depth = 1;
    i++;
    while (i < n && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      if (depth === 0) break;
      i++;
    }
    const bodyEnd = i;
    const ruleBody = css.slice(bodyStart, bodyEnd);
    i++; // consume closing '}'
    out.push(newSel + "{" + ruleBody + "}");
  }
  return out.join("");
}

const cssNamespaced = namespaceCss(cssRaw).trim();

// Escape backticks and ${} in template literal payloads
function tpl(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

const tsx = `import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import LessonLibrary from "@/components/blitz/LessonLibrary";

// Source: attached_assets/blitz_main_caterpillar_110_1778523623764.html (v4.0, 2026-04-21)
// Generated by artifacts/api-server/src/scripts/build-blitz-from-html.ts

const blitzCSS = \`${tpl(cssNamespaced)}\`;

const blitzBodyHTML = \`${tpl(body)}\`;

export default function Blitz() {
  const [mountEl, setMountEl] = useState<HTMLElement | null>(null);

  const setRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      setMountEl(null);
      return;
    }
    const target = el.querySelector("#lesson-library-mount");
    if (target instanceof HTMLElement) setMountEl(target);
  }, []);

  return (
    <AppLayout>
      <style dangerouslySetInnerHTML={{ __html: blitzCSS }} />
      <div
        className="blitz-content"
        ref={setRef}
        dangerouslySetInnerHTML={{ __html: blitzBodyHTML }}
      />
      {mountEl && createPortal(<LessonLibrary />, mountEl)}
    </AppLayout>
  );
}
`;

writeFileSync(OUT, tsx, "utf8");
console.log(`Wrote ${OUT}`);
console.log(`  CSS chars: ${cssNamespaced.length}`);
console.log(`  Body chars: ${body.length}`);
