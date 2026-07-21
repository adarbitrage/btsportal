import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RetrievedDoc, SurfaceRetrievalResult } from "../lib/kb-retrieval";

// Full-context injection regression test.
//
// Contract under guard:
//   • CHAT is the deep assistant: retrieval results are injected into the model
//     prompt with the ENTIRE document content — no truncation anywhere on the
//     chat path, proven with a doc longer than 16,000 characters.
//   • VOICE is the basic support line: its wrapper deliberately trims each doc
//     to title + first 400 characters (answers are spoken by the 800-number
//     agent). That trim is voice-only and must stay.
//
// Both surfaces share ONE retrieval engine (lib/kb-retrieval.ts); we mock it
// here so the test isolates the per-surface prompt/context assembly seams.

vi.mock("../lib/kb-retrieval", () => ({
  retrieveSurfaceAware: vi.fn(),
}));

import { retrieveSurfaceAware } from "../lib/kb-retrieval";
import { searchKnowledgebase, buildRagContext } from "../routes/chat";
import { searchKnowledgebaseForVoice } from "../routes/voice";

const mockRetrieve = vi.mocked(retrieveSurfaceAware);

// Build a >16k-char doc with position-unique content so truncation ANYWHERE
// (start, middle, end) is detectable — not just a length check.
function buildLongContent(): string {
  const parts: string[] = [];
  let i = 0;
  while (parts.join(" ").length <= 16_000) {
    parts.push(`segment-${i++} lorem ipsum affiliate strategy`);
  }
  parts.push("FINAL-SENTINEL-END-OF-DOC");
  return parts.join(" ");
}

const LONG_CONTENT = buildLongContent();

function makeDoc(overrides: Partial<RetrievedDoc> = {}): RetrievedDoc {
  return {
    id: 1,
    title: "Very Long Strategy Doc",
    content: LONG_CONTENT,
    category: "concepts",
    docClass: "curated",
    homeRoot: "concepts",
    node: "angles",
    tags: [],
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
    blitzSection: null,
    rank: 0.5,
    semanticScore: 0,
    grounded: false,
    ...overrides,
  };
}

function makeResult(docs: RetrievedDoc[]): SurfaceRetrievalResult {
  return {
    docs,
    confident: true,
    topScore: 0.5,
    topSemanticScore: 0,
    isNavigationQuery: false,
    detectedTags: [],
  };
}

beforeEach(() => {
  mockRetrieve.mockReset();
});

describe("chat passes FULL document content into the model prompt", () => {
  it("uses a genuinely long fixture (> 16,000 characters)", () => {
    expect(LONG_CONTENT.length).toBeGreaterThan(16_000);
  });

  it("searchKnowledgebase returns the entire content untrimmed", async () => {
    mockRetrieve.mockResolvedValueOnce(makeResult([makeDoc()]));
    const results = await searchKnowledgebase("long question", ["concepts"]);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe(LONG_CONTENT);
    expect(results[0].content.length).toBeGreaterThan(16_000);
    expect(results[0].content.endsWith("FINAL-SENTINEL-END-OF-DOC")).toBe(true);
  });

  it("buildRagContext (the prompt-assembly seam) embeds the entire doc content", () => {
    // buildRagContext is exactly what the chat route appends to the system
    // prompt when retrieval is confident — the full-content contract lives here.
    const ctx = buildRagContext([
      { title: "Very Long Strategy Doc", content: LONG_CONTENT, category: "concepts" },
    ]);
    expect(ctx).toContain(LONG_CONTENT);
    expect(ctx).toContain("[concepts] Very Long Strategy Doc:");
    // The final sentinel proves the tail was not clipped.
    expect(ctx).toContain("FINAL-SENTINEL-END-OF-DOC");
    expect(ctx.length).toBeGreaterThanOrEqual(LONG_CONTENT.length);
  });

  it("embeds every doc in full when multiple docs are retrieved", () => {
    const second = `${LONG_CONTENT} SECOND-DOC-TAIL`;
    const ctx = buildRagContext([
      { title: "Doc A", content: LONG_CONTENT, category: "concepts" },
      { title: "Doc B", content: second, category: "process" },
    ]);
    expect(ctx).toContain(LONG_CONTENT);
    expect(ctx).toContain("SECOND-DOC-TAIL");
  });
});

describe("voice keeps its deliberate 400-char trim", () => {
  it("searchKnowledgebaseForVoice trims each doc to title + first 400 chars", async () => {
    mockRetrieve.mockResolvedValueOnce(makeResult([makeDoc()]));
    const out = await searchKnowledgebaseForVoice("long question");
    // Includes exactly the first 400 characters…
    expect(out).toContain(`Very Long Strategy Doc: ${LONG_CONTENT.slice(0, 400)}`);
    // …and nothing past them: the 401st-onward characters must be absent.
    expect(out).not.toContain(LONG_CONTENT.slice(0, 401));
    expect(out).not.toContain("FINAL-SENTINEL-END-OF-DOC");
    // Sanity bound: title + 400 chars + separators, nowhere near the full doc.
    expect(out.length).toBeLessThan(500);
  });

  it("returns the no-info sentinel when retrieval is not confident", async () => {
    mockRetrieve.mockResolvedValueOnce({ ...makeResult([makeDoc()]), confident: false });
    const out = await searchKnowledgebaseForVoice("long question");
    expect(out).toBe("No relevant information found.");
  });
});
