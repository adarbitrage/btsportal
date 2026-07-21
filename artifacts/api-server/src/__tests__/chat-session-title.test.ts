import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const updateWhere = vi.fn().mockResolvedValue(undefined);
const updateSet = vi.fn((_values: unknown) => ({ where: updateWhere }));
const dbUpdate = vi.fn((_table: unknown) => ({ set: updateSet }));

vi.mock("@workspace/db", () => ({
  db: { update: (arg: unknown) => dbUpdate(arg) },
  chatSessionsTable: { id: "id", title: "title" },
}));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  getAnthropicClient: () => {
    throw new Error("Real Anthropic client must never be constructed in tests");
  },
}));

import { sanitizeGeneratedTitle, generateAndApplySessionTitle } from "../lib/chat-session-title";

describe("sanitizeGeneratedTitle", () => {
  it("accepts a clean 3-7 word title", () => {
    expect(sanitizeGeneratedTitle("Tax Deduction Question")).toBe("Tax Deduction Question");
  });

  it("strips surrounding quotes and trailing punctuation", () => {
    expect(sanitizeGeneratedTitle('"Affiliate Link Tracking Setup."')).toBe("Affiliate Link Tracking Setup");
    expect(sanitizeGeneratedTitle("'Getting Started With Blitz!'")).toBe("Getting Started With Blitz");
  });

  it("strips filler lead-ins like 'Help with' / 'Question about'", () => {
    expect(sanitizeGeneratedTitle("Help with Tax Deduction Rules")).toBe("Tax Deduction Rules");
    expect(sanitizeGeneratedTitle("Question about Commission Payouts Timing")).toBe("Commission Payouts Timing");
  });

  it("strips a Title: prefix", () => {
    expect(sanitizeGeneratedTitle("Title: Commission Payout Timing")).toBe("Commission Payout Timing");
  });

  it("uses only the first non-empty line", () => {
    expect(sanitizeGeneratedTitle("\nAd Budget Planning Basics\nHere is why I chose it...")).toBe(
      "Ad Budget Planning Basics",
    );
  });

  it("rejects empty and whitespace-only output", () => {
    expect(sanitizeGeneratedTitle("")).toBeNull();
    expect(sanitizeGeneratedTitle("   \n  ")).toBeNull();
    expect(sanitizeGeneratedTitle('"..."')).toBeNull();
  });

  it("rejects one-word and rambling outputs", () => {
    expect(sanitizeGeneratedTitle("Taxes")).toBeNull();
    expect(
      sanitizeGeneratedTitle(
        "This conversation is about how the member can set up their very first affiliate campaign",
      ),
    ).toBeNull();
  });

  it("caps overly long titles at 80 chars", () => {
    const out = sanitizeGeneratedTitle(
      "Aaaaaaaaaaaaaaa Bbbbbbbbbbbbbbb Ccccccccccccccc Ddddddddddddddd Eeeeeeeeeeeeeee Fffffffffffffff",
    );
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(80);
  });
});

describe("generateAndApplySessionTitle", () => {
  beforeEach(() => {
    dbUpdate.mockClear();
    updateSet.mockClear();
    updateWhere.mockClear();
  });

  it("persists a sanitized title on success", async () => {
    const modelCall = vi.fn().mockResolvedValue('"Pixel Setup Question."');
    await generateAndApplySessionTitle(42, "how do I set up my pixel", "You can set it up by...", modelCall);
    expect(modelCall).toHaveBeenCalledOnce();
    expect(dbUpdate).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith({ title: "Pixel Setup Question" });
  });

  it("never throws and skips the update when the model call fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const modelCall = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(generateAndApplySessionTitle(7, "q", "a", modelCall)).resolves.toBeUndefined();
    expect(dbUpdate).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("keeps the truncated title (no update) on garbage output, with a loud log", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const modelCall = vi.fn().mockResolvedValue("Ok");
    await generateAndApplySessionTitle(7, "q", "a", modelCall);
    expect(dbUpdate).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("never throws even if the DB update fails", async () => {
    updateWhere.mockRejectedValueOnce(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const modelCall = vi.fn().mockResolvedValue("Solid Three Word Title");
    await expect(generateAndApplySessionTitle(7, "q", "a", modelCall)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("chat route wiring (source guard)", () => {
  const source = readFileSync(path.join(__dirname, "../routes/chat.ts"), "utf-8");

  it("triggers title generation only for sessions created in this request", () => {
    expect(source).toMatch(/if \(isNewSession\) \{\s*\n\s*void generateAndApplySessionTitle\(/);
  });

  it("fires the title call after the done event / res.end (never blocks the stream)", () => {
    const doneIdx = source.indexOf("done: true, suggestTicket");
    const titleIdx = source.indexOf("void generateAndApplySessionTitle(");
    expect(doneIdx).toBeGreaterThan(-1);
    expect(titleIdx).toBeGreaterThan(doneIdx);
    // fire-and-forget: void'd, not awaited
    expect(source).not.toMatch(/await generateAndApplySessionTitle/);
  });
});
