/**
 * Brand ™ guard (Task #2103).
 *
 * Task #2100 added the ™ symbol to every member-visible "The Blitz" /
 * "7 Pillars" brand mention. This test locks that in: it parses the
 * member-facing source files with the TypeScript AST and flags any string
 * literal / template literal / JSX text where the brand words appear
 * WITHOUT a trailing ™.
 *
 * Scope (member-visible surfaces only):
 *  - portal src/pages/**\/*.tsx           (excluding admin + archive surfaces)
 *  - portal src/components/blitz/*.tsx    (excluding archived/dead libraries)
 *  - api-server src/lib/curriculum-content.ts (7 Pillars / pillars-to-blitz copy)
 *  - lib/blitz-curriculum/src/blitz-body-html.ts (the Blitz guide body HTML)
 *
 * The scan is case-sensitive on purpose: lowercase slugs/ids/hrefs
 * ("/blitz", "pillars-to-blitz", "blitz-lesson-…") never match, and
 * identifiers like BlitzHub/useBlitzGuideHtml are not string literals so the
 * AST walk never sees them. Remaining false-positive sources are handled by
 * the explicit allowlists below.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const TM = "\u2122"; // ™

// Repo root: artifacts/portal/src/__tests__ -> up 4.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PORTAL_SRC = path.resolve(__dirname, "..");

/** Files that are NOT member-visible (admin-only or archived/dead surfaces). */
const EXCLUDED_PORTAL_FILES = new Set<string>([
  // Admin-only / archive surfaces (plain "Blitz" is fine here by convention)
  "pages/BlitzArchive.tsx",
  "pages/BlitzHubArchive.tsx",
  "pages/VideoReview.tsx", // temporary admin-only review surface
  // Archived / dead lesson libraries (kept for reference, not routed to members)
  "components/blitz/LessonLibrary.tsx",
  "components/blitz/LessonLibraryArchive.tsx",
  // Coach-facing dashboards (not member-visible copy)
  "pages/coaching/CoachDashboard.tsx",
  "pages/coaching/MenteeDetail.tsx",
  "pages/coaching/PackCoachDashboard.tsx",
]);

/**
 * Exact string values that are allowed to contain a plain brand mention.
 * Keep this list SHORT and specific — every entry needs a reason.
 */
const ALLOWED_EXACT_STRINGS = new Set<string>([
  // AdCredit email-subject convention: plain-text email subject lines
  // intentionally omit the ™ glyph (deliverability/encoding convention).
]);

/**
 * Per-substring allow patterns applied to the literal text. These cover
 * non-copy string values (ids, query keys, analytics slugs, test ids) that
 * legitimately contain a capitalized brand word.
 */
const ALLOWED_TEXT_PATTERNS: RegExp[] = [
  // AdCredit email-subject convention: the "Blitz Testimonial" subject line is
  // plain text by design (appears in AdCredit.tsx and the Blitz guide HTML,
  // both as display copy and URL-encoded inside the mailto: link).
  /Blitz Testimonial/,
  /Blitz%20Testimonial/,
];

interface Violation {
  file: string;
  line: number;
  text: string;
}

// A brand word not immediately followed by ™.
// "Blitz™" passes; "BlitzHub" has no word boundary so it never matches.
const BRAND_RE = new RegExp(`(\\b7 Pillars\\b|\\bBlitz\\b)(?!${TM})`);

function isAllowedText(text: string): boolean {
  if (ALLOWED_EXACT_STRINGS.has(text)) return true;
  return ALLOWED_TEXT_PATTERNS.some((re) => re.test(text));
}

function scanFile(filePath: string, relLabel: string): Violation[] {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const violations: Violation[] = [];

  const record = (node: ts.Node, text: string) => {
    if (!BRAND_RE.test(text)) return;
    if (isAllowedText(text)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    violations.push({
      file: relLabel,
      line: line + 1,
      text: text.length > 120 ? `${text.slice(0, 117)}...` : text,
    });
  };

  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      record(node, node.text);
    } else if (ts.isJsxText(node)) {
      record(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}

function listPortalMemberFiles(): { abs: string; rel: string }[] {
  const roots = ["pages", "components/blitz"];
  const out: { abs: string; rel: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(PORTAL_SRC, abs).split(path.sep).join("/");
      if (entry.isDirectory()) {
        // Admin-only pages and test dirs are out of scope.
        if (entry.name === "admin" || entry.name === "__tests__") continue;
        walk(abs);
        continue;
      }
      if (!entry.name.endsWith(".tsx")) continue;
      if (entry.name.includes(".test.")) continue;
      if (EXCLUDED_PORTAL_FILES.has(rel)) continue;
      out.push({ abs, rel: `portal/src/${rel}` });
    }
  };
  for (const root of roots) walk(path.join(PORTAL_SRC, root));
  return out;
}

const EXTRA_FILES: { abs: string; rel: string }[] = [
  {
    abs: path.join(REPO_ROOT, "artifacts/api-server/src/lib/curriculum-content.ts"),
    rel: "api-server/src/lib/curriculum-content.ts",
  },
  {
    abs: path.join(REPO_ROOT, "lib/blitz-curriculum/src/blitz-body-html.ts"),
    rel: "lib/blitz-curriculum/src/blitz-body-html.ts",
  },
];

describe("brand trademark guard: member-visible Blitz / 7 Pillars copy carries \u2122", () => {
  it("scans a sane number of member-facing files", () => {
    const files = listPortalMemberFiles();
    // Sanity: the glob must actually find the member surfaces, or the guard
    // silently guards nothing.
    expect(files.length).toBeGreaterThan(30);
    for (const extra of EXTRA_FILES) {
      expect(fs.existsSync(extra.abs), `missing ${extra.rel}`).toBe(true);
    }
  });

  it("Blitz guide load-error copy identifies the Blitz\u2122 guide", () => {
    // Focused regression check: the rendered blitz-guide-error block must
    // name the Blitz\u2122 guide (the guard scan can't tell if the brand word
    // is dropped entirely, only if it appears without \u2122).
    const src = fs.readFileSync(path.join(PORTAL_SRC, "pages", "Blitz.tsx"), "utf8");
    const idx = src.indexOf('data-testid="blitz-guide-error"');
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 400)).toMatch(/Blitz\u2122/);
  });

  it("finds no un-trademarked brand mentions in member-visible string copy", () => {
    const files = [...listPortalMemberFiles(), ...EXTRA_FILES];
    const violations = files.flatMap((f) => scanFile(f.abs, f.rel));
    const report = violations
      .map((v) => `  ${v.file}:${v.line}  ${JSON.stringify(v.text)}`)
      .join("\n");
    expect(
      violations,
      `Member-visible brand copy must use "The Blitz\u2122" / "7 Pillars\u2122" (Task #2100 convention).\n` +
        `Fix the copy (add \u2122) or, for a genuine non-copy string (id/slug/admin-only), extend the allowlist in this test:\n${report}`,
    ).toHaveLength(0);
  });
});
