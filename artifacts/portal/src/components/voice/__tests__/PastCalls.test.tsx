import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Spy on the data hook so we can assert exactly what range/custom args the
// PastCalls UI wires through. The hook is mocked to return a stable, loaded
// state so the list renders synchronously.
const useVoiceCalls = vi.fn();
vi.mock("@/lib/voice-api", () => ({
  useVoiceCalls: (...args: unknown[]) => useVoiceCalls(...args),
}));

import { PastCalls } from "@/components/voice/PastCalls";

interface UseVoiceCallsArgs {
  limit: number;
  offset: number;
  q: string;
  range: string;
  custom: { from?: string; to?: string };
}

function callArgs(call: unknown[]): UseVoiceCallsArgs {
  const [limit, offset, q, range, custom] = call;
  return {
    limit: limit as number,
    offset: offset as number,
    q: q as string,
    range: range as string,
    custom: (custom ?? {}) as { from?: string; to?: string },
  };
}

function lastCall(): UseVoiceCallsArgs {
  const calls = useVoiceCalls.mock.calls;
  return callArgs(calls[calls.length - 1]);
}

beforeEach(() => {
  useVoiceCalls.mockReset().mockReturnValue({
    data: {
      calls: [
        {
          id: 1,
          status: "ended",
          started_at: new Date(2026, 2, 5, 9, 30, 0).toISOString(),
          ended_at: null,
          duration_seconds: 120,
          summary: "A test call summary.",
          transcript: null,
          disconnect_reason: null,
        },
      ],
      limit: 5,
      offset: 0,
      has_more: false,
    },
    isLoading: false,
    isFetching: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function selectCustomRange() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: /filter by date range/i }));
  await user.click(await screen.findByRole("option", { name: /custom range/i }));
}

describe("PastCalls — custom date-range UI", () => {
  it("defaults to the all-time preset with no custom range", () => {
    render(<PastCalls />);
    const args = lastCall();
    expect(args.range).toBe("all");
    expect(args.custom).toEqual({});
  });

  it("passes the entered from/to bounds and suppresses the preset range", async () => {
    render(<PastCalls />);

    await selectCustomRange();

    // The From/To date inputs only appear once "Custom range…" is active.
    const fromInput = await screen.findByLabelText(/start date/i);
    const toInput = await screen.findByLabelText(/end date/i);

    fireEvent.change(fromInput, { target: { value: "2026-03-01" } });
    fireEvent.change(toInput, { target: { value: "2026-03-10" } });

    await waitFor(() => {
      const args = lastCall();
      expect(args.custom).toEqual({ from: "2026-03-01", to: "2026-03-10" });
    });

    // A custom range must suppress the preset by forcing range back to "all".
    expect(lastCall().range).toBe("all");
  });

  it("ignores an invalid order (start after end): shows the error and does not query a range", async () => {
    render(<PastCalls />);

    await selectCustomRange();

    const fromInput = await screen.findByLabelText(/start date/i);
    const toInput = await screen.findByLabelText(/end date/i);

    fireEvent.change(fromInput, { target: { value: "2026-03-20" } });
    fireEvent.change(toInput, { target: { value: "2026-03-10" } });

    // The invalid-order guard surfaces the inline error.
    expect(
      await screen.findByText(/start date must be on or before the end date/i),
    ).toBeInTheDocument();

    // No from/to is queried while the order is invalid.
    await waitFor(() => {
      const args = lastCall();
      expect(args.custom).toEqual({});
      expect(args.range).toBe("all");
    });
  });

  it("clears the entered dates with the Clear dates control", async () => {
    render(<PastCalls />);

    await selectCustomRange();

    const fromInput = await screen.findByLabelText(/start date/i);
    const toInput = await screen.findByLabelText(/end date/i);
    fireEvent.change(fromInput, { target: { value: "2026-03-01" } });
    fireEvent.change(toInput, { target: { value: "2026-03-10" } });

    await waitFor(() => {
      expect(lastCall().custom).toEqual({ from: "2026-03-01", to: "2026-03-10" });
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /clear dates/i }));

    // Both bounds empty means no custom window is queried (the hook treats
    // empty from/to as "no custom range").
    await waitFor(() => {
      expect(lastCall().custom).toEqual({ from: "", to: "" });
    });
    // Still in custom mode, so the preset stays suppressed.
    expect(lastCall().range).toBe("all");
    expect((screen.getByLabelText(/start date/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/end date/i) as HTMLInputElement).value).toBe("");
  });
});

describe("PastCalls — active-filter chips", () => {
  async function selectPreset(name: RegExp) {
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /filter by date range/i }));
    await user.click(await screen.findByRole("option", { name }));
  }

  it("shows no summary row when no filters are active", () => {
    render(<PastCalls />);
    expect(screen.queryByText(/showing calls/i)).not.toBeInTheDocument();
  });

  it("renders a keyword chip and a preset chip when both filters are active", async () => {
    render(<PastCalls />);

    await selectPreset(/last 7 days/i);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/search past calls/i), "billing");

    // The summary row and both chips appear (keyword is debounced, so wait).
    expect(await screen.findByText(/showing calls/i)).toBeInTheDocument();
    expect(await screen.findByText(/matching .*billing/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear keyword filter/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear date range filter/i })).toBeInTheDocument();
  });

  it("clearing the keyword chip removes only the keyword, leaving the preset", async () => {
    render(<PastCalls />);

    await selectPreset(/last 7 days/i);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/search past calls/i), "billing");

    const keywordChipClear = await screen.findByRole("button", {
      name: /clear keyword filter/i,
    });
    await user.click(keywordChipClear);

    // Keyword chip is gone but the preset chip and its clear control remain.
    await waitFor(() => {
      expect(screen.queryByText(/matching .*billing/i)).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /clear date range filter/i })).toBeInTheDocument();
    expect(lastCall().range).toBe("7d");
    expect(lastCall().q).toBe("");
  });

  it("clearing the preset chip removes only the preset, leaving the keyword", async () => {
    render(<PastCalls />);

    await selectPreset(/last 30 days/i);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/search past calls/i), "refund");

    // Confirm the keyword chip is present before we touch the preset.
    await screen.findByRole("button", { name: /clear keyword filter/i });

    await user.click(screen.getByRole("button", { name: /clear date range filter/i }));

    // Preset chip is gone but the keyword chip remains.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /clear date range filter/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /clear keyword filter/i })).toBeInTheDocument();
    expect(lastCall().range).toBe("all");
    expect(lastCall().q).toBe("refund");
  });

  it("renders separate from/to chips for a custom range", async () => {
    render(<PastCalls />);
    await selectCustomRange();

    fireEvent.change(await screen.findByLabelText(/^start date$/i), {
      target: { value: "2026-03-01" },
    });
    fireEvent.change(await screen.findByLabelText(/^end date$/i), {
      target: { value: "2026-03-10" },
    });

    expect(await screen.findByText(/^from /i)).toBeInTheDocument();
    expect(await screen.findByText(/^to /i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear start date filter/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear end date filter/i })).toBeInTheDocument();
  });

  it("clearing the start-date chip removes only the from bound, leaving the to bound", async () => {
    render(<PastCalls />);
    await selectCustomRange();

    fireEvent.change(await screen.findByLabelText(/^start date$/i), {
      target: { value: "2026-03-01" },
    });
    fireEvent.change(await screen.findByLabelText(/^end date$/i), {
      target: { value: "2026-03-10" },
    });

    await screen.findByRole("button", { name: /clear start date filter/i });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /clear start date filter/i }));

    // Start chip gone, end chip stays; only the from bound is dropped.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /clear start date filter/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /clear end date filter/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(lastCall().custom).toEqual({ from: "", to: "2026-03-10" });
    });
    expect((screen.getByLabelText(/^end date$/i) as HTMLInputElement).value).toBe("2026-03-10");
  });

  it("shows a Clear all control with two filters active and resets them all", async () => {
    render(<PastCalls />);

    await selectPreset(/last 7 days/i);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/search past calls/i), "billing");

    // With both a keyword and a preset active, the summary row exposes "Clear all".
    const clearAll = await screen.findByRole("button", { name: /clear all filters/i });
    expect(clearAll).toBeInTheDocument();

    await user.click(clearAll);

    // Every filter is reset in one action: no chips remain, the summary row is gone,
    // and the hook is queried with the default keyword/range.
    await waitFor(() => {
      expect(screen.queryByText(/showing calls/i)).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /clear all filters/i }),
    ).not.toBeInTheDocument();
    expect(lastCall().q).toBe("");
    expect(lastCall().range).toBe("all");
    expect((screen.getByLabelText(/search past calls/i) as HTMLInputElement).value).toBe("");
  });

  it("does not show Clear all when only a single filter is active", async () => {
    render(<PastCalls />);

    await selectPreset(/last 7 days/i);

    expect(await screen.findByText(/showing calls/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /clear all filters/i }),
    ).not.toBeInTheDocument();
  });

  it("clearing the end-date chip removes only the to bound, leaving the from bound", async () => {
    render(<PastCalls />);
    await selectCustomRange();

    fireEvent.change(await screen.findByLabelText(/^start date$/i), {
      target: { value: "2026-03-01" },
    });
    fireEvent.change(await screen.findByLabelText(/^end date$/i), {
      target: { value: "2026-03-10" },
    });

    await screen.findByRole("button", { name: /clear end date filter/i });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /clear end date filter/i }));

    // End chip gone, start chip stays; only the to bound is dropped.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /clear end date filter/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /clear start date filter/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(lastCall().custom).toEqual({ from: "2026-03-01", to: "" });
    });
    expect((screen.getByLabelText(/^start date$/i) as HTMLInputElement).value).toBe("2026-03-01");
  });
});

describe("PastCalls — search highlighting", () => {
  // Override the default loaded state with a specific set of calls so we can
  // exercise the highlight + transcript-snippet paths deterministically.
  function mockCalls(calls: Record<string, unknown>[]) {
    useVoiceCalls.mockReturnValue({
      data: { calls, limit: 5, offset: 0, has_more: false },
      isLoading: false,
      isFetching: false,
    });
  }

  function makeCall(overrides: Record<string, unknown>) {
    return {
      id: 1,
      status: "ended",
      started_at: new Date(2026, 2, 5, 9, 30, 0).toISOString(),
      ended_at: null,
      duration_seconds: 120,
      summary: null,
      transcript: null,
      disconnect_reason: null,
      ...overrides,
    };
  }

  it("wraps the matched keyword in <mark> in a result row summary", async () => {
    mockCalls([makeCall({ summary: "Discussed the billing schedule." })]);
    render(<PastCalls />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/search past calls/i), "billing");

    // The keyword is debounced, so wait for the highlight to appear. The
    // active-filter chip also contains the word "billing" as plain text, so we
    // scope strictly to <mark> elements to assert the row summary is highlighted.
    const marks = await screen.findAllByText("billing", { selector: "mark" });
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0].tagName).toBe("MARK");
  });

  it("falls back to a highlighted transcript snippet when only the transcript matches", async () => {
    mockCalls([
      makeCall({
        summary: "General check-in call.",
        transcript:
          "Agent: How can I help?\nYou: I have a question about my invoice payment.",
      }),
    ]);
    render(<PastCalls />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/search past calls/i), "invoice");

    // The keyword only appears in the transcript, so the row shows a snippet of
    // that transcript with the term highlighted.
    const mark = await screen.findByText("invoice", { selector: "mark" });
    expect(mark.tagName).toBe("MARK");

    // The snippet carries surrounding transcript context...
    expect(screen.getByText(/payment/i)).toBeInTheDocument();
    // ...and the non-matching summary is suppressed in favour of the snippet.
    expect(screen.queryByText(/general check-in/i)).not.toBeInTheDocument();
  });

  it("highlights the keyword in both the summary and transcript turns of the detail dialog", async () => {
    mockCalls([
      makeCall({
        summary: "Talked about the refund.",
        transcript: "Agent: Your refund is being processed.\nYou: Thank you.",
      }),
    ]);
    render(<PastCalls />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/search past calls/i), "refund");

    // Wait for the debounced query to take effect (row is highlighted), then
    // open the call-detail dialog from that row.
    await screen.findAllByText("refund", { selector: "mark" });
    await user.click(screen.getByText(/talked about the/i).closest("button")!);

    const dialog = await screen.findByRole("dialog");

    // Summary section: the matched term is wrapped in a <mark>.
    const summaryPara = within(dialog).getByText(/talked about the/i).closest("p")!;
    expect(summaryPara.querySelector("mark")?.textContent).toBe("refund");

    // Transcript turn: the matched term is wrapped in a <mark> too.
    const turn = within(dialog).getByText(/is being processed/i);
    expect(turn.querySelector("mark")?.textContent).toBe("refund");
  });
});
