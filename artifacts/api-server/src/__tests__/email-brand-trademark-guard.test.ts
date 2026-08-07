/**
 * Email brand ™ guard (Task #2107) — sibling of the portal scanner in
 * artifacts/portal/src/__tests__/brand-trademark-guard.test.ts (Task #2103).
 *
 * Member-facing email templates carry the same branding requirement as the
 * portal: every "Blitz" / "7 Pillars" brand mention in member-visible email
 * copy must carry the ™ symbol. This test parses the email-template source
 * files with the TypeScript AST and flags any string literal / template
 * literal where a brand word appears WITHOUT a trailing ™.
 *
 * Scope (member-facing email surfaces in api-server):
 *  - lib/seed-templates.ts            (lifecycle/onboarding/blast starter templates)
 *  - lib/communication-service.ts     (send-time composition/personalization)
 *  - lib/scheduled-comms.ts           (scheduled sequence sends)
 *  - lib/email-transport.ts           (wrapHtml chrome/footer)
 *  - lib/ticket-reply-notification.ts (ticket reply email/SMS copy)
 *  - lib/seed-pitch-content.ts        (pitch blocks embedded into emails)
 *  - lib/pitch-resolver.ts            (pitch slot rendering seam)
 *
 * The scan is case-sensitive on purpose: lowercase slugs/ids/hrefs
 * ("/blitz", "pillars-to-blitz") never match. The AdCredit "Blitz Testimonial"
 * plain-text subject-line convention stays allowlisted (deliverability/
 * encoding convention for plain-text subjects).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const TM = "\u2122"; // ™

// api-server src root: src/__tests__ -> up 1.
const SRC_ROOT = path.resolve(__dirname, "..");

/** Email-template source files (member-facing email surfaces). */
const EMAIL_TEMPLATE_FILES = [
  "lib/seed-templates.ts",
  "lib/communication-service.ts",
  "lib/scheduled-comms.ts",
  "lib/email-transport.ts",
  "lib/ticket-reply-notification.ts",
  "lib/seed-pitch-content.ts",
  "lib/pitch-resolver.ts",
];

/**
 * Exact string values allowed to contain a plain brand mention.
 * Keep this list SHORT and specific — every entry needs a reason.
 */
const ALLOWED_EXACT_STRINGS = new Set<string>([]);

/**
 * Per-substring allow patterns applied to the literal text. These cover
 * non-copy string values and the plain-text subject-line convention.
 */
const ALLOWED_TEXT_PATTERNS: RegExp[] = [
  // AdCredit email-subject convention: the "Blitz Testimonial" subject line
  // is plain text by design (deliverability/encoding convention), matching
  // the portal guard's allowlist.
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
    ts.ScriptKind.TS,
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
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}

describe(`email brand trademark guard: member-facing email copy carries ${TM}`, () => {
  it("scans the expected email-template source files", () => {
    // Sanity: every scoped file must exist, or the guard silently guards
    // nothing (e.g. after a rename/move).
    for (const rel of EMAIL_TEMPLATE_FILES) {
      expect(fs.existsSync(path.join(SRC_ROOT, rel)), `missing ${rel}`).toBe(true);
    }
  });

  it("scanner catches an un-trademarked brand mention (self-test)", () => {
    // Prove the AST scan actually flags plain brand copy, so a green run
    // means "no violations", not "scanner is broken".
    const tmp = path.join(SRC_ROOT, "__tests__", "__brand-guard-selftest.tmp.ts");
    fs.writeFileSync(
      tmp,
      'export const subject = "Your Blitz progress update";\n' +
        "export const body = `Master the 7 Pillars this week`;\n" +
        `export const ok = "The Blitz${TM} and 7 Pillars${TM} pass";\n` +
        'export const allowed = "Blitz Testimonial — [Your Name]";\n',
    );
    try {
      const violations = scanFile(tmp, "selftest");
      expect(violations.map((v) => v.text)).toEqual([
        "Your Blitz progress update",
        "Master the 7 Pillars this week",
      ]);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("finds no un-trademarked brand mentions in email template sources", () => {
    const violations = EMAIL_TEMPLATE_FILES.flatMap((rel) =>
      scanFile(path.join(SRC_ROOT, rel), `api-server/src/${rel}`),
    );
    const report = violations
      .map((v) => `  ${v.file}:${v.line}  ${JSON.stringify(v.text)}`)
      .join("\n");
    expect(
      violations,
      `Member-facing email copy must use "The Blitz${TM}" / "7 Pillars${TM}" (Task #2100 convention).\n` +
        `Fix the copy (add ${TM}) or, for a genuine non-copy string (id/slug/subject-line convention), extend the allowlist in this test:\n${report}`,
    ).toHaveLength(0);
  });
});
