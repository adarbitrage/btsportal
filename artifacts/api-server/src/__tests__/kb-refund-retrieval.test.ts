import { describe, it, expect, beforeAll } from "vitest";
import { ensureBtsAgreementKbContent } from "../lib/seed-kb";
import { searchKnowledgebase } from "../routes/chat";

// End-to-end retrieval guard for the AI assistant's refund answers.
//
// `kb-bts-agreement-sync.test.ts` already proves the refund + BTS Mentorship
// Agreement articles and the refund-guarantee glossary terms REACH the database
// (via the boot hook `ensureBtsAgreementKbContent()`). It does NOT prove the
// assistant actually RETRIEVES them. The assistant's retrieval is purely lexical
// (`websearch_to_tsquery` inside `searchKnowledgebase()` in routes/chat.ts), so
// a phrasing/alias drift, a parser change, or a ranking regression could leave
// the right docs in the DB yet never surface them in an answer — the member
// would silently get "I don't have that information" or a fabricated reply.
//
// This test seeds the docs with the real hook, then runs realistic member
// refund questions through the EXACT same search function the chat route calls,
// asserting the refund-requirement / refund-request articles and the 90-Day
// Action-Based Refund Guarantee glossary term land in the returned context.

// The full member-tier knowledgebase category list the chat route passes to
// searchKnowledgebase (mirrors getTierConfig's full-access tiers). Refund
// articles live in `faq`, the refund-guarantee terms live in `glossary`.
const MEMBER_CATEGORIES = [
  "faq",
  "platform_guide",
  "marketing",
  "compliance",
  "advanced_strategy",
  "troubleshooting",
  "strategy",
  "curriculum",
  "sop",
  "glossary",
  "coaching",
];

const REFUND_REQUIREMENTS_TITLE = "What are the Mentorship refund requirements?";
const REFUND_REQUEST_TITLE = "How do I request a Mentorship refund?";
const GLOSSARY_GUARANTEE_TERM = "90-Day Action-Based Refund Guarantee";

// Realistic ways a member might ask about refunds in the assistant. None of
// these is guaranteed to use the exact article wording, but each must surface
// the refund articles and the refund-guarantee glossary term.
const REFUND_QUERIES = [
  "what is the refund guarantee and how do I qualify",
  "can I get a refund from the mentorship program",
  "what revenue threshold do I need for the refund guarantee",
];

describe("AI assistant refund retrieval (searchKnowledgebase)", () => {
  beforeAll(async () => {
    // Seed/refresh the refund + Agreement articles and glossary refund terms
    // exactly as the server does on boot.
    await ensureBtsAgreementKbContent();
  });

  for (const query of REFUND_QUERIES) {
    it(`surfaces the refund articles + guarantee glossary term for: "${query}"`, async () => {
      const results = await searchKnowledgebase(query, MEMBER_CATEGORIES);

      const titles = results.map((r) => r.title);
      const joinedContent = results.map((r) => r.content).join("\n\n");

      expect(
        titles,
        `refund-requirements article missing for query "${query}"; got: ${JSON.stringify(titles)}`,
      ).toContain(REFUND_REQUIREMENTS_TITLE);

      expect(
        titles,
        `refund-request article missing for query "${query}"; got: ${JSON.stringify(titles)}`,
      ).toContain(REFUND_REQUEST_TITLE);

      expect(
        joinedContent.includes(GLOSSARY_GUARANTEE_TERM),
        `glossary refund-guarantee term "${GLOSSARY_GUARANTEE_TERM}" missing from retrieved context for query "${query}"; titles: ${JSON.stringify(titles)}`,
      ).toBe(true);
    });
  }

  it("returns no refund context for an unrelated query (no false positives)", async () => {
    const results = await searchKnowledgebase(
      "when is the next live coaching call",
      MEMBER_CATEGORIES,
    );
    const titles = results.map((r) => r.title);
    expect(titles).not.toContain(REFUND_REQUIREMENTS_TITLE);
    expect(titles).not.toContain(REFUND_REQUEST_TITLE);
  });
});
