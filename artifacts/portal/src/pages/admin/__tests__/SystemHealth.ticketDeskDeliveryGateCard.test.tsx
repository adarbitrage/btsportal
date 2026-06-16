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

const PROBE_ORIGIN = "https://portal.buildtestscale.com";

interface DeliveryGateOverrides {
  origin?: string;
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

function buildHealth(dgOverrides: DeliveryGateOverrides) {
  const ticketDeskDeliveryGate = {
    origin: PROBE_ORIGIN,
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
    ...dgOverrides,
  };
  return {
    status:
      ticketDeskDeliveryGate.status === "blocked" ||
      ticketDeskDeliveryGate.alerting
        ? "degraded"
        : "healthy",
    services: {
      api: { status: "up", uptime: 1 },
      database: { status: "up", totalUsers: 0, totalTickets: 0 },
      redis: {
        status: "up",
        queueFallbacks: { alerting: false, totalCount: 0 },
      },
      ticketDeskDeliveryGate,
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

describe("SystemHealth — Ticket delivery gate card", () => {
  it("renders the blocked badge, alerting badge, consecutive counter, origin, and block reason", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        status: "blocked",
        alerting: true,
        threshold: 3,
        consecutiveBlocked: 3,
        reasons: ["http_403: Origin not allowed"],
        lastBlockedAt: "2025-05-27T12:00:00.000Z",
      }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-ticketdesk-delivery-gate");

    const statusBadge = within(card).getByTestId(
      "ticketdesk-delivery-gate-status",
    );
    expect(statusBadge).toHaveTextContent(/blocked/i);
    expect(statusBadge.title).toMatch(/origin not allowed/i);

    expect(
      within(card).getByTestId("ticketdesk-delivery-gate-alerting"),
    ).toHaveTextContent(/alerting/i);

    expect(
      within(card).getByTestId("ticketdesk-delivery-gate-consecutive-blocked"),
    ).toHaveTextContent("3 / 3");

    const reasons = within(card).getByTestId("ticketdesk-delivery-gate-reasons");
    expect(reasons).toHaveTextContent("Origin not allowed");

    expect(within(card).getByText(PROBE_ORIGIN)).toBeInTheDocument();
  });

  it("renders the ok badge and hides the alerting badge and reasons when delivery is accepted", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({ status: "ok", alerting: false, consecutiveBlocked: 0 }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-ticketdesk-delivery-gate");
    await waitFor(() => {
      expect(
        within(card).getByTestId("ticketdesk-delivery-gate-status"),
      ).toHaveTextContent(/ok/i);
    });

    const okBadge = within(card).getByTestId("ticketdesk-delivery-gate-status");
    expect(okBadge.title).toMatch(/reaching the help desk/i);

    expect(
      within(card).queryByTestId("ticketdesk-delivery-gate-alerting"),
    ).not.toBeInTheDocument();
    expect(
      within(card).queryByTestId("ticketdesk-delivery-gate-reasons"),
    ).not.toBeInTheDocument();
    expect(
      within(card).getByTestId("ticketdesk-delivery-gate-consecutive-blocked"),
    ).toHaveTextContent("0 / 3");
  });

  it("shows the unreachable badge with transient wording and the last probe error", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        status: "unreachable",
        consecutiveUnreachable: 1,
        lastError: "AbortError: The operation was aborted.",
      }),
    );
    render(<SystemHealth />);

    const card = await screen.findByTestId("card-ticketdesk-delivery-gate");
    const badge = within(card).getByTestId("ticketdesk-delivery-gate-status");
    expect(badge).toHaveTextContent(/unreachable/i);
    expect(badge.title).toMatch(/transient/i);
    expect(within(card).getByText(/AbortError/)).toBeInTheDocument();
  });
});
