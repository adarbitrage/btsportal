import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
const getChangeHistoryRetentionConfig = vi.fn();
const getAiModerationThresholdConfig = vi.fn();
const getAiModerationThresholdPreview = vi.fn();
const updateAiModerationThresholdConfig = vi.fn();

vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getSettings: (...args: unknown[]) => getSettings(...args),
    getOnCallDestinations: (...args: unknown[]) => getOnCallDestinations(...args),
    getOnCallDestinationsHistory: (...args: unknown[]) =>
      getOnCallDestinationsHistory(...args),
    getAuthRateLimitAlertConfig: (...args: unknown[]) =>
      getAuthRateLimitAlertConfig(...args),
    getChangeHistoryRetentionConfig: (...args: unknown[]) =>
      getChangeHistoryRetentionConfig(...args),
    getAiModerationThresholdConfig: (...args: unknown[]) =>
      getAiModerationThresholdConfig(...args),
    getAiModerationThresholdPreview: (...args: unknown[]) =>
      getAiModerationThresholdPreview(...args),
    updateAiModerationThresholdConfig: (...args: unknown[]) =>
      updateAiModerationThresholdConfig(...args),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import AdminSettings from "@/pages/admin/AdminSettings";

const SAVED_CONFIG = {
  config: { flagThreshold: 0.7 },
  sources: { flagThreshold: "default" as const },
  defaults: { flagThreshold: 0.7 },
  bounds: { flagThreshold: { min: 0, max: 1 } },
};

beforeEach(() => {
  getSettings.mockReset();
  getOnCallDestinations.mockReset();
  getOnCallDestinationsHistory.mockReset();
  getAuthRateLimitAlertConfig.mockReset();
  getChangeHistoryRetentionConfig.mockReset();
  getAiModerationThresholdConfig.mockReset();
  getAiModerationThresholdPreview.mockReset();
  updateAiModerationThresholdConfig.mockReset();

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
  getAuthRateLimitAlertConfig.mockResolvedValue({
    config: { threshold: 10, windowMinutes: 5, dominantIpRatio: 0.6 },
    sources: { threshold: "default", windowMinutes: "default", dominantIpRatio: "default" },
    defaults: { threshold: 10, windowMinutes: 5, dominantIpRatio: 0.6 },
    bounds: {
      threshold: { min: 1, max: 10000 },
      windowMinutes: { min: 1, max: 60 },
      dominantIpRatio: { min: 0, max: 1 },
    },
  });
  getChangeHistoryRetentionConfig.mockResolvedValue({
    config: { emailRetentionDays: 90, phoneRetentionDays: 90 },
    sources: { emailRetentionDays: "default", phoneRetentionDays: "default" },
    defaults: { emailRetentionDays: 90, phoneRetentionDays: 90 },
    bounds: {
      emailRetentionDays: { min: 1, max: 365 },
      phoneRetentionDays: { min: 1, max: 365 },
    },
  });
  getAiModerationThresholdConfig.mockResolvedValue(SAVED_CONFIG);
  getAiModerationThresholdPreview.mockResolvedValue({
    threshold: 0.05,
    currentThreshold: 0.7,
    sampleWindowDays: 14,
    sampleSize: 40,
    wouldBeFlaggedByAi: 31,
    currentlyFlaggedByAi: 4,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AiModerationThresholdConfigCard", () => {
  it("warns on an extreme value and gates the save behind a confirmation dialog", async () => {
    render(<AdminSettings />);

    const input = (await screen.findByTestId(
      "ai-moderation-flag-threshold-input",
    )) as HTMLInputElement;

    await userEvent.clear(input);
    await userEvent.type(input, "0.05");

    // The amber extreme-value warning appears for an out-of-the-ordinary threshold.
    expect(
      await screen.findByTestId("ai-moderation-flag-threshold-extreme-warning"),
    ).toBeInTheDocument();

    // Clicking save opens the confirmation dialog instead of persisting immediately.
    await userEvent.click(screen.getByTestId("ai-moderation-flag-threshold-save"));
    expect(
      await screen.findByTestId("ai-moderation-flag-threshold-confirm-dialog"),
    ).toBeInTheDocument();
    expect(updateAiModerationThresholdConfig).not.toHaveBeenCalled();

    // Cancelling closes the dialog and never triggers the PUT call.
    await userEvent.click(
      screen.getByTestId("ai-moderation-flag-threshold-confirm-cancel"),
    );
    await waitFor(() => {
      expect(
        screen.queryByTestId("ai-moderation-flag-threshold-confirm-dialog"),
      ).not.toBeInTheDocument();
    });
    expect(updateAiModerationThresholdConfig).not.toHaveBeenCalled();

    // Re-opening the dialog and confirming triggers the PUT call with the value.
    updateAiModerationThresholdConfig.mockResolvedValueOnce({
      ...SAVED_CONFIG,
      config: { flagThreshold: 0.05 },
      sources: { flagThreshold: "db" },
      changedFields: ["flagThreshold"],
    });

    await userEvent.click(screen.getByTestId("ai-moderation-flag-threshold-save"));
    expect(
      await screen.findByTestId("ai-moderation-flag-threshold-confirm-dialog"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByTestId("ai-moderation-flag-threshold-confirm-save"),
    );

    await waitFor(() => {
      expect(updateAiModerationThresholdConfig).toHaveBeenCalledTimes(1);
    });
    expect(updateAiModerationThresholdConfig).toHaveBeenCalledWith({
      flagThreshold: 0.05,
    });
  });

  it("renders the impact preview with the would/current counts from the API", async () => {
    render(<AdminSettings />);

    const input = (await screen.findByTestId(
      "ai-moderation-flag-threshold-input",
    )) as HTMLInputElement;

    // Type an in-range value so the debounced preview request fires.
    await userEvent.clear(input);
    await userEvent.type(input, "0.05");

    await waitFor(() => {
      expect(getAiModerationThresholdPreview).toHaveBeenCalledWith(0.05);
    });

    const preview = await screen.findByTestId("ai-moderation-flag-threshold-preview");
    const would = await within(preview).findByTestId(
      "ai-moderation-flag-threshold-preview-would",
    );
    const current = within(preview).getByTestId(
      "ai-moderation-flag-threshold-preview-current",
    );

    expect(would).toHaveTextContent("31");
    expect(current).toHaveTextContent("4");
    expect(preview.textContent).toContain("40");
  });
});
