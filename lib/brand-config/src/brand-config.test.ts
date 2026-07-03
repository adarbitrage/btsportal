import { describe, expect, it } from "vitest";
import { brandStrings, brandTokens, BRAND_TABLE } from "./brand-config";
import { substituteTipTapDoc, substituteString } from "./substitute";

// ─── brandTokens ─────────────────────────────────────────────────────────────

const TM = "\u2122";

describe("brandTokens", () => {
  it("returns all four token keys for a known slug", () => {
    const tokens = brandTokens("yse_front_end");
    expect(tokens["brand"]).toBe(`Your Second Engine${TM}`);
    expect(tokens["brand.short"]).toBe("YSE");
    expect(tokens["brand.possessive"]).toBe("Your Second Engine's");
    expect(tokens["brand.short.possessive"]).toBe("YSE's");
  });

  it("derives possessive with apostrophe-only when name ends in s", () => {
    const tokens = brandTokens("bts");
    expect(tokens["brand"]).toBe(`Build Test Scale${TM}`);
    expect(tokens["brand.possessive"]).toBe("Build Test Scale's");
    expect(tokens["brand.short"]).toBe("BTS");
    expect(tokens["brand.short.possessive"]).toBe("BTS'");
  });

  it("falls back to bts entry for an unknown slug", () => {
    const tokens = brandTokens("nonexistent_slug");
    expect(tokens["brand"]).toBe(`${BRAND_TABLE.bts.full}${TM}`);
    expect(tokens["brand.short"]).toBe(BRAND_TABLE.bts.short);
  });

  it("covers every locked brand slug without throwing", () => {
    const slugs = Object.keys(BRAND_TABLE) as (keyof typeof BRAND_TABLE)[];
    for (const slug of slugs) {
      const tokens = brandTokens(slug);
      expect(typeof tokens["brand"]).toBe("string");
      expect(typeof tokens["brand.short"]).toBe("string");
      expect(typeof tokens["brand.possessive"]).toBe("string");
      expect(typeof tokens["brand.short.possessive"]).toBe("string");
    }
  });

  it("marks the full name with a trademark glyph for every brand", () => {
    const slugs = Object.keys(BRAND_TABLE) as (keyof typeof BRAND_TABLE)[];
    for (const slug of slugs) {
      const tokens = brandTokens(slug);
      expect(tokens["brand"]).toBe(`${BRAND_TABLE[slug].full}${TM}`);
      expect(tokens["brand"].endsWith(TM)).toBe(true);
    }
  });

  it("never marks the short form", () => {
    const slugs = Object.keys(BRAND_TABLE) as (keyof typeof BRAND_TABLE)[];
    for (const slug of slugs) {
      const tokens = brandTokens(slug);
      expect(tokens["brand.short"]).toBe(BRAND_TABLE[slug].short);
      expect(tokens["brand.short"].includes(TM)).toBe(false);
    }
  });

  it("derives the possessive from the UNMARKED name (no glyph mid-word)", () => {
    const slugs = Object.keys(BRAND_TABLE) as (keyof typeof BRAND_TABLE)[];
    for (const slug of slugs) {
      const tokens = brandTokens(slug);
      expect(tokens["brand.possessive"].includes(TM)).toBe(false);
      const expected = BRAND_TABLE[slug].full.toLowerCase().endsWith("s")
        ? `${BRAND_TABLE[slug].full}'`
        : `${BRAND_TABLE[slug].full}'s`;
      expect(tokens["brand.possessive"]).toBe(expected);
    }
  });
});

// ─── brandStrings ─────────────────────────────────────────────────────────────

describe("brandStrings", () => {
  it("returns structured strings for a known slug", () => {
    const s = brandStrings("backroad");
    expect(s.full).toBe(`The Backroad System${TM}`);
    expect(s.short).toBe("Backroad");
    expect(s.possessive).toBe("The Backroad System's");
    expect(s.shortPossessive).toBe("Backroad's");
  });

  it("falls back to bts for an unknown slug", () => {
    const s = brandStrings("unknown");
    expect(s.full).toBe(`${BRAND_TABLE.bts.full}${TM}`);
    expect(s.short).toBe(BRAND_TABLE.bts.short);
  });

  it("marks every brand's full name and keeps possessive forms unmarked", () => {
    const slugs = Object.keys(BRAND_TABLE) as (keyof typeof BRAND_TABLE)[];
    for (const slug of slugs) {
      const s = brandStrings(slug);
      expect(s.full).toBe(`${BRAND_TABLE[slug].full}${TM}`);
      expect(s.short).toBe(BRAND_TABLE[slug].short);
      expect(s.possessive.includes(TM)).toBe(false);
      expect(s.shortPossessive.includes(TM)).toBe(false);
    }
  });
});

// ─── substituteString ────────────────────────────────────────────────────────

describe("substituteString", () => {
  const yse = brandTokens("yse_front_end");

  it("replaces a known token", () => {
    expect(substituteString("Welcome to {{brand}}", yse)).toBe(
      `Welcome to Your Second Engine${TM}`,
    );
  });

  it("leaves an unknown token literal (not empty string)", () => {
    expect(substituteString("Visit {{unknown}}", yse)).toBe("Visit {{unknown}}");
  });

  it("replaces multiple tokens in one pass", () => {
    const result = substituteString(
      "{{brand}} ({{brand.short}}) is {{brand.possessive}} community",
      yse,
    );
    expect(result).toBe(
      `Your Second Engine${TM} (YSE) is Your Second Engine's community`,
    );
  });

  it("handles whitespace inside braces", () => {
    expect(substituteString("Hello {{ brand }}", yse)).toBe(
      `Hello Your Second Engine${TM}`,
    );
  });

  it("handles dotted token keys (brand.short)", () => {
    expect(substituteString("Short: {{brand.short}}", yse)).toBe("Short: YSE");
  });

  it("is idempotent on text with no tokens", () => {
    const plain = "No tokens here.";
    expect(substituteString(plain, yse)).toBe(plain);
  });

  it("does not mutate the tokens map", () => {
    const tokens = { brand: "Test" };
    const before = JSON.stringify(tokens);
    substituteString("{{brand}}", tokens);
    expect(JSON.stringify(tokens)).toBe(before);
  });
});

// ─── substituteTipTapDoc ─────────────────────────────────────────────────────

describe("substituteTipTapDoc", () => {
  const yse = brandTokens("yse_front_end");

  const sampleDoc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Welcome to {{brand}}",
            marks: [{ type: "bold" }],
          },
          {
            type: "text",
            marks: [
              {
                type: "link",
                attrs: { href: "https://example.com/{{brand}}", target: "_blank" },
              },
            ],
            text: "click here",
          },
        ],
      },
    ],
  };

  it("substitutes text in text nodes", () => {
    const result = substituteTipTapDoc(sampleDoc, yse);
    const para = result.content![0];
    expect(para.content![0].text).toBe(`Welcome to Your Second Engine${TM}`);
  });

  it("leaves the second text node text unchanged (no token)", () => {
    const result = substituteTipTapDoc(sampleDoc, yse);
    const para = result.content![0];
    expect(para.content![1].text).toBe("click here");
  });

  it("does NOT touch href in link mark attrs", () => {
    const result = substituteTipTapDoc(sampleDoc, yse);
    const linkNode = result.content![0].content![1];
    const mark = (linkNode.marks as Array<{ type: string; attrs: { href: string } }>)[0];
    expect(mark.attrs.href).toBe("https://example.com/{{brand}}");
  });

  it("does NOT mutate the original document", () => {
    const original = JSON.stringify(sampleDoc);
    substituteTipTapDoc(sampleDoc, yse);
    expect(JSON.stringify(sampleDoc)).toBe(original);
  });

  it("preserves node type and structure byte-identical", () => {
    const result = substituteTipTapDoc(sampleDoc, yse);
    expect(result.type).toBe("doc");
    expect(result.content![0].type).toBe("paragraph");
    expect(result.content![0].content![0].type).toBe("text");
    expect((result.content![0].content![0].marks as unknown[]).length).toBe(1);
  });

  it("leaves unknown tokens literal inside text nodes", () => {
    const doc = {
      type: "doc",
      content: [{ type: "text", text: "Hello {{unknown}}" }],
    };
    const result = substituteTipTapDoc(doc, yse);
    expect(result.content![0].text).toBe("Hello {{unknown}}");
  });

  it("handles a document with no text nodes without error", () => {
    const doc = { type: "doc", content: [{ type: "hardBreak" }] };
    expect(() => substituteTipTapDoc(doc, yse)).not.toThrow();
  });
});
