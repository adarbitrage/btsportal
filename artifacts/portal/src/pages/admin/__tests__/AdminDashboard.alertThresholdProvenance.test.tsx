import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
}));

const getDashboardKpis = vi.fn();
const getNeedsAttention = vi.fn();
const getRecentActivity = vi.fn();

vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getDashboardKpis: (...args: unknown[]) => getDashboardKpis(...args),
    getNeedsAttention: (...args: unknown[]) => getNeedsAttention(...args),
    getRecentActivity: (...args: unknown[]) => getRecentActivity(...args),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import AdminDashboard from "@/pages/admin/AdminDashboard";

beforeEach(() => {
  getDashboardKpis.mockReset();
  getNeedsAttention.mockReset();
  getRecentActivity.mockReset();

  getDashboardKpis.mockResolvedValue({
    totalMembers: 0,
    newMembers30d: 0,
    openTickets: 0,
    activeSubscriptions: 0,
    slaBreaches30d: 0,
  });
  getRecentActivity.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminDashboard burst alert threshold provenance line", () => {
  it("renders 'tuned to N hits / M min by <admin> on <date>' when lastTuned is present", async () => {
    getNeedsAttention.mockResolvedValue([
      {
        type: "auth_rate_limit_burst",
        severity: "high",
        title: "Auth rate-limit burst",
        description: "12 auth rate-limit hits in 15 minutes (mostly from 203.0.113.7)",
        link: "/admin/audit-log?actionType=auth_rate_limit",
        thresholds: { threshold: 10, windowMinutes: 15 },
        lastTuned: {
          at: "2025-08-15T12:00:00Z",
          actorId: 7,
          actorEmail: "ops@example.test",
          actorName: "Ops Admin",
          changedFields: ["threshold", "windowMinutes"],
        },
      },
    ]);

    render(<AdminDashboard />);

    const provenance = await screen.findByTestId("alert-threshold-provenance");
    expect(provenance).toHaveTextContent(/Tuned to 10 hits \/ 15 min/i);
    // Actor attribution prefers the friendly name while still showing the
    // email so an admin can disambiguate two people sharing a display name.
    expect(provenance).toHaveTextContent(/Ops Admin/);
    expect(provenance).toHaveTextContent(/ops@example.test/);
    // Date is formatted relative to the user's locale; we only assert that
    // a recognizable Aug 15 / 2025 substring is present rather than the
    // exact "MMM d, yyyy" string, since locales can shift it.
    expect(provenance.textContent ?? "").toMatch(/2025/);
  });

  it("renders the 'still on default thresholds' fallback when lastTuned is null", async () => {
    getNeedsAttention.mockResolvedValue([
      {
        type: "auth_rate_limit_burst",
        severity: "high",
        title: "Auth rate-limit burst",
        description: "12 auth rate-limit hits in 15 minutes",
        link: "/admin/audit-log?actionType=auth_rate_limit",
        thresholds: { threshold: 10, windowMinutes: 15 },
        lastTuned: null,
      },
    ]);

    render(<AdminDashboard />);

    const provenance = await screen.findByTestId("alert-threshold-provenance");
    expect(provenance).toHaveTextContent(/Tuned to 10 hits \/ 15 min/i);
    expect(provenance).toHaveTextContent(/still on default thresholds/i);
  });

  it("omits the provenance sub-line for alerts that don't carry tunable thresholds", async () => {
    getNeedsAttention.mockResolvedValue([
      {
        type: "some_other_alert",
        severity: "medium",
        title: "Other alert",
        description: "Something else needs attention",
        link: "/admin/elsewhere",
      },
    ]);

    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/Other alert/)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("alert-threshold-provenance")).not.toBeInTheDocument();
  });
});
