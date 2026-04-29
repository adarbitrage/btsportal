import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const getSettings = vi.fn();
const getOnCallDestinations = vi.fn();
const getOnCallDestinationsHistory = vi.fn();
const getAuthRateLimitAlertConfig = vi.fn();
const getAuthRateLimitAlertTrafficPreview = vi.fn();
const updateAuthRateLimitAlertConfig = vi.fn();
const getChangeHistoryRetentionConfig = vi.fn();

vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getSettings: (...args: unknown[]) => getSettings(...args),
    getOnCallDestinations: (...args: unknown[]) => getOnCallDestinations(...args),
    getOnCallDestinationsHistory: (...args: unknown[]) =>
      getOnCallDestinationsHistory(...args),
    getAuthRateLimitAlertConfig: (...args: unknown[]) =>
      getAuthRateLimitAlertConfig(...args),
    getAuthRateLimitAlertTrafficPreview: (...args: unknown[]) =>
      getAuthRateLimitAlertTrafficPreview(...args),
    updateAuthRateLimitAlertConfig: (...args: unknown[]) =>
      updateAuthRateLimitAlertConfig(...args),
    getChangeHistoryRetentionConfig: (...args: unknown[]) =>
      getChangeHistoryRetentionConfig(...args),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import AdminSettings from "@/pages/admin/AdminSettings";

const SAVED_CONFIG = {
  config: { threshold: 10, windowMinutes: 5, dominantIpRatio: 0.6 },
  sources: { threshold: "default", windowMinutes: "default", dominantIpRatio: "default" },
  defaults: { threshold: 10, windowMinutes: 5, dominantIpRatio: 0.6 },
  bounds: {
    threshold: { min: 1, max: 10000 },
    windowMinutes: { min: 1, max: 60 },
    dominantIpRatio: { min: 0, max: 1 },
  },
};

beforeEach(() => {
  getSettings.mockReset();
  getOnCallDestinations.mockReset();
  getOnCallDestinationsHistory.mockReset();
  getAuthRateLimitAlertConfig.mockReset();
  getAuthRateLimitAlertTrafficPreview.mockReset();
  updateAuthRateLimitAlertConfig.mockReset();
  getChangeHistoryRetentionConfig.mockReset();

  getSettings.mockResolvedValue([]);
  getOnCallDestinations.mockResolvedValue({
    pagerdutyConfigured: false,
    pagerdutySource: null,
    opsAlertEmail: null,
    opsAlertEmailSource: null,
    slackConfigured: false,
    slackSource: null,
  });
  getOnCallDestinationsHistory.mockResolvedValue({ events: [] });
  getAuthRateLimitAlertConfig.mockResolvedValue(SAVED_CONFIG);
  getChangeHistoryRetentionConfig.mockResolvedValue({
    config: { emailRetentionDays: 90, phoneRetentionDays: 90 },
    sources: { emailRetentionDays: "default", phoneRetentionDays: "default" },
    defaults: { emailRetentionDays: 90, phoneRetentionDays: 90 },
    bounds: {
      emailRetentionDays: { min: 1, max: 365 },
      phoneRetentionDays: { min: 1, max: 365 },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AlertTrafficPreviewPanel", () => {
  it("renders the saved-config 'would have fired' summary based on real timestamps", async () => {
    // 12 hits in the last minute; with saved config (threshold=10, window=5min)
    // that's exactly one fire transition, peak=12.
    const base = Date.now();
    const events = Array.from({ length: 12 }, (_, i) => base - (12 - i) * 1000);
    getAuthRateLimitAlertTrafficPreview.mockResolvedValue({
      lookbackDays: 7,
      lookbackStart: new Date(base - 7 * 86400000).toISOString(),
      generatedAt: new Date(base).toISOString(),
      totalHits: 12,
      dailyBuckets: Array.from({ length: 8 }, (_, i) => ({
        dayStart: new Date(base - (7 - i) * 86400000).toISOString(),
        hits: i === 7 ? 12 : 0,
      })),
      eventTimestampsMs: events,
      truncated: false,
    });

    render(<AdminSettings />);

    const summary = await screen.findByTestId("alert-traffic-saved-summary");
    expect(summary.textContent).toMatch(/would have fired/i);
    expect(summary.textContent).toMatch(/1 time/);
    expect(summary.textContent).toMatch(/≥10 in 5 min/);
  });

  it("warns when the saved threshold is far above observed peak", async () => {
    // Saved threshold is 10; observed peak burst is 2 hits — 10 > 2 * 2 so
    // the "effectively disabled" banner appears.
    const base = Date.now();
    const events = [base - 1000, base - 500];
    getAuthRateLimitAlertTrafficPreview.mockResolvedValue({
      lookbackDays: 7,
      lookbackStart: new Date(base - 7 * 86400000).toISOString(),
      generatedAt: new Date(base).toISOString(),
      totalHits: 2,
      dailyBuckets: Array.from({ length: 8 }, (_, i) => ({
        dayStart: new Date(base - (7 - i) * 86400000).toISOString(),
        hits: i === 7 ? 2 : 0,
      })),
      eventTimestampsMs: events,
      truncated: false,
    });

    render(<AdminSettings />);
    expect(await screen.findByTestId("alert-traffic-warning-disabled")).toBeInTheDocument();
  });

  it("warns when the configured threshold would fire more than once per day on average", async () => {
    // Saved threshold 10, window 5 min. Build 3 separate bursts of 12 events each
    // far apart, over 2 lookback days => 3 fires / 2 days > 1/day => noisy warning.
    const base = Date.now();
    const events: number[] = [];
    for (let burst = 0; burst < 3; burst++) {
      const burstStart = base - burst * 60 * 60 * 1000; // 1 hour apart so windows don't overlap
      for (let i = 0; i < 12; i++) events.push(burstStart - i * 1000);
    }
    getAuthRateLimitAlertTrafficPreview.mockResolvedValue({
      lookbackDays: 2,
      lookbackStart: new Date(base - 2 * 86400000).toISOString(),
      generatedAt: new Date(base).toISOString(),
      totalHits: events.length,
      dailyBuckets: [
        { dayStart: new Date(base - 2 * 86400000).toISOString(), hits: 0 },
        { dayStart: new Date(base - 86400000).toISOString(), hits: 0 },
        { dayStart: new Date(base).toISOString(), hits: events.length },
      ],
      eventTimestampsMs: events,
      truncated: false,
    });

    render(<AdminSettings />);
    expect(await screen.findByTestId("alert-traffic-warning-noisy")).toBeInTheDocument();
  });

  it("recomputes the draft summary live as the threshold field changes", async () => {
    // 8 hits in the last minute. Saved threshold=10 => 0 fires. Drop the
    // draft to 5 => 1 fire. The draft line should appear and update live.
    const base = Date.now();
    const events = Array.from({ length: 8 }, (_, i) => base - (8 - i) * 1000);
    getAuthRateLimitAlertTrafficPreview.mockResolvedValue({
      lookbackDays: 7,
      lookbackStart: new Date(base - 7 * 86400000).toISOString(),
      generatedAt: new Date(base).toISOString(),
      totalHits: 8,
      dailyBuckets: Array.from({ length: 8 }, (_, i) => ({
        dayStart: new Date(base - (7 - i) * 86400000).toISOString(),
        hits: i === 7 ? 8 : 0,
      })),
      eventTimestampsMs: events,
      truncated: false,
    });

    render(<AdminSettings />);

    const saved = await screen.findByTestId("alert-traffic-saved-summary");
    expect(saved.textContent).toMatch(/0 times/);
    expect(screen.queryByTestId("alert-traffic-draft-summary")).not.toBeInTheDocument();

    const thresholdInput = screen.getByTestId("alert-threshold-input") as HTMLInputElement;
    await userEvent.clear(thresholdInput);
    await userEvent.type(thresholdInput, "5");

    const draft = await screen.findByTestId("alert-traffic-draft-summary");
    expect(draft.textContent).toMatch(/1 time/);
    expect(draft.textContent).toMatch(/≥5 in 5 min/);
    // Saved line is unchanged.
    expect(saved.textContent).toMatch(/0 times/);
  });

  it("falls back to a 'too much data' note when the preview is truncated", async () => {
    getAuthRateLimitAlertTrafficPreview.mockResolvedValue({
      lookbackDays: 7,
      lookbackStart: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      totalHits: 999999,
      dailyBuckets: Array.from({ length: 8 }, (_, i) => ({
        dayStart: new Date(Date.now() - (7 - i) * 86400000).toISOString(),
        hits: 100,
      })),
      eventTimestampsMs: null,
      truncated: true,
    });

    render(<AdminSettings />);

    expect(await screen.findByTestId("alert-traffic-truncated")).toBeInTheDocument();
    expect(screen.queryByTestId("alert-traffic-saved-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("alert-traffic-warning-disabled")).not.toBeInTheDocument();
  });

  it("shows a retry control when the preview load fails", async () => {
    getAuthRateLimitAlertTrafficPreview.mockRejectedValueOnce(new Error("network down"));

    render(<AdminSettings />);

    const retry = await screen.findByTestId("alert-traffic-retry");
    expect(retry).toBeInTheDocument();

    // Second attempt succeeds — clicking retry should hide the error and
    // render the normal preview.
    getAuthRateLimitAlertTrafficPreview.mockResolvedValueOnce({
      lookbackDays: 7,
      lookbackStart: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      totalHits: 0,
      dailyBuckets: [],
      eventTimestampsMs: [],
      truncated: false,
    });
    await userEvent.click(retry);
    await waitFor(() => {
      expect(screen.queryByTestId("alert-traffic-retry")).not.toBeInTheDocument();
    });
    expect(await screen.findByTestId("alert-traffic-saved-summary")).toBeInTheDocument();
  });
});
