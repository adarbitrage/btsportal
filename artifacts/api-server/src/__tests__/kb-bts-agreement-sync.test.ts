import { describe, it, expect, beforeAll, vi } from "vitest";
import { db, knowledgebaseDocsTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import {
  ensureBtsAgreementKbContent,
  BTS_AGREEMENT_KB_TITLES,
} from "../lib/seed-kb";

// Regression guard for the refund + BTS Mentorship Agreement KB sync.
//
// The AI assistant's refund / Agreement answers depend on the boot hook
// `ensureBtsAgreementKbContent()`, which force-refreshes a fixed set of
// `knowledgebase_docs` rows from the source files (qa-articles.txt +
// glossary.txt). The normal seeder uses ON CONFLICT DO NOTHING and can never
// refresh these, so this hook is the only thing keeping the rows correct in a
// freshly-deployed DB. There was no automated guard, so a future edit to the
// source files, the parser, or the title list could silently stop these
// articles from reaching the DB (or drift their content) until the assistant
// gives a wrong refund answer.
//
// To fail CLOSED on drift we hardcode the expected title contract here (an
// explicit allowlist) instead of deriving it from the production set. The test
// then asserts the exported `BTS_AGREEMENT_KB_TITLES` matches this allowlist
// exactly — so editing the production set without updating this contract fails.

// The refund / refund-process articles (some already existed with stale
// content; this hook is the only thing that can refresh them).
const REFUND_TITLES = [
  "What are the Mentorship refund requirements?",
  "How do I request a Mentorship refund?",
  "How do I submit my Profit & Loss Tracker?",
  "How do I request a BTS Deposit refund?",
] as const;

// The BTS Mentorship Agreement articles.
const AGREEMENT_TITLES = [
  "What is the BTS Mentee Master Agreement?",
  "What membership terms does the BTS Mentorship Program offer?",
  "Does BTS guarantee profits or specific results?",
  "What are the intellectual property and confidentiality terms of the BTS Agreement?",
  "What are the governing law and termination terms of the BTS Agreement?",
  "What happens if I miss installment payments or need to cancel my BTS Mentorship?",
  "What are the BTS Agreement's liability, warranty, and other legal terms?",
] as const;

const EXPECTED_TITLES = [...REFUND_TITLES, ...AGREEMENT_TITLES] as const;

// The glossary chunk (Part 4) that carries the refund-guarantee terms.
const GLOSSARY_PART4_TITLE = "BTS Affiliate Marketing Glossary (Part 4)";
const GLOSSARY_NEW_TERMS = [
  "90-Day Action-Based Refund Guarantee",
  "P&L Spreadsheet",
  "Mentorship Term",
  "Ad-Spend Milestone",
];

/** Parse the "Written: N" count out of the hook's completion log line. */
function parseWrittenCount(logArgs: unknown[][]): number | null {
  for (const args of logArgs) {
    const line = args.map((a) => String(a)).join(" ");
    const match = line.match(/ensureBtsAgreementKbContent done\. Written: (\d+)/);
    if (match) return Number(match[1]);
  }
  return null;
}

describe("BTS Agreement KB sync contract (ensureBtsAgreementKbContent)", () => {
  beforeAll(async () => {
    // Run the real hook once so the rows are present and in sync.
    await ensureBtsAgreementKbContent();
  });

  it("locks the targeted title list against drift", () => {
    // Exact set equality (presence + count) between the production set and the
    // hardcoded contract. Editing one without the other fails the test.
    const actual = Array.from(BTS_AGREEMENT_KB_TITLES).sort();
    const expected = [...EXPECTED_TITLES].sort();
    expect(actual).toEqual(expected);
    expect(BTS_AGREEMENT_KB_TITLES.size).toBe(EXPECTED_TITLES.length);
  });

  it("writes every targeted Agreement/refund title into the faq category", async () => {
    const rows = await db
      .select({
        title: knowledgebaseDocsTable.title,
        category: knowledgebaseDocsTable.category,
      })
      .from(knowledgebaseDocsTable)
      .where(inArray(knowledgebaseDocsTable.title, [...EXPECTED_TITLES]));

    const byTitle = new Map(rows.map((r) => [r.title, r.category]));

    // Every refund title present, in faq.
    for (const title of REFUND_TITLES) {
      expect(byTitle.has(title), `missing refund KB doc: "${title}"`).toBe(true);
      expect(byTitle.get(title), `wrong category for: "${title}"`).toBe("faq");
    }

    // Every Agreement title present, in faq.
    for (const title of AGREEMENT_TITLES) {
      expect(byTitle.has(title), `missing Agreement KB doc: "${title}"`).toBe(true);
      expect(byTitle.get(title), `wrong category for: "${title}"`).toBe("faq");
    }

    // No extra/missing: exactly the expected titles came back.
    expect(rows.length).toBe(EXPECTED_TITLES.length);
  });

  it("syncs the glossary Part 4 row with the new refund-guarantee terms", async () => {
    const [part4] = await db
      .select({
        title: knowledgebaseDocsTable.title,
        category: knowledgebaseDocsTable.category,
        content: knowledgebaseDocsTable.content,
      })
      .from(knowledgebaseDocsTable)
      .where(eq(knowledgebaseDocsTable.title, GLOSSARY_PART4_TITLE));

    expect(part4, `missing glossary row: "${GLOSSARY_PART4_TITLE}"`).toBeTruthy();
    expect(part4.category).toBe("glossary");
    for (const term of GLOSSARY_NEW_TERMS) {
      expect(
        part4.content.includes(term),
        `glossary Part 4 missing term: "${term}"`,
      ).toBe(true);
    }
  });

  it("is idempotent: a second run writes 0 rows", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await ensureBtsAgreementKbContent();
      const written = parseWrittenCount(logSpy.mock.calls);
      expect(written, "could not find completion log line").not.toBeNull();
      expect(written).toBe(0);
    } finally {
      logSpy.mockRestore();
    }
  });
});
