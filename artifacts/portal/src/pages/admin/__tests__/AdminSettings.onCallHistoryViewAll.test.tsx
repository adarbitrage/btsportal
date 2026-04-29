import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

describe("OnCallHistorySection 'View all in Audit Log' link", () => {
  it("deep-links to the audit log filtered to entityType=oncall_destinations when there are events", async () => {
    getOnCallDestinationsHistory.mockResolvedValue({
      events: [
        {
          id: 1,
          actionType: "update_setting",
          actorId: 5,
          actorEmail: "admin@example.test",
          actorRole: "admin",
          createdAt: new Date().toISOString(),
          changedFields: ["opsAlertEmail"],
        },
      ],
    });

    render(<AdminSettings />);

    const link = await screen.findByTestId("link-oncall-view-all-audit");
    expect(link).toHaveAttribute(
      "href",
      "/admin/audit-log?entityType=oncall_destinations",
    );
    expect(link).toHaveTextContent(/view all in audit log/i);
  });

  it("still shows the link even when there are no recent change events yet", async () => {
    getOnCallDestinationsHistory.mockResolvedValue({ events: [] });

    render(<AdminSettings />);

    await waitFor(() => {
      expect(screen.getByText(/no changes recorded yet/i)).toBeInTheDocument();
    });
    const link = screen.getByTestId("link-oncall-view-all-audit");
    expect(link).toHaveAttribute(
      "href",
      "/admin/audit-log?entityType=oncall_destinations",
    );
  });

  it("does not render the link while history is still loading", async () => {
    let resolveHistory!: (value: { events: unknown[] }) => void;
    getOnCallDestinationsHistory.mockReturnValue(
      new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );

    render(<AdminSettings />);

    expect(
      screen.queryByTestId("link-oncall-view-all-audit"),
    ).not.toBeInTheDocument();

    resolveHistory({ events: [] });
    await screen.findByTestId("link-oncall-view-all-audit");
  });
});
