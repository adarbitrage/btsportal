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
const getAuthRateLimitAlertTrafficPreview = vi.fn();
const getChangeHistoryRetentionConfig = vi.fn();
const getOnCallDestinationProbes = vi.fn();

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
    getChangeHistoryRetentionConfig: (...args: unknown[]) =>
      getChangeHistoryRetentionConfig(...args),
    getOnCallDestinationProbes: (...args: unknown[]) =>
      getOnCallDestinationProbes(...args),
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
  getAuthRateLimitAlertTrafficPreview.mockReset();
  getChangeHistoryRetentionConfig.mockReset();
  getOnCallDestinationProbes.mockReset();

  getAuthRateLimitAlertTrafficPreview.mockResolvedValue({
    lookbackDays: 7,
    lookbackStart: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    totalHits: 0,
    dailyBuckets: [],
    eventTimestampsMs: [],
    truncated: false,
  });

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

describe("RecentProbesDisclosure", () => {
  it("does not fetch probes until the user expands the disclosure", async () => {
    getOnCallDestinationProbes.mockResolvedValue({
      field: "pagerdutyIntegrationKey",
      limit: 10,
      probes: [],
    });

    render(<AdminSettings />);

    const toggle = await screen.findByTestId(
      "oncall-probes-toggle-pagerdutyIntegrationKey",
    );
    expect(toggle).toBeInTheDocument();
    expect(getOnCallDestinationProbes).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("oncall-probes-panel-pagerdutyIntegrationKey"),
    ).not.toBeInTheDocument();
  });

  it("renders the empty state when the field has no probe history yet", async () => {
    getOnCallDestinationProbes.mockResolvedValue({
      field: "pagerdutyIntegrationKey",
      limit: 10,
      probes: [],
    });

    render(<AdminSettings />);
    const user = userEvent.setup();

    const toggle = await screen.findByTestId(
      "oncall-probes-toggle-pagerdutyIntegrationKey",
    );
    await user.click(toggle);

    const panel = await screen.findByTestId(
      "oncall-probes-panel-pagerdutyIntegrationKey",
    );
    await waitFor(() => {
      expect(
        within(panel).getByText(/no probe history yet/i),
      ).toBeInTheDocument();
    });

    expect(getOnCallDestinationProbes).toHaveBeenCalledTimes(1);
    expect(getOnCallDestinationProbes).toHaveBeenCalledWith(
      "pagerdutyIntegrationKey",
    );
  });

  it("renders ok / failed / skipped probe rows with their reasons", async () => {
    getOnCallDestinationProbes.mockResolvedValue({
      field: "opsAlertSlackWebhookUrl",
      limit: 10,
      probes: [
        {
          id: 301,
          createdAt: new Date("2026-04-29T17:00:00Z").toISOString(),
          ok: true,
          skipped: false,
          reason: null,
        },
        {
          id: 302,
          createdAt: new Date("2026-04-28T12:00:00Z").toISOString(),
          ok: false,
          skipped: false,
          reason: "http_401",
        },
        {
          id: 303,
          createdAt: new Date("2026-04-27T08:00:00Z").toISOString(),
          ok: false,
          skipped: true,
          reason: "no value configured",
        },
      ],
    });

    render(<AdminSettings />);
    const user = userEvent.setup();

    const toggle = await screen.findByTestId(
      "oncall-probes-toggle-opsAlertSlackWebhookUrl",
    );
    await user.click(toggle);

    const panel = await screen.findByTestId(
      "oncall-probes-panel-opsAlertSlackWebhookUrl",
    );

    await waitFor(() => {
      expect(within(panel).getByText("ok")).toBeInTheDocument();
    });
    expect(within(panel).getByText("failed")).toBeInTheDocument();
    expect(within(panel).getByText("skipped")).toBeInTheDocument();
    expect(within(panel).getByText("http_401")).toBeInTheDocument();
    expect(within(panel).getByText(/no value configured/i)).toBeInTheDocument();
    expect(
      within(panel).getByTestId("oncall-probe-history-row-ok"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByTestId("oncall-probe-history-row-failed"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByTestId("oncall-probe-history-row-skipped"),
    ).toBeInTheDocument();

    expect(getOnCallDestinationProbes).toHaveBeenCalledTimes(1);
    expect(getOnCallDestinationProbes).toHaveBeenCalledWith(
      "opsAlertSlackWebhookUrl",
    );
  });

  it("collapses the panel without re-fetching when toggled off and on again", async () => {
    getOnCallDestinationProbes.mockResolvedValue({
      field: "pagerdutyIntegrationKey",
      limit: 10,
      probes: [],
    });

    render(<AdminSettings />);
    const user = userEvent.setup();

    const toggle = await screen.findByTestId(
      "oncall-probes-toggle-pagerdutyIntegrationKey",
    );

    await user.click(toggle);
    await screen.findByTestId("oncall-probes-panel-pagerdutyIntegrationKey");
    expect(getOnCallDestinationProbes).toHaveBeenCalledTimes(1);

    await user.click(toggle);
    await waitFor(() => {
      expect(
        screen.queryByTestId("oncall-probes-panel-pagerdutyIntegrationKey"),
      ).not.toBeInTheDocument();
    });

    await user.click(toggle);
    await screen.findByTestId("oncall-probes-panel-pagerdutyIntegrationKey");
    expect(getOnCallDestinationProbes).toHaveBeenCalledTimes(1);
  });
});
