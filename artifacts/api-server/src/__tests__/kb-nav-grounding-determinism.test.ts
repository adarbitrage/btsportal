/**
 * Navigation-grounding determinism (Task #1847).
 *
 * The "where do I find X" grounding lookup must ALWAYS return the actual
 * portal navigation map doc (doc_class = 'navigation'), never a satellite doc
 * that happens to share the operations/navigation filing (e.g. per-node
 * synthesis satellites like "What is MetricMover?"). Before this fix the
 * lookup was an unordered LIMIT 1 over everything filed at
 * operations/navigation.
 *
 * DB-backed: inserts a throwaway satellite fixture at operations/navigation
 * and asserts the grounding path still picks the doc_class='navigation' doc.
 *
 * Run: npx vitest run src/__tests__/kb-nav-grounding-determinism.test.ts --pool=threads --no-file-parallelism
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// Lexical-only: the semantic layer is irrelevant to nav grounding.
vi.mock("../lib/kb-embeddings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/kb-embeddings.js")>();
  return { ...actual, embedQuery: vi.fn(async () => null) };
});

import { retrieveSurfaceAware } from "../lib/kb-retrieval";

const SATELLITE_TITLE =
  "zzqx nav-satellite fixture doc (Task #1847 test fixture)";

let satelliteId = 0;

beforeAll(async () => {
  await db.execute(
    sql`DELETE FROM ai_live_documents WHERE title = ${SATELLITE_TITLE}`,
  );
  // A citable satellite filed at operations/navigation but NOT the nav map.
  const res = await db.execute(sql`
    INSERT INTO ai_live_documents
      (title, category, content, audience, doc_class, home_root, node, last_verified)
    VALUES
      (${SATELLITE_TITLE}, 'operations',
       'A satellite doc that merely shares the navigation filing.',
       'member', 'curated', 'operations', 'navigation', NOW())
    RETURNING id`);
  satelliteId = Number((res.rows[0] as { id: number }).id);
});

afterAll(async () => {
  if (satelliteId) {
    await db.execute(sql`DELETE FROM ai_live_documents WHERE id = ${satelliteId}`);
  }
});

describe("navigation grounding determinism", () => {
  it("returns the actual navigation-map doc, never a co-filed satellite", async () => {
    // categories: [] short-circuits to the nav-grounded doc only.
    const result = await retrieveSurfaceAware("where do I find my invoices", {
      surface: "chat",
      categories: [],
      limit: 6,
    });
    expect(result.isNavigationQuery).toBe(true);
    expect(result.docs.length).toBe(1);
    const doc = result.docs[0];
    expect(doc.title).not.toBe(SATELLITE_TITLE);
    // The nav map doc is filed as 'overview' today ('navigation' preferred if
    // one ever exists) — never a plain curated/transcript satellite.
    expect(["navigation", "overview"]).toContain(doc.docClass);
  });
});
