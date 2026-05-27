import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WordlistMatch } from "../lib/moderation/wordlist";
import type { ClassifierScores } from "../lib/moderation/classifier";

const scanContentMock = vi.fn<(body: string) => Promise<WordlistMatch[]>>();
const classifyContentMock = vi.fn<(body: string) => Promise<ClassifierScores>>();

vi.mock("../lib/moderation/wordlist", () => ({
  scanContent: (body: string) => scanContentMock(body),
}));

vi.mock("../lib/moderation/classifier", () => ({
  classifyContent: (body: string) => classifyContentMock(body),
}));

import { evaluate } from "../lib/moderation/engine";

const ZERO: ClassifierScores = { toxicity: 0, spam: 0, harassment: 0, hate_speech: 0 };

beforeEach(() => {
  scanContentMock.mockReset();
  classifyContentMock.mockReset();
});

describe("moderation engine decision rules", () => {
  it("HARD wordlist hit flags immediately and skips the classifier", async () => {
    scanContentMock.mockResolvedValue([
      { word: "badword", category: "test", severity: "HARD" },
    ]);
    classifyContentMock.mockResolvedValue({ ...ZERO });

    const result = await evaluate({ body: "x", targetType: "post", authorId: 1 });

    expect(result.flagged).toBe(true);
    expect(result.triggeredBy).toBe("wordlist_hard");
    expect(classifyContentMock).not.toHaveBeenCalled();
    expect(result.aiScores).toEqual(ZERO);
  });

  it("SOFT-only wordlist hit (with clean AI scores) flags as wordlist_soft", async () => {
    scanContentMock.mockResolvedValue([
      { word: "meh", category: "test", severity: "SOFT" },
    ]);
    classifyContentMock.mockResolvedValue({ ...ZERO });

    const result = await evaluate({ body: "x", targetType: "post", authorId: 1 });

    expect(result.flagged).toBe(true);
    expect(result.triggeredBy).toBe("wordlist_soft");
    expect(classifyContentMock).toHaveBeenCalledTimes(1);
  });

  it("AI score > 0.5 with no wordlist hit flags as ai_classifier", async () => {
    scanContentMock.mockResolvedValue([]);
    classifyContentMock.mockResolvedValue({ ...ZERO, toxicity: 0.8 });

    const result = await evaluate({ body: "x", targetType: "post", authorId: 1 });

    expect(result.flagged).toBe(true);
    expect(result.triggeredBy).toBe("ai_classifier");
  });

  it("AI score > 0.5 combined with a SOFT wordlist hit flags as combined", async () => {
    scanContentMock.mockResolvedValue([
      { word: "meh", category: "test", severity: "SOFT" },
    ]);
    classifyContentMock.mockResolvedValue({ ...ZERO, harassment: 0.9 });

    const result = await evaluate({ body: "x", targetType: "post", authorId: 1 });

    expect(result.flagged).toBe(true);
    expect(result.triggeredBy).toBe("combined");
  });

  it("classifier failure resolves to zero scores (fail-open) so clean text stays unflagged", async () => {
    scanContentMock.mockResolvedValue([]);
    // Simulate the classifier's fail-open contract: on throw/timeout it returns zero scores.
    classifyContentMock.mockResolvedValue({ ...ZERO });

    const result = await evaluate({ body: "totally clean text", targetType: "post", authorId: 1 });

    expect(result.flagged).toBe(false);
    expect(result.triggeredBy).toBe("none");
    expect(result.aiScores).toEqual(ZERO);
  });
});
