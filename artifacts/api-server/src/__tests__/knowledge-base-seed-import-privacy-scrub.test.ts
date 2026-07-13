import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { db, knowledgebaseDocsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { seedKnowledgebaseFromFiles } from "../lib/seed-kb";

/**
 * Pin the privacy scrub on the bulk SEED import path.
 *
 * The admin manual create/edit and staging "push to live" write paths are
 * covered by knowledge-base-db-privacy-scrub.test.ts. The fourth way content
 * reaches knowledgebase_docs is the bulk file importer
 * (seedKnowledgebaseFromFiles), which parses src/knowledge-base/*.txt and
 * inserts the rows. It must route every title/content through
 * scrubPrivateContent() too — otherwise a forbidden coach surname could be
 * re-introduced wholesale by a re-seed.
 *
 * This test plants a forbidden coach FULL name into the source files, runs the
 * real importer, and asserts the persisted row keeps only the first name. To
 * keep the run fast and the DB clean it temporarily reduces the source files to
 * a single probe document (the importer reads fixed filenames from
 * src/knowledge-base), then restores them. Vitest runs single-fork/sequential
 * here, so this file never races other suites that touch the same sources.
 */

const KB_DIR = path.join(process.cwd(), "src/knowledge-base");

// Every file the importer reads. We snapshot each so we can restore byte-for-byte.
const SOURCE_FILES = [
  "training-documents.txt",
  "video-transcripts.txt",
  "qa-articles.txt",
  "glossary.txt",
];

const TEST_TAG = `kb-seed-scrub-${randomUUID().slice(0, 8)}`;

// Bruce Clark -> "Bruce". A unique marker keeps the planted row identifiable.
const FORBIDDEN_FULL_NAME = "Bruce Clark";
const ALLOWED_FIRST_NAME = "Bruce";
const FORBIDDEN_SURNAME = "Clark";

const PROBE_TITLE = `${TEST_TAG} seed ${FORBIDDEN_FULL_NAME} guide`;
const SCRUBBED_TITLE = PROBE_TITLE.replace(FORBIDDEN_FULL_NAME, ALLOWED_FIRST_NAME);

// A single training-document section the importer's parser understands: a
// "Title:" line, an optional "Category:" line, then content beginning at the
// first heading ("#").
const PROBE_TRAINING_DOC = [
  `Title: ${PROBE_TITLE}`,
  "Category: faq",
  `# ${TEST_TAG} seed probe`,
  `Reach out to ${FORBIDDEN_FULL_NAME} about campaign reviews on DIYTrax.`,
  "",
].join("\n");

const originals = new Map<string, string>();
for (const name of SOURCE_FILES) {
  originals.set(name, fs.readFileSync(path.join(KB_DIR, name), "utf-8"));
}

function restoreSources(): void {
  for (const [name, content] of originals) {
    fs.writeFileSync(path.join(KB_DIR, name), content, "utf-8");
  }
}

const seededTitles: string[] = [PROBE_TITLE, SCRUBBED_TITLE];

afterAll(async () => {
  restoreSources();
  await db
    .delete(knowledgebaseDocsTable)
    .where(inArray(knowledgebaseDocsTable.title, seededTitles));
});

describe("knowledgebase_docs bulk seed import — coach surname privacy scrub", () => {
  it("strips a coach surname when seedKnowledgebaseFromFiles() ingests the source files", async () => {
    try {
      // Reduce the sources to just our probe doc so the importer inserts one
      // row (and stays fast) instead of re-seeding the entire knowledge base.
      fs.writeFileSync(
        path.join(KB_DIR, "training-documents.txt"),
        PROBE_TRAINING_DOC,
        "utf-8",
      );
      for (const name of SOURCE_FILES) {
        if (name === "training-documents.txt") continue;
        fs.writeFileSync(path.join(KB_DIR, name), "", "utf-8");
      }

      await seedKnowledgebaseFromFiles();

      // The title itself is scrubbed on the way in, so look it up by the
      // scrubbed form. The raw "Bruce Clark" title must not exist.
      const rawTitleRows = await db
        .select()
        .from(knowledgebaseDocsTable)
        .where(eq(knowledgebaseDocsTable.title, PROBE_TITLE));
      expect(rawTitleRows).toHaveLength(0);

      const [stored] = await db
        .select()
        .from(knowledgebaseDocsTable)
        .where(eq(knowledgebaseDocsTable.title, SCRUBBED_TITLE));

      expect(stored).toBeDefined();
      expect(stored.title).toContain(ALLOWED_FIRST_NAME);
      expect(stored.title).not.toContain(FORBIDDEN_SURNAME);
      expect(stored.content).toContain(ALLOWED_FIRST_NAME);
      expect(stored.content).not.toContain(FORBIDDEN_FULL_NAME);
      expect(stored.content).not.toContain(FORBIDDEN_SURNAME);
    } finally {
      restoreSources();
    }
  });
});
