/**
 * Task #2003: the admin Content-Gap Radar must surface the near-miss-rescued
 * flag so authors can tell "member got nothing" from "member got a hedged
 * answer that barely cleared retrieval".
 *
 * Source-contract test (no DB): asserts the list route selects the flag,
 * supports the ?band=rescued|hard filter, and reports a rescued summary count.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routeSource = readFileSync(
  join(__dirname, "..", "routes", "admin-content-gaps.ts"),
  "utf8",
);

describe("admin content-gaps near-miss-rescued exposure", () => {
  it("selects nearMissRescued in the list rows", () => {
    expect(routeSource).toContain(
      "nearMissRescued: contentGapQuestionsTable.nearMissRescued",
    );
  });

  it("supports the band filter for rescued vs hard gaps", () => {
    expect(routeSource).toContain('str === "rescued" || str === "hard"');
    expect(routeSource).toContain('band === "rescued"');
    // Filter must go through the same conditions array as surface so
    // pagination/counts stay consistent.
    expect(routeSource).toMatch(
      /conditions\.push\(\s*eq\(contentGapQuestionsTable\.nearMissRescued/,
    );
  });

  it("reports a rescuedQuestions summary count", () => {
    expect(routeSource).toContain("rescuedQuestions");
    expect(routeSource).toContain("rescuedQuestions: summaryRow?.rescuedQuestions ?? 0");
  });
});
