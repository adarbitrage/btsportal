import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
