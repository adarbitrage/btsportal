import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, knowledgebaseDocsTable } from "@workspace/db";

/**
 * Guard against coach last names leaking into the AI assistant.
 *
 * The assistant must only ever surface coach FIRST names. Two content paths
 * feed it, and BOTH must be clean:
 *   1. The system-prompt path reads `qa-articles.txt` and `glossary.txt` RAW
 *      from disk (routes/openai/knowledge-base.ts) — it bypasses the privacy
 *      filter entirely, so those files must be physically clean.
 *   2. The DB path (`knowledgebase_docs`) is scrubbed at ingest time, but a
 *      NEW spelling variant in the source could slip past the filter.
 *
 * A coach surname previously leaked because the source used inconsistent
 * spellings (e.g. both "Wissbaum" and "Wisbaum") and only one variant was
 * filtered. These matchers are deliberately fuzzy so they also catch close
 * misspellings of a known surname that a future edit might introduce.
 */

const KB_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../knowledge-base",
);

interface CoachSurnameMatcher {
  coach: string;
  /** Variant-tolerant pattern covering known spellings + close misspellings. */
  pattern: RegExp;
}

const COACH_SURNAME_MATCHERS: CoachSurnameMatcher[] = [
  // Sasha Bobylev / Bobilev
  { coach: "Sasha", pattern: /\bbob[iy]l[ae]v\b/i },
  // Michael Wissbaum / Wisbaum
  { coach: "Michael", pattern: /\bwiss?baums?\b/i },
  // Todd Rupp (also catches the "Rup" single-p misspelling)
  { coach: "Todd", pattern: /\brupp?\b/i },
  // Robin Shepard / Shephard / Sheperd / Shepherd
  { coach: "Robin", pattern: /\bshep[ah]?[ae]rd\b/i },
  // Bruce Clark / Clarke
  { coach: "Bruce", pattern: /\bclarke?\b/i },
];

function findLeaks(text: string): Array<{ coach: string; match: string }> {
  const leaks: Array<{ coach: string; match: string }> = [];
  for (const { coach, pattern } of COACH_SURNAME_MATCHERS) {
    const m = text.match(pattern);
    if (m) leaks.push({ coach, match: m[0] });
  }
  return leaks;
}

describe("KB coach-name leak guard", () => {
  // Sanity-check the matchers themselves so the guard can never silently pass
  // because a regex was accidentally broken.
  it("the matchers actually detect the known surnames (and variants)", () => {
    const samples = [
      "Sasha Bobylev",
      "Sasha Bobilev",
      "Michael Wissbaum",
      "Michael Wisbaum",
      "Todd Rupp",
      "Robin Shepard",
      "Robin Shephard",
      "Bruce Clark",
    ];
    for (const sample of samples) {
      expect(findLeaks(sample).length).toBeGreaterThan(0);
    }
  });

  it("does not flag ordinary KB vocabulary", () => {
    const safe =
      "Sasha, Bruce, Michael, Todd and Robin host the live calls. " +
      "Use DIYTrax to disrupt your campaigns and clear up tracking issues.";
    expect(findLeaks(safe)).toEqual([]);
  });

  // The raw files embedded directly into the system prompt — the filter does
  // NOT protect these, so they must be physically clean.
  for (const file of ["qa-articles.txt", "glossary.txt"]) {
    it(`raw source file '${file}' contains no unscrubbed coach surname`, () => {
      const raw = fs.readFileSync(path.join(KB_DIR, file), "utf-8");
      const leaks = findLeaks(raw);
      expect(
        leaks,
        `Unscrubbed coach surname(s) found in ${file}: ${leaks
          .map((l) => `"${l.match}" (${l.coach})`)
          .join(", ")}. Clean the source file AND widen the rule in ` +
          `lib/content-privacy-filter.ts to cover this variant.`,
      ).toEqual([]);
    });
  }

  it("seeded knowledgebase_docs rows contain no unscrubbed coach surname", async () => {
    const rows = await db
      .select({
        id: knowledgebaseDocsTable.id,
        title: knowledgebaseDocsTable.title,
        content: knowledgebaseDocsTable.content,
      })
      .from(knowledgebaseDocsTable);

    const offenders: string[] = [];
    for (const row of rows) {
      const leaks = findLeaks(`${row.title}\n${row.content}`);
      if (leaks.length > 0) {
        offenders.push(
          `#${row.id} "${row.title}": ${leaks
            .map((l) => `"${l.match}" (${l.coach})`)
            .join(", ")}`,
        );
      }
    }

    expect(
      offenders,
      `Unscrubbed coach surname(s) found in knowledgebase_docs:\n${offenders.join(
        "\n",
      )}\nRe-scrub the offending rows and widen the rule in ` +
        `lib/content-privacy-filter.ts to cover the variant.`,
    ).toEqual([]);
  });
});
