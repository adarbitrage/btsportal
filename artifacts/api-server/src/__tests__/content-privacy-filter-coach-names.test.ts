import { describe, it, expect } from "vitest";
import { scrubPrivateContent } from "../lib/content-privacy-filter";

describe("content privacy filter — coaches use first names only", () => {
  it("replaces coach full names with first names only", () => {
    expect(scrubPrivateContent("Sasha Bobylev hosted the call")).toBe(
      "Sasha hosted the call",
    );
    expect(scrubPrivateContent("Ask Bruce Clark about it")).toBe(
      "Ask Bruce about it",
    );
    expect(scrubPrivateContent("Todd Rupp runs Fridays")).toBe(
      "Todd runs Fridays",
    );
    expect(scrubPrivateContent("Robin Shepard does 1:1s")).toBe(
      "Robin does 1:1s",
    );
  });

  it("handles the 'Wissbaum'/'Wisbaum' spelling variants", () => {
    expect(scrubPrivateContent("call with Michael Wissbaum tonight")).toBe(
      "call with Michael tonight",
    );
    expect(scrubPrivateContent("hosted by Michael Wisbaum and Todd")).toBe(
      "hosted by Michael and Todd",
    );
  });

  it("strips orphaned coach surnames left over from chunk splits", () => {
    expect(scrubPrivateContent("Wisbaum, Sasha tonight").trim()).toBe(
      ", Sasha tonight",
    );
    expect(scrubPrivateContent("Bobilev was here").trim()).toBe("was here");
  });

  it("never leaks a coach surname in any casing", () => {
    const surnames = ["Bobylev", "Bobilev", "Wissbaum", "Wisbaum", "Rupp", "Shepard"];
    const out = scrubPrivateContent(
      "Coaches: Sasha Bobylev, Michael Wisbaum, Todd Rupp, Robin Shepard and Bruce Clark.",
    );
    for (const surname of surnames) {
      expect(out.toLowerCase()).not.toContain(surname.toLowerCase());
    }
    expect(out).toContain("Sasha");
    expect(out).toContain("Michael");
    expect(out).toContain("Todd");
    expect(out).toContain("Robin");
    expect(out).toContain("Bruce");
  });
});
