import { describe, it, expect } from "vitest";
import { scrubKbDoc } from "../lib/content-privacy-filter";

/**
 * Direct unit tests for the `scrubKbDoc()` convenience wrapper in
 * lib/content-privacy-filter.ts. Most ingestion call sites invoke this wrapper
 * rather than scrubPrivateContent() directly, so its field-selective behavior
 * is pinned here:
 *   - it scrubs ONLY `title` and `content`
 *   - it leaves every other field untouched
 *   - it only touches fields that are actually present (uses `=== undefined`),
 *     so a missing key is never introduced
 *
 * A future refactor could accidentally scrub the wrong field, drop a field, or
 * stop scrubbing one of title/content — these tests catch that.
 */

describe("scrubKbDoc — field-selective scrubbing", () => {
  it("scrubs both title and content, leaving unrelated fields unchanged", () => {
    const doc = {
      id: 42,
      category: "onboarding",
      title: "Meet Sasha Bobylev",
      content: "Adam Cherrington and Michael Wissbaum run the call.",
    };

    const out = scrubKbDoc(doc);

    expect(out.title).toBe("Meet Sasha");
    expect(out.content).toBe("the instructor and Michael run the call.");
    // Unrelated fields pass through untouched.
    expect(out.id).toBe(42);
    expect(out.category).toBe("onboarding");
  });

  it("returns a new object without mutating the input", () => {
    const doc = {
      id: 1,
      title: "Sasha Bobylev",
      content: "Bruce Clark hosts",
    };

    const out = scrubKbDoc(doc);

    expect(out).not.toBe(doc);
    expect(doc.title).toBe("Sasha Bobylev");
    expect(doc.content).toBe("Bruce Clark hosts");
  });
});

describe("scrubKbDoc — only-present-fields behavior", () => {
  it("handles a doc with only `content` (no `title`) without adding a title key", () => {
    const doc = { id: 7, content: "Call Todd Rupp today" };

    const out = scrubKbDoc(doc);

    expect(out.content).toBe("Call Todd today");
    expect("title" in out).toBe(false);
    expect(out.id).toBe(7);
  });

  it("handles a doc with only `title` (no `content`) without adding a content key", () => {
    const doc = { id: 9, title: "Robin Shepard's session" };

    const out = scrubKbDoc(doc);

    expect(out.title).toBe("Robin's session");
    expect("content" in out).toBe(false);
    expect(out.id).toBe(9);
  });

  it("scrubs an explicit null title/content in place (present but nullish)", () => {
    const doc = { id: 3, title: null, content: null };

    const out = scrubKbDoc(doc);

    // null is present (not undefined), so it is scrubbed -> "" per scrubPrivateContent.
    expect(out.title).toBe("");
    expect(out.content).toBe("");
    expect(out.id).toBe(3);
  });
});
