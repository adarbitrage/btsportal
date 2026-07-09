import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { searchKnowledgebaseForVoice } from "../routes/voice";
import { seedLiveDocsFromCitableLegacyForTest } from "./kb-live-docs-test-seed";

// Privacy guard for the voice assistant's PRIMARY retrieval path.
//
// The 800-number / web voice agent answers members from
// `searchKnowledgebaseForVoice()` in routes/voice.ts. Coaching/curriculum call
// recordings are stored as `doc_class='transcript'` and hand-written docs sit at
// `last_verified IS NULL` until a human verifies them — neither must ever reach a
// member-facing answer. The citable gate (`citableDocFilter()`) enforces this,
// but a prior regression left it ONLY on the fallback query, so the common
// primary-result case silently leaked transcript content. This test seeds a
// transcript doc, an unverified curated doc, and a verified curated doc that all
// share one distinctive token, then asserts the voice search returns ONLY the
// verified one.

const TOKEN = "zzqxvoicecitabletoken";
const TRANSCRIPT_TITLE = `Voice Exclusion Transcript ${TOKEN}`;
const UNVERIFIED_TITLE = `Voice Exclusion Unverified ${TOKEN}`;
const VERIFIED_TITLE = `Voice Exclusion Verified ${TOKEN}`;

async function cleanup() {
  await db.execute(
    sql`DELETE FROM knowledgebase_docs WHERE title LIKE ${"%" + TOKEN + "%"}`,
  );
  // The assistant retrieves from ai_live_documents; the test fixture seeds
  // verified docs there, so clean both tables to keep runs isolated.
  await db.execute(
    sql`DELETE FROM ai_live_documents WHERE title LIKE ${"%" + TOKEN + "%"}`,
  );
}

describe("voice assistant retrieval honors the citable gate (primary path)", () => {
  beforeAll(async () => {
    await cleanup();
    // All three docs are seeded under the Operations root (category 'operations'),
    // which is the voice surface's retrieval scope (Task #1408). This keeps the
    // CITABLE GATE — not the category scope — as the thing that excludes the
    // transcript and unverified docs, so the test genuinely exercises the gate.
    // Transcript: call-recording class — never citable regardless of verification.
    await db.execute(sql`
      INSERT INTO knowledgebase_docs (title, category, content, audience, doc_class, last_verified)
      VALUES (${TRANSCRIPT_TITLE}, 'operations', ${"This is a private call recording about " + TOKEN + " that members must never hear back."}, 'member', 'transcript', NOW())
    `);
    // Unverified curated: right class, but last_verified IS NULL → not yet citable.
    await db.execute(sql`
      INSERT INTO knowledgebase_docs (title, category, content, audience, doc_class, last_verified)
      VALUES (${UNVERIFIED_TITLE}, 'operations', ${"An unverified draft answer about " + TOKEN + " awaiting human review."}, 'member', 'curated', NULL)
    `);
    // Verified curated: the only doc that should ever surface.
    await db.execute(sql`
      INSERT INTO knowledgebase_docs (title, category, content, audience, doc_class, last_verified)
      VALUES (${VERIFIED_TITLE}, 'operations', ${"A human-verified answer about " + TOKEN + " that is safe to cite."}, 'member', 'curated', NOW())
    `);

    // The voice assistant retrieves from ai_live_documents. Production no
    // longer mirrors legacy docs there (boot mirror retired, Task #1826), so
    // copy the citable set as a TEST FIXTURE. Only the verified curated doc
    // qualifies (transcript + unverified are excluded by the citable filter),
    // which still exercises the citable gate on the retrieval side.
    await seedLiveDocsFromCitableLegacyForTest();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("returns the verified curated doc but excludes transcript and unverified docs", async () => {
    const context = await searchKnowledgebaseForVoice(TOKEN);

    // The verified curated doc must surface, proving retrieval isn't globally broken.
    expect(context).toContain("Voice Exclusion Verified");

    // The transcript (call recording) must never reach the voice answer.
    expect(context).not.toContain("Voice Exclusion Transcript");
    expect(context).not.toContain("private call recording");

    // The unverified draft must be held back until a human verifies it.
    expect(context).not.toContain("Voice Exclusion Unverified");
    expect(context).not.toContain("unverified draft");
  });
});
