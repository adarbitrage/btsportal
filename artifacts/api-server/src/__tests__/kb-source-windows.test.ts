import { describe, it, expect } from "vitest";
import {
  contentWindows,
  isEmptyExtract,
  mergeWindowExtracts,
  fingerprintContent,
  partitionByBudget,
  mapWithConcurrency,
  NONE_MARKER,
} from "../lib/kb-source-windows";

describe("contentWindows", () => {
  it("returns a single window when text fits", () => {
    expect(contentWindows("hello", 10, 2)).toEqual(["hello"]);
    expect(contentWindows("exactly-10", 10, 2)).toEqual(["exactly-10"]);
  });

  it("returns nothing for empty text", () => {
    expect(contentWindows("", 10, 2)).toEqual([]);
  });

  it("splits long text into overlapping windows covering the whole source", () => {
    const text = "abcdefghij"; // 10 chars
    const windows = contentWindows(text, 4, 1); // step = 3
    expect(windows).toEqual(["abcd", "defg", "ghij"]);
    // Every character is covered by at least one window.
    expect(windows.join("").includes("j")).toBe(true);
  });

  it("keeps a boundary-straddling fact intact via overlap", () => {
    const text = "AAAABBBBCCCC";
    const windows = contentWindows(text, 6, 2); // step = 4
    // The "BBBB" run is fully present in the second window.
    expect(windows.some((w) => w.includes("BBBB"))).toBe(true);
  });

  it("covers the whole source even when the last window is short", () => {
    const text = "0123456789X"; // 11 chars
    const windows = contentWindows(text, 5, 1); // step = 4
    const last = windows[windows.length - 1];
    expect(text.endsWith(last[last.length - 1])).toBe(true);
    expect(windows.join("")).toContain("X");
  });

  it("guards against a non-positive step (overlap >= windowSize)", () => {
    const windows = contentWindows("abcdef", 3, 5); // step would be <=0
    // Must still make forward progress and terminate.
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0]).toBe("abc");
  });

  it("treats a non-positive windowSize as a single window", () => {
    expect(contentWindows("abc", 0, 0)).toEqual(["abc"]);
  });
});

describe("isEmptyExtract", () => {
  it("treats null/undefined/empty as empty", () => {
    expect(isEmptyExtract(null)).toBe(true);
    expect(isEmptyExtract(undefined)).toBe(true);
    expect(isEmptyExtract("")).toBe(true);
    expect(isEmptyExtract("   ")).toBe(true);
  });

  it("treats the NONE marker (any case) as empty", () => {
    expect(isEmptyExtract("NONE")).toBe(true);
    expect(isEmptyExtract(" none ")).toBe(true);
    expect(isEmptyExtract("None")).toBe(true);
  });

  it("treats real content as non-empty", () => {
    expect(isEmptyExtract("- a real fact")).toBe(false);
    expect(isEmptyExtract("nonetheless useful")).toBe(false);
  });
});

describe("mergeWindowExtracts", () => {
  it("drops NONE/empty fragments", () => {
    expect(mergeWindowExtracts(["NONE", "", "  "])).toBe(NONE_MARKER);
  });

  it("de-duplicates repeated lines from overlapping windows", () => {
    const merged = mergeWindowExtracts([
      "- fact one\n- fact two",
      "- fact two\n- fact three",
    ]);
    expect(merged).toBe("- fact one\n- fact two\n- fact three");
  });

  it("preserves first-seen order and ignores case/whitespace for dedupe", () => {
    const merged = mergeWindowExtracts([
      "- Alpha",
      "-   alpha  ",
      "- Beta",
    ]);
    expect(merged).toBe("- Alpha\n- Beta");
  });

  it("returns NONE when nothing usable remains", () => {
    expect(mergeWindowExtracts([])).toBe(NONE_MARKER);
    expect(mergeWindowExtracts(["NONE", "none"])).toBe(NONE_MARKER);
  });
});

describe("fingerprintContent", () => {
  it("is stable for identical content", () => {
    expect(fingerprintContent("hello world")).toBe(fingerprintContent("hello world"));
  });

  it("changes when content changes", () => {
    expect(fingerprintContent("a")).not.toBe(fingerprintContent("b"));
  });

  it("handles empty/nullish content", () => {
    expect(fingerprintContent("")).toBe(fingerprintContent(""));
    expect(typeof fingerprintContent("")).toBe("string");
  });
});

describe("partitionByBudget", () => {
  it("keeps everything in one batch when under budget and count", () => {
    const items = [{ s: 10 }, { s: 10 }, { s: 10 }];
    const batches = partitionByBudget(items, (i) => i.s, 100, 10);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it("splits when the char budget is exceeded", () => {
    const items = [{ s: 40 }, { s: 40 }, { s: 40 }];
    const batches = partitionByBudget(items, (i) => i.s, 100, 10);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2); // 40 + 40 = 80 <= 100
    expect(batches[1]).toHaveLength(1);
  });

  it("splits when the count cap is exceeded", () => {
    const items = [1, 2, 3, 4, 5];
    const batches = partitionByBudget(items, () => 1, 1000, 2);
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it("never drops an item larger than the budget (own batch)", () => {
    const items = [{ s: 500 }, { s: 10 }];
    const batches = partitionByBudget(items, (i) => i.s, 100, 10);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toEqual([{ s: 500 }]);
    // Every item is preserved.
    expect(batches.flat()).toHaveLength(2);
  });

  it("returns no batches for empty input", () => {
    expect(partitionByBudget([], () => 1, 100, 10)).toEqual([]);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order in the results", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it("never runs more than `limit` workers at once", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async (n) => n)).toEqual([]);
  });

  it("treats a non-positive limit as 1", async () => {
    const out = await mapWithConcurrency([1, 2, 3], 0, async (n) => n + 1);
    expect(out).toEqual([2, 3, 4]);
  });
});
