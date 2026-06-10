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
const getLiveChatSupportConfig = vi.fn();

vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getSettings: (...args: unknown[]) => getSettings(...args),
    getOnCallDestinations: (...args: unknown[]) => getOnCallDestinations(...args),
    getOnCallDestinationsHistory: (...args: unknown[]) =>
      getOnCallDestinationsHistory(...args),
    getLiveChatSupportConfig: (...args: unknown[]) =>
      getLiveChatSupportConfig(...args),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Control the in-portal embed URL so we can deterministically exercise the
// in-sync vs mismatch branches against whatever probe URL the API returns.
vi.mock("@/config/support", () => ({
  TICKETDESK_URL: "https://tickets.buildtestscale.com/",
}));

import AdminSettings from "@/pages/admin/AdminSettings";

beforeEach(() => {
  getSettings.mockReset();
  getOnCallDestinations.mockReset();
  getOnCallDestinationsHistory.mockReset();
  getLiveChatSupportConfig.mockReset();

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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LiveChatSupportCard", () => {
  it("shows the embed + probe URLs and an in-sync badge when they agree", async () => {
    getLiveChatSupportConfig.mockResolvedValue({
      probeUrl: "https://tickets.buildtestscale.com/",
      probeUrlSource: "default",
      defaultUrl: "https://tickets.buildtestscale.com/",
    });

    render(<AdminSettings />);

    const card = await screen.findByTestId("card-live-chat-support");

    await waitFor(() => {
      expect(
        within(card).getByTestId("live-chat-support-embed-url"),
      ).toHaveAttribute("href", "https://tickets.buildtestscale.com/");
    });
    expect(
      within(card).getByTestId("live-chat-support-probe-url"),
    ).toHaveAttribute("href", "https://tickets.buildtestscale.com/");
    expect(within(card).getByTestId("live-chat-support-sync")).toHaveTextContent(
      /in sync/i,
    );
    expect(
      within(card).queryByTestId("live-chat-support-mismatch-note"),
    ).not.toBeInTheDocument();
  });

  it("ignores a trailing-slash difference when deciding in-sync", async () => {
    getLiveChatSupportConfig.mockResolvedValue({
      // No trailing slash — must still read as in sync.
      probeUrl: "https://tickets.buildtestscale.com",
      probeUrlSource: "default",
      defaultUrl: "https://tickets.buildtestscale.com/",
    });

    render(<AdminSettings />);

    const card = await screen.findByTestId("card-live-chat-support");
    await waitFor(() => {
      expect(
        within(card).getByTestId("live-chat-support-sync"),
      ).toHaveTextContent(/in sync/i);
    });
  });

  it("flags a mismatch when the embed and probe URLs differ", async () => {
    getLiveChatSupportConfig.mockResolvedValue({
      probeUrl: "https://support.example.com/",
      probeUrlSource: "env",
      defaultUrl: "https://tickets.buildtestscale.com/",
    });

    render(<AdminSettings />);

    const card = await screen.findByTestId("card-live-chat-support");
    await waitFor(() => {
      expect(
        within(card).getByTestId("live-chat-support-sync"),
      ).toHaveTextContent(/mismatch/i);
    });
    expect(
      within(card).getByTestId("live-chat-support-mismatch-note"),
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("live-chat-support-probe-url"),
    ).toHaveAttribute("href", "https://support.example.com/");
    expect(within(card).getByText(/env override/i)).toBeInTheDocument();
  });
});
