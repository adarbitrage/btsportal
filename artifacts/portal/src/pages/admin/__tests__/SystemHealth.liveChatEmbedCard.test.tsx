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

interface LiveChatEmbedOverrides {
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
    url: "https://tickets.buildtestscale.com/",
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

describe("SystemHealth — Live Chat embed card", () => {
  it("renders the blocked status badge, consecutive-blocked counter, alerting badge, and blocking-header reasons", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        status: "blocked",
        alerting: true,
        threshold: 3,
        consecutiveBlocked: 3,
        reasons: ["X-Frame-Options: DENY", "CSP frame-ancestors 'none'"],
        lastBlockedAt: "2025-05-27T12:00:00.000Z",
      }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-live-chat-embed");

    const statusBadge = within(card).getByTestId("live-chat-embed-status");
    expect(statusBadge).toHaveTextContent(/blocked/i);

    expect(
      within(card).getByTestId("live-chat-embed-alerting"),
    ).toHaveTextContent(/alerting/i);

    expect(
      within(card).getByTestId("live-chat-embed-consecutive-blocked"),
    ).toHaveTextContent("3 / 3");

    const reasons = within(card).getByTestId("live-chat-embed-reasons");
    expect(reasons).toHaveTextContent("X-Frame-Options: DENY");
    expect(reasons).toHaveTextContent("CSP frame-ancestors 'none'");
  });

  it("renders the ok status badge and hides the alerting badge and reasons when the embed loads cleanly", async () => {
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
});
