import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

interface DeliveryOverrides {
  count?: number;
  pending?: number;
  failed?: number;
  oldestCreatedAt?: string | null;
  lastError?: string | null;
  stuckMinutes?: number;
  alerting?: boolean;
  lastSeenCount?: number;
}

function buildHealth(overrides: DeliveryOverrides = {}) {
  const count = overrides.count ?? 0;
  const alerting = overrides.alerting ?? false;
  const ticketDeskDelivery = {
    stuck: {
      count,
      byStatus: {
        pending: overrides.pending ?? 0,
        failed: overrides.failed ?? 0,
      },
      oldestCreatedAt: overrides.oldestCreatedAt ?? null,
      lastError: overrides.lastError ?? null,
      stuckMinutes: overrides.stuckMinutes ?? 30,
    },
    alerter: {
      alerting,
      lastSeenCount: overrides.lastSeenCount ?? count,
    },
  };
  return {
    status: alerting ? "degraded" : "healthy",
    services: {
      api: { status: "up", uptime: 1 },
      database: { status: "up", totalUsers: 0, totalTickets: 0 },
      redis: {
        status: "up",
        queueFallbacks: { alerting: false, totalCount: 0 },
      },
      ticketDeskDelivery,
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

describe("SystemHealth — TicketDesk delivery (stuck backlog) banner + card", () => {
  it("renders the red delivery banner and the paging-on-call card when the alerter is firing", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        count: 7,
        pending: 2,
        failed: 5,
        alerting: true,
        lastSeenCount: 7,
        lastError: "http_403: Origin not allowed",
      }),
    );

    render(<SystemHealth />);

    const banner = await screen.findByTestId("ticketdesk-delivery-banner");
    expect(banner).toHaveTextContent(/delivery is failing/i);
    expect(banner).toHaveTextContent("7 tickets");

    const card = await screen.findByTestId("card-ticketdesk-delivery");
    expect(
      within(card).getByTestId("ticketdesk-delivery-status"),
    ).toHaveTextContent(/paging on-call/i);
    expect(
      within(card).getByTestId("ticketdesk-delivery-stuck-count"),
    ).toHaveTextContent("7");
    expect(within(card).getByText("http_403: Origin not allowed")).toBeInTheDocument();
  });

  it("renders the card without the banner and shows a healthy badge when the backlog is empty", async () => {
    getSystemHealth.mockResolvedValue(buildHealth({ count: 0, alerting: false }));

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-ticketdesk-delivery");
    expect(
      within(card).getByTestId("ticketdesk-delivery-status"),
    ).toHaveTextContent(/healthy/i);

    expect(
      screen.queryByTestId("ticketdesk-delivery-banner"),
    ).not.toBeInTheDocument();
  });
});
