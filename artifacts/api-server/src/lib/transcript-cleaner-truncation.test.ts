// Truncation-recovery contract for the Transcript Cleaner (Task #1742): a
// chunk whose clean pass is truncated (hard stop_reason="max_tokens" signal or
// a drastically-short cleaned body) is re-cleaned in smaller sub-chunks and
// merged — partial text is NEVER silently stitched into the final transcript.
// Pure tests: the model request function is injected, no network, no DB.
import { describe, expect, it, vi } from "vitest";

import {
  CLEAN_RECOVERY_MAX_DEPTH,
  CLEAN_RECOVERY_MIN_CHARS,
  CLEAN_SHORT_CHECK_MIN_INPUT_CHARS,
  CLEAN_SHORT_OUTPUT_RATIO,
  CleanerTruncationError,
  cleanChunkWithRecovery,
  isSuspiciouslyShortClean,
  mergeRecoveredChunkResults,
  splitTranscriptForCleaning,
} from "./transcript-cleaner";

const buildMessage = (chunkText: string) => `PROMPT\n${chunkText}`;

/** A "model" that cleans by echoing the transcript text back out of the prompt. */
const okReply = (userMessage: string, extra: Partial<Record<string, unknown>> = {}) => ({
  cleanedTranscript: userMessage.replace(/^PROMPT\n/, ""),
  flags: [],
  ...extra,
});

const bigText = (chars: number) =>
  Array.from({ length: Math.ceil(chars / 50) }, (_, i) => `Sentence number ${i} about disciplined scaling. `)
    .join("")
    .slice(0, chars);

describe("isSuspiciouslyShortClean (soft truncation signal)", () => {
  it("stays quiet on small inputs (legitimate cruft removal)", () => {
    expect(isSuspiciouslyShortClean(CLEAN_SHORT_CHECK_MIN_INPUT_CHARS - 1, 100)).toBe(false);
  });

  it("stays quiet on empty output (the raw-chunk fallback owns that case)", () => {
    expect(isSuspiciouslyShortClean(20000, 0)).toBe(false);
  });

  it("fires on a big input whose output came back drastically short", () => {
    const input = 10000;
    expect(isSuspiciouslyShortClean(input, Math.floor(input * CLEAN_SHORT_OUTPUT_RATIO) - 1)).toBe(true);
    expect(isSuspiciouslyShortClean(input, Math.ceil(input * CLEAN_SHORT_OUTPUT_RATIO) + 1)).toBe(false);
  });
});

describe("cleanChunkWithRecovery", () => {
  it("passes a healthy clean straight through (one request, no split)", async () => {
    const text = bigText(8000);
    const request = vi.fn(async ({ userMessage }: { userMessage: string }) => okReply(userMessage));
    const out = await cleanChunkWithRecovery({ chunkText: text, buildMessage, request });
    expect(request).toHaveBeenCalledTimes(1);
    expect(out.cleanedTranscript).toBe(text);
  });

  it("recovers a hard truncation by re-cleaning in sub-chunks and merging in order", async () => {
    const text = bigText(12000);
    let calls = 0;
    const request = vi.fn(async ({ userMessage }: { userMessage: string }) => {
      calls++;
      // First (whole-chunk) call truncates; the sub-chunk calls succeed.
      if (calls === 1) throw new CleanerTruncationError("truncated");
      return okReply(userMessage, { flags: [{ type: "garbled_content", text: `f${calls}`, reason: "r" }] });
    });
    const out = await cleanChunkWithRecovery({ chunkText: text, buildMessage, request });
    expect(request.mock.calls.length).toBeGreaterThanOrEqual(3); // 1 failed + ≥2 sub-chunks
    // No content lost: every sub-chunk's text is present, in order (whitespace
    // at the join points is normalised by the merge's per-part trim).
    expect(out.cleanedTranscript.replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
    // Flags from ALL sub-chunks are unioned.
    expect(out.flags.length).toBeGreaterThanOrEqual(2);
  });

  it("treats a drastically-short cleaned body as truncation and recovers", async () => {
    const text = bigText(12000);
    let calls = 0;
    const request = vi.fn(async ({ userMessage }: { userMessage: string }) => {
      calls++;
      if (calls === 1) return okReply(userMessage.slice(0, 800)); // "successful" but drastically short
      return okReply(userMessage);
    });
    const out = await cleanChunkWithRecovery({ chunkText: text, buildMessage, request });
    expect(request.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(out.cleanedTranscript.replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
  });

  it("propagates the truncation loudly when the chunk is already at the minimum size", async () => {
    const text = bigText(CLEAN_RECOVERY_MIN_CHARS - 100);
    const request = vi.fn(async () => {
      throw new CleanerTruncationError("truncated");
    });
    await expect(cleanChunkWithRecovery({ chunkText: text, buildMessage, request })).rejects.toThrow(
      CleanerTruncationError,
    );
    expect(request).toHaveBeenCalledTimes(1); // no pointless sub-splitting
  });

  it("propagates the truncation loudly at the recursion depth cap (never a silent partial stitch)", async () => {
    const text = bigText(60000);
    const request = vi.fn(async () => {
      throw new CleanerTruncationError("truncated");
    });
    await expect(cleanChunkWithRecovery({ chunkText: text, buildMessage, request })).rejects.toThrow(
      /truncated/i,
    );
    // Bounded work: at most 2^(depth+1) requests for the binary split tree.
    expect(request.mock.calls.length).toBeLessThanOrEqual(2 ** (CLEAN_RECOVERY_MAX_DEPTH + 1));
  });

  it("rethrows non-truncation errors unchanged (no recovery masking)", async () => {
    const request = vi.fn(async () => {
      throw new Error("model down");
    });
    await expect(
      cleanChunkWithRecovery({ chunkText: bigText(12000), buildMessage, request }),
    ).rejects.toThrow("model down");
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("mergeRecoveredChunkResults", () => {
  it("keeps the first part's metadata, joins bodies, and unions flags", () => {
    const merged = mergeRecoveredChunkResults([
      { cleanedTranscript: "part one.", flags: [{ type: "garbled_content" }], authority: { name: "Sasha" } },
      { cleanedTranscript: "  part two.  ", flags: [{ type: "uncertain_authority" }], authority: {} },
      { cleanedTranscript: "", flags: [] },
    ]);
    expect(merged.cleanedTranscript).toBe("part one.\n\npart two.");
    expect(merged.flags).toHaveLength(2);
    expect(merged.authority).toEqual({ name: "Sasha" });
  });
});

describe("splitTranscriptForCleaning half-split (recovery path)", () => {
  it("splits a chunk into ≥2 sub-chunks that concatenate back verbatim", () => {
    const text = bigText(10000);
    const target = Math.ceil(text.length / 2);
    const subs = splitTranscriptForCleaning(text, { threshold: target, target });
    expect(subs.length).toBeGreaterThanOrEqual(2);
    expect(subs.join("")).toBe(text);
  });
});
