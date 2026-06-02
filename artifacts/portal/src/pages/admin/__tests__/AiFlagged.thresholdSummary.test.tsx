import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AiFlaggedSummary } from "@/hooks/useAdminModeration";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const useAdminAiFlagged = vi.fn();
const useAdminAiFlaggedSummary = vi.fn();

vi.mock("@/hooks/useAdminModeration", () => ({
  useAdminAiFlagged: (...args: unknown[]) => useAdminAiFlagged(...args),
  useAdminAiFlaggedSummary: (...args: unknown[]) =>
    useAdminAiFlaggedSummary(...args),
}));

import AiFlagged from "@/pages/admin/moderation/ai-flagged";

function baseSummary(overrides: Partial<AiFlaggedSummary> = {}): AiFlaggedSummary {
  const base: AiFlaggedSummary = {
    sampleWindowDays: 30,
    from: null,
    to: null,
    sampleSize: 5,
    currentThreshold: 0.7,
    // Ascending max scores: 4 of 5 are above the current 0.70 threshold.
    maxScores: [0.55, 0.72, 0.81, 0.9, 0.95],
    buckets: [
      {
        min: 0.5,
        max: 0.7,
        label: "0.50–0.70",
        total: 1,
        approved: 1,
        rejected: 0,
        pending: 0,
        approveRate: 1,
      },
      {
        min: 0.7,
        max: 0.85,
        label: "0.70–0.85",
        total: 2,
        approved: 1,
        rejected: 1,
        pending: 0,
        approveRate: 0.5,
      },
      {
        min: 0.85,
        max: 1,
        label: "0.85–1.00",
        total: 2,
        approved: 0,
        rejected: 2,
        pending: 0,
        approveRate: 0,
      },
    ],
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  useAdminAiFlagged.mockReset();
  useAdminAiFlaggedSummary.mockReset();

  // The flagged-rows list is irrelevant to the summary card under test; keep it
  // in a settled empty state so the page renders without extra fetching.
  useAdminAiFlagged.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
});

describe("AiFlagged — Threshold tuning summary card", () => {
  it("renders each score band with its approve-rate value", () => {
    useAdminAiFlaggedSummary.mockReturnValue({
      data: baseSummary(),
      isLoading: false,
      isError: false,
    });

    render(<AiFlagged />);

    const card = screen.getByTestId("ai-flagged-summary");
    expect(card).toBeInTheDocument();

    // Each configured band renders a row with the expected approve-rate cell.
    const band1 = within(card).getByTestId("summary-band-0.50–0.70");
    expect(
      within(band1).getByTestId("summary-band-approve-rate-0.50–0.70"),
    ).toHaveTextContent("100%");

    const band2 = within(card).getByTestId("summary-band-0.70–0.85");
    expect(
      within(band2).getByTestId("summary-band-approve-rate-0.70–0.85"),
    ).toHaveTextContent("50%");

    const band3 = within(card).getByTestId("summary-band-0.85–1.00");
    expect(
      within(band3).getByTestId("summary-band-approve-rate-0.85–1.00"),
    ).toHaveTextContent("0%");
  });

  it("seeds the what-if slider at the current threshold and updates the count as it moves", () => {
    useAdminAiFlaggedSummary.mockReturnValue({
      data: baseSummary(),
      isLoading: false,
      isError: false,
    });

    render(<AiFlagged />);

    // Slider starts at the saved threshold (0.70); 4 of 5 items trigger there.
    expect(screen.getByTestId("ai-flagged-whatif-value")).toHaveTextContent(
      "0.70",
    );
    const result = screen.getByTestId("ai-flagged-whatif-result");
    expect(result).toHaveTextContent("4 of the last 5");

    const thumb = within(
      screen.getByTestId("ai-flagged-whatif-slider"),
    ).getByRole("slider");

    // End → threshold 1.00: nothing scores above it.
    fireEvent.keyDown(thumb, { key: "End" });
    expect(screen.getByTestId("ai-flagged-whatif-value")).toHaveTextContent(
      "1.00",
    );
    expect(screen.getByTestId("ai-flagged-whatif-result")).toHaveTextContent(
      "0 of the last 5",
    );

    // Home → threshold 0.00: every item still triggers.
    fireEvent.keyDown(thumb, { key: "Home" });
    expect(screen.getByTestId("ai-flagged-whatif-value")).toHaveTextContent(
      "0.00",
    );
    expect(screen.getByTestId("ai-flagged-whatif-result")).toHaveTextContent(
      "5 of the last 5",
    );
  });

  it("shows the empty state and no slider when there is no sample", () => {
    useAdminAiFlaggedSummary.mockReturnValue({
      data: baseSummary({ sampleSize: 0, buckets: [], maxScores: [] }),
      isLoading: false,
      isError: false,
    });

    render(<AiFlagged />);

    expect(screen.getByTestId("ai-flagged-summary")).toBeInTheDocument();
    expect(
      screen.getByText(/No AI-flagged activity in the last 30 days to summarize/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-flagged-whatif-slider"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-flagged-whatif-result"),
    ).not.toBeInTheDocument();
  });
});

describe("AiFlagged — date-aware threshold summary", () => {
  it("reads 'Last 30 days' in the header when no range is applied", () => {
    useAdminAiFlaggedSummary.mockReturnValue({
      data: baseSummary({ from: null, to: null }),
      isLoading: false,
      isError: false,
    });

    render(<AiFlagged />);

    const range = screen.getByTestId("ai-flagged-summary-range");
    expect(range).toHaveTextContent("Last 30 days");
    expect(range).toHaveTextContent("5 AI-flagged items");
  });

  it("switches the header to the applied From/To range and recomputes the what-if counts", () => {
    // Smart mock: echo the applied from/to into the summary (like the backend
    // does) and return a narrower sample for any explicit range. This proves
    // the card tracks the filters the admin applies rather than a fixed window.
    useAdminAiFlaggedSummary.mockImplementation(
      (filters?: { from?: string; to?: string }) => {
        const hasRange = Boolean(filters?.from || filters?.to);
        return {
          data: hasRange
            ? baseSummary({
                from: filters?.from ?? null,
                to: filters?.to ?? null,
                sampleSize: 2,
                // 1 of 2 above the current 0.70 threshold.
                maxScores: [0.6, 0.95],
                buckets: [
                  {
                    min: 0.5,
                    max: 0.7,
                    label: "0.50–0.70",
                    total: 1,
                    approved: 1,
                    rejected: 0,
                    pending: 0,
                    approveRate: 1,
                  },
                  {
                    min: 0.85,
                    max: 1,
                    label: "0.85–1.00",
                    total: 1,
                    approved: 0,
                    rejected: 1,
                    pending: 0,
                    approveRate: 0,
                  },
                ],
              })
            : baseSummary({ from: null, to: null }),
          isLoading: false,
          isError: false,
        };
      },
    );

    render(<AiFlagged />);

    // Default window: "Last 30 days" header, 4 of 5 trigger at the 0.70 seed.
    const rangeBefore = screen.getByTestId("ai-flagged-summary-range");
    expect(rangeBefore).toHaveTextContent("Last 30 days");
    expect(screen.getByTestId("ai-flagged-whatif-result")).toHaveTextContent(
      "4 of the last 5",
    );

    // Apply an explicit From/To window via the filter form.
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-03-01" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-03-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Header now reflects the selected range (formatted dates, not the default
    // "Last 30 days"); assert on year + range separator to stay TZ-agnostic.
    const rangeAfter = screen.getByTestId("ai-flagged-summary-range");
    expect(rangeAfter).not.toHaveTextContent("Last 30 days");
    expect(rangeAfter).toHaveTextContent(/2026.*–.*2026/);
    expect(rangeAfter).toHaveTextContent("2 AI-flagged items");

    // What-if "would still trigger" count recomputes for the narrower sample.
    expect(screen.getByTestId("ai-flagged-whatif-result")).toHaveTextContent(
      "1 of the last 2",
    );
  });
});
