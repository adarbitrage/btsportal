import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Decoupling guard (Task #1826): the legacy→Live-AI-Documents boot mirror
// (`syncCitableDocsToLiveDocuments`) has been RETIRED. `ai_live_documents` (the
// AI assistant's retrieval corpus) is owned EXCLUSIVELY by the staging-review
// push and the admin Live AI Documents CRUD. The legacy `knowledgebase_docs`
// table remains a separate world (member-facing Knowledge Base only).
//
// Why this matters: the old mirror (a) resurrected live docs an admin deleted
// whenever their legacy twin still existed, and (b) silently leaked any newly-
// seeded legacy/member-KB doc into the AI corpus. These source-level checks
// guard against the coupling being quietly reintroduced.

const SRC_ROOT = path.resolve(__dirname, "..");

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Tests may legitimately copy legacy fixtures into ai_live_documents
      // (see kb-live-docs-test-seed.ts) — only PRODUCTION code is guarded.
      if (entry === "__tests__" || entry === "node_modules") continue;
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("legacy KB → ai_live_documents boot mirror stays retired", () => {
  it("no production module exports or references syncCitableDocsToLiveDocuments", () => {
    const offenders = collectSourceFiles(SRC_ROOT).filter((f) =>
      readFileSync(f, "utf8").includes("syncCitableDocsToLiveDocuments"),
    );
    expect(
      offenders.map((f) => path.relative(SRC_ROOT, f)),
      "the retired legacy→live mirror function has been reintroduced",
    ).toEqual([]);
  });

  it("no production SQL copies knowledgebase_docs into ai_live_documents", () => {
    // Any INSERT INTO ai_live_documents whose statement also selects FROM
    // knowledgebase_docs is a re-coupling of the two corpora.
    const offenders = collectSourceFiles(SRC_ROOT).filter((f) => {
      const src = readFileSync(f, "utf8");
      return /INSERT\s+INTO\s+ai_live_documents[\s\S]{0,2000}?FROM\s+knowledgebase_docs/i.test(src);
    });
    expect(
      offenders.map((f) => path.relative(SRC_ROOT, f)),
      "found production SQL that mirrors legacy knowledgebase_docs into ai_live_documents",
    ).toEqual([]);
  });

  it("the bootstrap module no longer exports the mirror", async () => {
    const bootstrap = await import("../lib/bootstrap-critical-prerequisites");
    expect((bootstrap as Record<string, unknown>).syncCitableDocsToLiveDocuments).toBeUndefined();
  });
});
