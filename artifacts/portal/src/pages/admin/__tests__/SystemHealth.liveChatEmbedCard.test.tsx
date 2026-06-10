import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useSearch: () => "",
  useLocation: () => ["/admin/system", () => {}],
}));

const getSystemHealth = vi.fn();
const getYsePendingGrants = vi.fn();
const getQueueFallbackEvents = vi.fn();
const getQueueFallbackAlertEvents = vi.fn();
const getQueueFallbackAlerterHealth = vi.fn();
const getOnCallDestinationsHistory = vi.fn();

vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getSystemHealth: (...args: unknown[]) => getSystemHealth(...args),
    getYsePendingGrants: (...args: unknown[]) => getYsePendingGrants(...args),
    getQueueFallbackEvents: (...args: unknown[]) =>
      getQueueFallbackEvents(...args),
    getQueueFallbackAlertEvents: (...args: unknown[]) =>
      getQueueFallbackAlertEvents(...args),
    getQueueFallbackAlerterHealth: (...args: unknown[]) =>
      getQueueFallbackAlerterHealth(...args),
    getOnCallDestinationsHistory: (...args: unknown[]) =>
      getOnCallDestinationsHistory(...args),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import SystemHealth from "@/pages/admin/SystemHealth";

// The widget script URL the probe checks (matches the shared support-config default).
const WIDGET_SCRIPT_URL = "https://tickets.buildtestscale.com/widget.js";

interface LiveChatEmbedOverrides {
  url?: string;
  status?: "ok" | "blocked" | "unreachable" | "unknown";
  alerting?: boolean;
  threshold?: number;
  consecutiveBlocked?: number;
  consecutiveUnreachable?: number;
  reasons?: string[];
  lastCheckedAt?: string | null;
  lastOkAt?: string | null;
  lastBlockedAt?: string | null;
  lastUnreachableAt?: string | null;
  lastError?: string | null;
}

function buildHealth(lce: LiveChatEmbedOverrides) {
  const liveChatEmbed = {
    url: WIDGET_SCRIPT_URL,
    status: "ok",
    alerting: false,
    threshold: 3,
    consecutiveBlocked: 0,
    consecutiveUnreachable: 0,
    reasons: [],
    lastCheckedAt: "2025-05-27T12:00:00.000Z",
    lastOkAt: "2025-05-27T12:00:00.000Z",
    lastBlockedAt: null,
    lastUnreachableAt: null,
    lastError: null,
    ...lce,
  };
  return {
    status:
      liveChatEmbed.status === "blocked" || liveChatEmbed.alerting
        ? "degraded"
        : "healthy",
    services: {
      api: { status: "up", uptime: 1 },
      database: { status: "up", totalUsers: 0, totalTickets: 0 },
      redis: {
        status: "up",
        queueFallbacks: { alerting: false, totalCount: 0 },
      },
      liveChatEmbed,
      missingCriticalSecrets: [],
    },
    webhooks: { last24h: 0, failed24h: 0 },
    auditLogs: { last24h: [] },
    serverTime: new Date().toISOString(),
  };
}

beforeEach(() => {
  getSystemHealth.mockReset();
  getYsePendingGrants.mockReset();
  getQueueFallbackEvents.mockReset();
  getQueueFallbackAlertEvents.mockReset();
  getQueueFallbackAlerterHealth.mockReset();
  getOnCallDestinationsHistory.mockReset();

  getYsePendingGrants.mockResolvedValue({ items: [] });
  getQueueFallbackEvents.mockResolvedValue({ events: [] });
  getQueueFallbackAlertEvents.mockResolvedValue({ events: [], stats: null });
  getQueueFallbackAlerterHealth.mockResolvedValue({
    channels: [],
    throttles: [],
    throttleSource: "memory",
    alertingSource: "memory",
  });
  getOnCallDestinationsHistory.mockResolvedValue({ events: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SystemHealth — Live Chat widget card", () => {
  it("renders the blocked status badge, consecutive-unavailable counter, alerting badge, and load-error reasons", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        status: "blocked",
        alerting: true,
        threshold: 3,
        consecutiveBlocked: 3,
        reasons: ["http_404"],
        lastBlockedAt: "2025-05-27T12:00:00.000Z",
      }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-live-chat-embed");

    const statusBadge = within(card).getByTestId("live-chat-embed-status");
    expect(statusBadge).toHaveTextContent(/blocked/i);
    // Badge tooltip should reference "unavailable", not "framing" (old iframe wording).
    expect(statusBadge.title).toMatch(/unavailable/i);
    expect(statusBadge.title).not.toMatch(/framing/i);

    expect(
      within(card).getByTestId("live-chat-embed-alerting"),
    ).toHaveTextContent(/alerting/i);

    expect(
      within(card).getByTestId("live-chat-embed-consecutive-blocked"),
    ).toHaveTextContent("3 / 3");

    const reasons = within(card).getByTestId("live-chat-embed-reasons");
    expect(reasons).toHaveTextContent("http_404");
    // Section heading should say "Load error" not "Blocking headers".
    expect(reasons.textContent).toContain("Load error");
    expect(reasons.textContent).not.toContain("Blocking headers");
  });

  it("renders the ok status badge and hides the alerting badge and reasons when the widget script loads cleanly", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({ status: "ok", alerting: false, consecutiveBlocked: 0 }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-live-chat-embed");
    await waitFor(() => {
      expect(
        within(card).getByTestId("live-chat-embed-status"),
      ).toHaveTextContent(/ok/i);
    });

    const okBadge = within(card).getByTestId("live-chat-embed-status");
    expect(okBadge.title).toMatch(/accessible/i);

    expect(
      within(card).queryByTestId("live-chat-embed-alerting"),
    ).not.toBeInTheDocument();
    expect(
      within(card).queryByTestId("live-chat-embed-reasons"),
    ).not.toBeInTheDocument();
    expect(
      within(card).getByTestId("live-chat-embed-consecutive-blocked"),
    ).toHaveTextContent("0 / 3");
  });

  it("shows the widget script URL in the 'Widget script' row (not 'Embed URL')", async () => {
    getSystemHealth.mockResolvedValue(buildHealth({}));

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-live-chat-embed");

    expect(within(card).getByText("Widget script")).toBeInTheDocument();
    expect(within(card).queryByText("Embed URL")).not.toBeInTheDocument();

    // The URL shown is the widget script URL, not the root TicketDesk URL.
    expect(within(card).getByText(WIDGET_SCRIPT_URL)).toBeInTheDocument();
  });

  it("labels the streak counter 'Consecutive unavailable' (not 'Consecutive blocked')", async () => {
    getSystemHealth.mockResolvedValue(buildHealth({}));
    render(<SystemHealth />);

    const card = await screen.findByTestId("card-live-chat-embed");
    expect(within(card).getByText("Consecutive unavailable")).toBeInTheDocument();
    expect(within(card).queryByText("Consecutive blocked")).not.toBeInTheDocument();
  });

  it("shows 'Last unavailable' timestamp when lastBlockedAt is set", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        status: "blocked",
        consecutiveBlocked: 1,
        reasons: ["http_403"],
        lastBlockedAt: "2025-06-01T09:00:00.000Z",
      }),
    );
    render(<SystemHealth />);

    const card = await screen.findByTestId("card-live-chat-embed");
    expect(within(card).getByText("Last unavailable")).toBeInTheDocument();
    expect(within(card).queryByText("Last blocked")).not.toBeInTheDocument();
  });

  it("shows the unreachable badge with transient wording when the probe cannot reach the script", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        status: "unreachable",
        lastError: "AbortError: The operation was aborted.",
      }),
    );
    render(<SystemHealth />);

    const card = await screen.findByTestId("card-live-chat-embed");
    const badge = within(card).getByTestId("live-chat-embed-status");
    expect(badge).toHaveTextContent(/unreachable/i);
    expect(badge.title).toMatch(/transient/i);
  });
});
