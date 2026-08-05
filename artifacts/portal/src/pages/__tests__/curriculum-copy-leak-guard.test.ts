/**
 * Bundle leak guard: front-end curriculum copy must never ship in the portal
 * client. The 7 Pillars / Quick-Start / Pillars-to-Blitz / Tips & Tricks
 * bodies live server-side (gated /curriculum/<key> endpoints); this test
 * scans every file under portal/src for distinctive course phrases so a
 * re-inline regression fails loudly at test time (the portal build has no
 * tsc/leak check of its own).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

// Distinctive phrases from each of the four gated pages' course bodies.
// Chosen to be unique prose (not UI chrome) so false positives are unlikely.
const FORBIDDEN_PHRASES = [
  // 7 Pillars prose
  "your pathway to success is already paved",
  "plenty of inventory to purchase",
  // Quick-Start
  "25+ years and $75M in ad spend",
  // Pillars-to-Blitz
  "A bridge from the 7 Pillars",
  // Tips & Tricks Vidalytics embed ids (fetched from the gated endpoint)
  "qgpAV6gDFy_EujDM",
  "smS9hAL9_0kXcPsf",
];

const SRC_ROOT = path.resolve(__dirname, "../..");
const THIS_FILE = path.resolve(__dirname, "curriculum-copy-leak-guard.test.ts");

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      collectFiles(full, out);
    } else if (/\.(tsx?|jsx?|html|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("curriculum copy leak guard", () => {
  const files = collectFiles(SRC_ROOT).filter((f) => f !== THIS_FILE);

  it("scans a plausible number of source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const phrase of FORBIDDEN_PHRASES) {
    it(`"${phrase}" does not appear anywhere in portal/src`, () => {
      const offenders = files.filter((f) => readFileSync(f, "utf8").includes(phrase));
      expect(
        offenders.map((f) => path.relative(SRC_ROOT, f)),
      ).toEqual([]);
    });
  }
});
