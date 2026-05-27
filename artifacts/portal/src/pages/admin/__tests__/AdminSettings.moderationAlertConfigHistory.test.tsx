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
const getModerationFailureAlertConfig = vi.fn();
const getModerationFailureAlertConfigHistory = vi.fn();
const updateModerationFailureAlertConfig = vi.fn();
const getChangeHistoryRetentionConfig = vi.fn();

vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getSettings: (...args: unknown[]) => getSettings(...args),
    getOnCallDestinations: (...args: unknown[]) => getOnCallDestinations(...args),
    getOnCallDestinationsHistory: (...args: unknown[]) =>
      getOnCallDestinationsHistory(...args),
    getModerationFailureAlertConfig: (...args: unknown[]) =>
      getModerationFailureAlertConfig(...args),
    getModerationFailureAlertConfigHistory: (...args: unknown[]) =>
      getModerationFailureAlertConfigHistory(...args),
    updateModerationFailureAlertConfig: (...args: unknown[]) =>
      updateModerationFailureAlertConfig(...args),
    getChangeHistoryRetentionConfig: (...args: unknown[]) =>
      getChangeHistoryRetentionConfig(...args),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import AdminSettings from "@/pages/admin/AdminSettings";

const baseModerationStatus = {
  config: { threshold: 5, windowMinutes: 10 },
  sources: { threshold: "default" as const, windowMinutes: "default" as const },
  defaults: { threshold: 5, windowMinutes: 10 },
  bounds: {
    threshold: { min: 1, max: 1000 },
    windowMinutes: { min: 1, max: 60 },
  },
};

beforeEach(() => {
  getSettings.mockReset();
  getOnCallDestinations.mockReset();
  getOnCallDestinationsHistory.mockReset();
  getModerationFailureAlertConfig.mockReset();
  getModerationFailureAlertConfigHistory.mockReset();
  updateModerationFailureAlertConfig.mockReset();
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
  getModerationFailureAlertConfig.mockResolvedValue(baseModerationStatus);
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

// Helper: scopes queries to the moderation card so we don't accidentally
// match the auth rate-limit card, which renders the same
// AlertConfigHistorySection with a different auditEntityType.
async function findModerationCard() {
  const heading = await screen.findByText(/moderation job failure alert/i);
  // Climb to the enclosing Card so `within(card)` covers the whole card body.
  const card = heading.closest("div.rounded-lg, [class*='card']") as HTMLElement | null;
  return card ?? (heading.parentElement as HTMLElement);
}

describe("ModerationFailureAlertConfigCard recent threshold edits timeline", () => {
  it("renders the empty state and a moderation-scoped View-all link when no edits exist", async () => {
    getModerationFailureAlertConfigHistory.mockResolvedValue({ events: [], limit: 10 });

    render(<AdminSettings />);

    const card = await findModerationCard();

    await waitFor(() => {
      expect(within(card).getByTestId("alert-config-history-empty")).toBeInTheDocument();
    });
    expect(
      within(card).getByText(/no threshold edits recorded yet/i),
    ).toBeInTheDocument();

    const link = within(card).getByTestId("link-alert-config-view-all-audit");
    // The deep link must point at the moderation entity, NOT the auth
    // rate-limit value that the shared AlertConfigHistorySection also
    // supports via its auditEntityType prop.
    expect(link).toHaveAttribute(
      "href",
      "/admin/audit-log?entityType=moderation_failure_alert_config",
    );
    expect(link.getAttribute("href")).not.toContain("auth_rate_limit_alert_config");
  });

  it("renders one row per event with from→to badges for changed fields", async () => {
    getModerationFailureAlertConfigHistory.mockResolvedValue({
      events: [
        {
          id: 77,
          createdAt: new Date("2025-09-01T12:00:00Z").toISOString(),
          actionType: "update_setting",
          actorId: 3,
          actorEmail: "mod@example.test",
          actorName: "Mod Admin",
          description: "Updated moderation failure alert config",
          changedFields: ["threshold", "windowMinutes"],
          diff: [
            { field: "threshold", from: 5, to: 12 },
            { field: "windowMinutes", from: 10, to: 30 },
          ],
        },
      ],
      limit: 10,
    });

    render(<AdminSettings />);

    const card = await findModerationCard();
    const row = await within(card).findByTestId("alert-config-history-row-77");
    const thresholdBadge = within(row).getByTestId(
      "alert-config-history-change-threshold",
    );
    expect(thresholdBadge).toHaveTextContent(/5/);
    expect(thresholdBadge).toHaveTextContent(/12/);

    const windowBadge = within(row).getByTestId(
      "alert-config-history-change-windowMinutes",
    );
    expect(windowBadge).toHaveTextContent(/10/);
    expect(windowBadge).toHaveTextContent(/30/);

    expect(row).toHaveTextContent(/Mod Admin/);
    expect(row).toHaveTextContent(/mod@example.test/);
  });

  it("re-fetches history after a successful save", async () => {
    getModerationFailureAlertConfigHistory.mockResolvedValue({ events: [], limit: 10 });
    updateModerationFailureAlertConfig.mockResolvedValue({
      ...baseModerationStatus,
      config: { threshold: 8, windowMinutes: 10 },
      sources: { threshold: "db", windowMinutes: "default" },
      changedFields: ["threshold"],
    });

    render(<AdminSettings />);

    const thresholdInput = await screen.findByTestId(
      "moderation-failure-alert-threshold-input",
    );
    await waitFor(() => {
      expect(getModerationFailureAlertConfigHistory).toHaveBeenCalledTimes(1);
    });

    await userEvent.clear(thresholdInput);
    await userEvent.type(thresholdInput, "8");

    const saveBtn = screen.getByTestId("moderation-failure-alert-save");
    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateModerationFailureAlertConfig).toHaveBeenCalledWith({
        threshold: 8,
        windowMinutes: 10,
      });
    });
    // The save handler calls loadHistory() after a successful update so
    // the admin sees their own change in the timeline without reloading.
    await waitFor(() => {
      expect(getModerationFailureAlertConfigHistory).toHaveBeenCalledTimes(2);
    });
  });
});
