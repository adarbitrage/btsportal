import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ensureBtsAgreementKbContent } from "../lib/seed-kb";
import { syncCitableDocsToLiveDocuments } from "../lib/bootstrap-critical-prerequisites";
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
  // Pure casual phrasing that never uses the canonical word "refund" — only
  // surfaces the refund context via the synonym/alias layer.
  "how do I get my money back",
];

describe("AI assistant refund retrieval (searchKnowledgebase)", () => {
  beforeAll(async () => {
    // Seed/refresh the refund + Agreement articles and glossary refund terms
    // exactly as the server does on boot.
    await ensureBtsAgreementKbContent();

    // Task #1401 citable gate: chat retrieval now requires
    //   doc_class IN ('curated','overview') AND last_verified IS NOT NULL.
    // The seed hook lands these refund/glossary docs as curated but HELD
    // (last_verified NULL), so they are non-citable until a human verifies
    // them. Mark the curated docs verified here so this retrieval guard
    // exercises genuinely citable docs (mirrors a post-review verified state).
    await db.execute(
      sql`UPDATE knowledgebase_docs
          SET last_verified = NOW()
          WHERE doc_class = 'curated' AND last_verified IS NULL`,
    );

    // Task #1531 cutover: the assistant now retrieves from ai_live_documents.
    // The seed hook still authors the citable truth into the legacy table (the
    // member-facing /kb/search reads it), so mirror the freshly-verified citable
    // set into ai_live_documents exactly as the boot sequence does on boot,
    // otherwise the retrieval below finds nothing.
    await syncCitableDocsToLiveDocuments();
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
    // Negative probe: a query that shares no lexical terms with the refund /
    // Agreement / guarantee corpus must never surface the refund articles.
    //
    // The original "when is the next live coaching call" probe no longer works
    // under the Task #1401 citable gate: coaching content is now
    // doc_class='transcript' (excluded from retrieval), while the
    // refund-requirements article legitimately mentions attending live coaching
    // calls as a refund condition — so once the coaching transcripts are gone
    // it can become the best lexical match for that phrasing. Use a topic whose
    // every lexeme is absent from the refund / Agreement / glossary corpus so
    // neither the primary tsquery nor the looser word-OR fallback can surface a
    // refund doc.
    const results = await searchKnowledgebase(
      "how do I reset my password",
      MEMBER_CATEGORIES,
    );
    const titles = results.map((r) => r.title);
    expect(titles).not.toContain(REFUND_REQUIREMENTS_TITLE);
    expect(titles).not.toContain(REFUND_REQUEST_TITLE);
  });
});
