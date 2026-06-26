import { describe, it, expect } from "vitest";
import {
  isProcessNode,
  isCeiling,
  isHandoffTarget,
  isTag,
  PROCESS_NODES,
  BLITZ_SECTION_TO_NODE,
} from "../lib/kb-taxonomy";
import { buildProcessDocs } from "../lib/seed-process-kb";

describe("Process curated docs", () => {
  const docs = buildProcessDocs();

  it("every doc carries a complete, valid taxonomy and is shaped to be citable", () => {
    expect(docs.length).toBeGreaterThan(0);
    const slugs = docs.map((d) => d.slug);
    expect(new Set(slugs).size, "doc slugs are unique").toBe(slugs.length);
    const titles = docs.map((d) => d.title);
    expect(new Set(titles).size, "doc titles are unique (title is the upsert key)").toBe(
      titles.length,
    );
    for (const d of docs) {
      expect(d.title.trim().length).toBeGreaterThan(0);
      expect(d.content.trim().length).toBeGreaterThan(0);
      expect(isProcessNode(d.node), `"${d.title}" → real process node`).toBe(true);
      expect(isCeiling(d.ceiling)).toBe(true);
      expect(isHandoffTarget(d.handoff)).toBe(true);
      // Citable doc classes only (curated / overview) — never transcript.
      expect(["curated", "overview"]).toContain(d.docClass);
      expect(d.sourcePath.startsWith("/")).toBe(true);
      // Every tag is a real registry tag.
      for (const t of d.tags) {
        expect(isTag(t), `"${d.title}" tag "${t}" is in the registry vocabulary`).toBe(true);
      }
    }
  });

  it("every doc's Blitz section maps to its declared Process node", () => {
    for (const d of docs) {
      expect(d.blitzSection, `"${d.title}" has a Blitz section`).toBeGreaterThanOrEqual(1);
      expect(BLITZ_SECTION_TO_NODE[d.blitzSection], `"${d.title}" Blitz→node consistent`).toBe(
        d.node,
      );
    }
  });

  it("covers every Process node with at least one verified doc", () => {
    const covered = new Set(docs.map((d) => d.node));
    for (const node of PROCESS_NODES) {
      expect(covered.has(node.slug), `Process node "${node.slug}" has no verified doc`).toBe(true);
    }
  });

  it("front-loads the highest-demand tool/step gaps", () => {
    const slugs = new Set(docs.map((d) => d.slug));
    for (const required of [
      "process-diytrax-overview",
      "process-flexy-landing-pages",
      "process-metricmover-overview",
      "process-caterpillar-go-live",
    ]) {
      expect(slugs.has(required), `missing high-demand Process doc "${required}"`).toBe(true);
    }
    // The DIYTrax overview is the single highest-demand gap → authored first.
    expect(docs[0]!.slug).toBe("process-diytrax-overview");
  });

  it("uses current BTS terminology, not retired brand / product / day-count names", () => {
    for (const d of docs) {
      const text = `${d.title}\n${d.content}`;
      expect(text, `"${d.title}" must not name a retired brand`).not.toMatch(/cherrington/i);
      expect(text, `"${d.title}" must not use a day-count Blitz`).not.toMatch(
        /\b\d+\s*-?\s*day\s+blitz/i,
      );
      // Current product spellings only — never the legacy "Flexi" / "DIY Tracks".
      expect(text, `"${d.title}" must say "Flexy", not "Flexi"`).not.toMatch(/\bFlexi\b/);
      expect(text, `"${d.title}" must say "DIYTrax", not "DIY Tracks"`).not.toMatch(
        /\bDIY\s+Tracks?\b/i,
      );
      // Retired networks must not be promoted as current options.
      expect(text).not.toMatch(/\bMaxWeb\b/i);
      expect(text).not.toMatch(/\bAffiliati\b/i);
    }
  });

  it("represents both handoff targets across the campaign (conceptual→coaching, how-to→support)", () => {
    const handoffs = new Set(docs.map((d) => d.handoff));
    expect(handoffs.has("coaching")).toBe(true);
    expect(handoffs.has("support")).toBe(true);
  });
});
