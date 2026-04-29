import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
const getAuthRateLimitAlertConfigHistory = vi.fn();
const getChangeHistoryRetentionConfig = vi.fn();

vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getSettings: (...args: unknown[]) => getSettings(...args),
    getOnCallDestinations: (...args: unknown[]) => getOnCallDestinations(...args),
    getOnCallDestinationsHistory: (...args: unknown[]) =>
      getOnCallDestinationsHistory(...args),
    getAuthRateLimitAlertConfig: (...args: unknown[]) =>
      getAuthRateLimitAlertConfig(...args),
    getAuthRateLimitAlertConfigHistory: (...args: unknown[]) =>
      getAuthRateLimitAlertConfigHistory(...args),
    getChangeHistoryRetentionConfig: (...args: unknown[]) =>
      getChangeHistoryRetentionConfig(...args),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import AdminSettings from "@/pages/admin/AdminSettings";

beforeEach(() => {
  getSettings.mockReset();
  getOnCallDestinations.mockReset();
  getOnCallDestinationsHistory.mockReset();
  getAuthRateLimitAlertConfig.mockReset();
  getAuthRateLimitAlertConfigHistory.mockReset();
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
  getAuthRateLimitAlertConfig.mockResolvedValue({
    config: { threshold: 10, windowMinutes: 5, dominantIpRatio: 0.5 },
    sources: { threshold: "default", windowMinutes: "default", dominantIpRatio: "default" },
    defaults: { threshold: 10, windowMinutes: 5, dominantIpRatio: 0.5 },
    bounds: {
      threshold: { min: 1, max: 1000 },
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuthRateLimitAlertConfigCard recent threshold edits timeline", () => {
  it("shows an empty-state message when no edits have been recorded", async () => {
    getAuthRateLimitAlertConfigHistory.mockResolvedValue({ events: [], limit: 10 });

    render(<AdminSettings />);

    await waitFor(() => {
      expect(screen.getByTestId("alert-config-history-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/no threshold edits recorded yet/i)).toBeInTheDocument();
    // The "View all in Audit Log" deep link is always present once loading
    // resolves so admins can drill into the full audit history.
    const link = screen.getByTestId("link-alert-config-view-all-audit");
    expect(link).toHaveAttribute(
      "href",
      "/admin/audit-log?entityType=auth_rate_limit_alert_config",
    );
  });

  it("renders one row per event with from→to badges for changed fields", async () => {
    getAuthRateLimitAlertConfigHistory.mockResolvedValue({
      events: [
        {
          id: 42,
          createdAt: new Date("2025-08-15T12:00:00Z").toISOString(),
          actionType: "update_setting",
          actorId: 7,
          actorEmail: "ops@example.test",
          actorName: "Ops Admin",
          description: "Updated auth rate-limit alert config",
          changedFields: ["threshold", "windowMinutes"],
          diff: [
            { field: "threshold", from: 10, to: 25 },
            { field: "windowMinutes", from: 5, to: 10 },
          ],
        },
      ],
      limit: 10,
    });

    render(<AdminSettings />);

    const row = await screen.findByTestId("alert-config-history-row-42");
    // Badges per changed field carry the from→to so admins can see the
    // shape of the change without leaving the card.
    const thresholdBadge = within(row).getByTestId(
      "alert-config-history-change-threshold",
    );
    expect(thresholdBadge).toHaveTextContent(/10/);
    expect(thresholdBadge).toHaveTextContent(/25/);

    const windowBadge = within(row).getByTestId(
      "alert-config-history-change-windowMinutes",
    );
    expect(windowBadge).toHaveTextContent(/5/);
    expect(windowBadge).toHaveTextContent(/10/);

    // Actor attribution prefers name + email when both are present.
    expect(row).toHaveTextContent(/Ops Admin/);
    expect(row).toHaveTextContent(/ops@example.test/);
  });

  it("does not render the View-all link until history finishes loading", async () => {
    let resolveHistory!: (value: { events: unknown[]; limit: number }) => void;
    getAuthRateLimitAlertConfigHistory.mockReturnValue(
      new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );

    render(<AdminSettings />);

    // The loading state is rendered, the deep link is suppressed.
    await screen.findByTestId("alert-config-history-loading");
    expect(
      screen.queryByTestId("link-alert-config-view-all-audit"),
    ).not.toBeInTheDocument();

    resolveHistory({ events: [], limit: 10 });
    await screen.findByTestId("link-alert-config-view-all-audit");
  });
});
