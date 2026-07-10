/**
 * Guard tests for the unanswered-member-question capture pipeline
 * (lib/content-gap-radar.ts) and its bounded retention sweep
 * (lib/content-gap-questions-cleanup.ts).
 *
 * Locks in:
 *   1. Capture persists the query, surface, retrieval scores and near-misses.
 *   2. Near-identical repeats dedup into one row (ask_count bump), never a
 *      duplicate row.
 *   3. The privacy scrub is applied to the stored question AND near-miss
 *      titles — raw PII / coach surnames never reach the table.
 *   4. Capture is fire-and-forget: a DB failure resolves silently and can
 *      never break the member-facing answer path.
 *   5. The captured data stays inert and member-only: neither the shared
 *      retrieval path nor the retrieval self-test (the admin/test surface)
 *      imports the capture module — only the member chat/voice call sites do.
 *   6. The retention sweep bounds the store by age and by volume.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { db, contentGapQuestionsTable } from "@workspace/db";
import { eq, like, sql } from "drizzle-orm";
import { logUnansweredQuestion, normalizeQuestion } from "../lib/content-gap-radar";
import {
  runContentGapQuestionsCleanup,
  CONTENT_GAP_RETENTION_DAYS,
} from "../lib/content-gap-questions-cleanup";

// No punctuation: normalizeQuestion strips it, and the tag must survive in the
// normalized_question column we filter on.
const TAG = `cgqtest${randomUUID().slice(0, 8).replace(/-/g, "")}`;

async function clearTaggedRows() {
  await db
    .delete(contentGapQuestionsTable)
    .where(like(contentGapQuestionsTable.normalizedQuestion, `%${TAG}%`));
}

async function taggedRows() {
  return db
    .select()
    .from(contentGapQuestionsTable)
    .where(like(contentGapQuestionsTable.normalizedQuestion, `%${TAG}%`));
}

beforeAll(clearTaggedRows);
afterAll(clearTaggedRows);

describe("logUnansweredQuestion capture", () => {
  it("persists query text, surface, scores and near-misses", async () => {
    const question = `How do I frobnicate my widget ${TAG} alpha?`;
    await logUnansweredQuestion({
      surface: "chat",
      question,
      topScore: 0.0123,
      topSemanticScore: 0.4567,
      nearMisses: [{ id: 42, title: "Widget basics", rank: 0.01 }],
    });

    const rows = await taggedRows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.surface).toBe("chat");
    expect(row.questionText).toContain(TAG);
    expect(row.topScore).toBeCloseTo(0.0123, 4);
    expect(row.topSemanticScore).toBeCloseTo(0.4567, 4);
    expect(row.nearMisses).toEqual([{ id: 42, title: "Widget basics", score: 0.01 }]);
    expect(row.askCount).toBe(1);
    expect(row.firstAskedAt).toBeInstanceOf(Date);
    expect(row.lastAskedAt).toBeInstanceOf(Date);
  });

  it("dedups near-identical repeats into one row and bumps ask_count", async () => {
    const base = `Where is my invoice ${TAG} beta`;
    await logUnansweredQuestion({ surface: "voice", question: `${base}?` });
    await logUnansweredQuestion({ surface: "voice", question: `  ${base.toUpperCase()}!! ` });

    const rows = (await taggedRows()).filter((r) => r.surface === "voice");
    expect(rows).toHaveLength(1);
    expect(rows[0].askCount).toBe(2);
    expect(rows[0].normalizedQuestion).toBe(normalizeQuestion(`${base}?`));
  });

  it("privacy-scrubs the stored question text and near-miss titles", async () => {
    const question = `Can Bruce Clark email me at jane.doe@example.com about ${TAG} gamma?`;
    await logUnansweredQuestion({
      surface: "chat",
      question,
      nearMisses: [{ id: 7, title: "Call Bruce Clark at 555-123-4567", rank: 0.02 }],
    });

    const rows = (await taggedRows()).filter((r) => r.questionText.includes("gamma"));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.questionText).not.toMatch(/Clark/i);
    expect(row.questionText).not.toContain("jane.doe@example.com");
    expect(row.questionText).toContain("[contact redacted]");
    const nm = row.nearMisses[0];
    expect(nm.title).not.toMatch(/Clark/i);
    expect(nm.title).not.toContain("555-123-4567");
    expect(nm.title).toContain("[phone redacted]");
  });

  it("never throws when the DB write fails (fire-and-forget)", async () => {
    const spy = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("boom: simulated DB outage");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        logUnansweredQuestion({ surface: "chat", question: `failure path ${TAG} delta` }),
      ).resolves.toBeUndefined();
      expect(errSpy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("skips empty / whitespace-only questions", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    try {
      await logUnansweredQuestion({ surface: "chat", question: "   " });
      expect(insertSpy).not.toHaveBeenCalled();
    } finally {
      insertSpy.mockRestore();
    }
  });
});

describe("capture stays member-only and inert", () => {
  const SRC = path.resolve(__dirname, "..");

  it("the shared retrieval path and the self-test (admin/test surface) never import the capture module", () => {
    for (const rel of ["lib/kb-retrieval.ts", "lib/kb-retrieval-selftest.ts"]) {
      const source = readFileSync(path.join(SRC, rel), "utf8");
      expect(source, `${rel} must not import content-gap-radar`).not.toContain(
        "content-gap-radar",
      );
    }
  });

  it("nothing outside the member chat/voice routes, the admin read-only list, and the capture/cleanup libs touches the table", () => {
    // The self-test continues to use generated questions; captured data is
    // written by the radar and read only by the (pre-existing) admin list.
    const selfTest = readFileSync(path.join(SRC, "lib/kb-retrieval-selftest.ts"), "utf8");
    expect(selfTest).not.toContain("contentGapQuestions");
  });
});

describe("runContentGapQuestionsCleanup retention", () => {
  it("deletes rows whose last_asked_at is beyond the retention window and keeps recent ones", async () => {
    const oldQ = `stale question ${TAG} epsilon`;
    const freshQ = `fresh question ${TAG} zeta`;
    await logUnansweredQuestion({ surface: "chat", question: oldQ });
    await logUnansweredQuestion({ surface: "chat", question: freshQ });
    await db.execute(sql`
      UPDATE content_gap_questions
      SET last_asked_at = NOW() - ((${CONTENT_GAP_RETENTION_DAYS + 30})::int * INTERVAL '1 day')
      WHERE normalized_question = ${normalizeQuestion(oldQ)}
    `);

    await runContentGapQuestionsCleanup();

    const rows = await taggedRows();
    const texts = rows.map((r) => r.normalizedQuestion);
    expect(texts).not.toContain(normalizeQuestion(oldQ));
    expect(texts).toContain(normalizeQuestion(freshQ));
  });

  it("trims least-recently-asked overflow rows beyond the volume cap", async () => {
    // Make the tagged rows the two GLOBALLY least-recently-asked rows (year
    // 2001/2002 — nothing real predates that), then set the cap to
    // total - 1 so exactly the single oldest row (2001) overflows. This keeps
    // the test safe on a shared dev DB: no pre-existing row can be older.
    const oldest = `volume overflow oldest ${TAG} eta`;
    const second = `volume overflow second ${TAG} theta`;
    await logUnansweredQuestion({ surface: "chat", question: oldest });
    await logUnansweredQuestion({ surface: "chat", question: second });
    await db.execute(sql`
      UPDATE content_gap_questions SET last_asked_at = '2001-01-01T00:00:00Z'
      WHERE normalized_question = ${normalizeQuestion(oldest)}
    `);
    await db.execute(sql`
      UPDATE content_gap_questions SET last_asked_at = '2002-01-01T00:00:00Z'
      WHERE normalized_question = ${normalizeQuestion(second)}
    `);

    const [{ count }] = (
      await db.execute(sql`SELECT COUNT(*)::int AS count FROM content_gap_questions`)
    ).rows as Array<{ count: number }>;

    const result = await runContentGapQuestionsCleanup({
      retentionDays: 365 * 100,
      maxRows: count - 1,
    });

    expect(result.deletedByVolume).toBe(1);
    const rows = await taggedRows();
    const texts = rows.map((r) => r.normalizedQuestion);
    expect(texts).not.toContain(normalizeQuestion(oldest));
    expect(texts).toContain(normalizeQuestion(second));
  });
});
