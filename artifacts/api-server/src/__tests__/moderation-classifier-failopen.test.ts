import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  getAnthropicClient: () => ({
    messages: { create: (...args: unknown[]) => createMock(...args) },
  }),
}));

import { classifyContent } from "../lib/moderation/classifier";

const ZERO = { toxicity: 0, spam: 0, harassment: 0, hate_speech: 0 };

beforeEach(() => {
  createMock.mockReset();
});

describe("classifier fail-open contract", () => {
  it("returns zero scores when the Anthropic call throws", async () => {
    createMock.mockRejectedValue(new Error("model exploded"));
    const scores = await classifyContent("anything");
    expect(scores).toEqual(ZERO);
  });

  it("returns zero scores when the Anthropic call times out (>8s)", async () => {
    createMock.mockImplementation(
      () => new Promise(() => { /* never resolves */ }),
    );
    vi.useFakeTimers();
    const promise = classifyContent("anything");
    await vi.advanceTimersByTimeAsync(8001);
    const scores = await promise;
    vi.useRealTimers();
    expect(scores).toEqual(ZERO);
  });

  it("returns zero scores when the model response is not parseable JSON", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "definitely not json" }],
    });
    const scores = await classifyContent("anything");
    expect(scores).toEqual(ZERO);
  });
});
