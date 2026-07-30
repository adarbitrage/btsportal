import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

const useAdSpendReconciliations = vi.fn();
const mutateAsync = vi.fn();
vi.mock("@/lib/ad-spend-reconciliation-api", () => ({
  useAdSpendReconciliations: (...args: unknown[]) => useAdSpendReconciliations(...args),
  useResolveAdSpendReconciliation: () => ({ mutateAsync }),
}));

import AdSpendReconciliation from "@/pages/admin/AdSpendReconciliation";

import type { AdSpendReconciliationRow } from "@/lib/ad-spend-reconciliation-api";

const openRow: AdSpendReconciliationRow = {
  orderNumber: "BTS-1001",
  chargedCents: 257_500,
  currency: "USD",
  createdAt: "2026-07-01T12:00:00.000Z",
  userId: 7,
  email: "member@example.com",
  name: "Pat Member",
  transactionId: "nmi-123",
  resolvedAt: null,
  resolvedBy: null,
  creditedCents: null,
};

const resolvedRow: AdSpendReconciliationRow = {
  ...openRow,
  orderNumber: "BTS-1000",
  resolvedAt: "2026-07-02T09:00:00.000Z",
  resolvedBy: "admin@example.com",
  creditedCents: 250_000,
};

function mockList(rows: AdSpendReconciliationRow[]) {
  useAdSpendReconciliations.mockReturnValue({
    data: {
      reconciliations: rows,
      openCount: rows.filter((r) => r.resolvedAt === null).length,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdSpendReconciliation admin page", () => {
  it("lists open reconciliation-needed deposits with a Resolve button", () => {
    mockList([openRow]);
    render(<AdSpendReconciliation />);

    expect(screen.getByText("BTS-1001")).toBeInTheDocument();
    expect(screen.getByText("member@example.com")).toBeInTheDocument();
    expect(screen.getByText("Needs reconciliation")).toBeInTheDocument();
    expect(screen.getByText("1 open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
  });

  it("shows an empty state when nothing is stuck", () => {
    mockList([]);
    render(<AdSpendReconciliation />);
    expect(
      screen.getByText(/No stuck ad-spend deposits/),
    ).toBeInTheDocument();
  });

  it("calls the resolve mutation and toasts the outcome", async () => {
    mockList([openRow]);
    mutateAsync.mockResolvedValue({
      outcome: "resolved",
      orderNumber: "BTS-1001",
      creditedCents: 250_000,
      feeCents: 7_500,
      chargedCents: 257_500,
      creditInserted: true,
    });
    render(<AdSpendReconciliation />);

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith("BTS-1001"));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Deposit reconciled",
          description: expect.stringContaining("credited $2,500.00"),
        }),
      ),
    );
  });

  it("toasts a destructive error when resolve fails", async () => {
    mockList([openRow]);
    mutateAsync.mockRejectedValue(new Error("This deposit was already reconciled — receipt not re-sent"));
    render(<AdSpendReconciliation />);

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Resolve failed",
          variant: "destructive",
          description: "This deposit was already reconciled — receipt not re-sent",
        }),
      ),
    );
  });

  it("renders resolved state (no Resolve button) for already-resolved rows", () => {
    mockList([resolvedRow]);
    render(<AdSpendReconciliation />);

    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText(/by admin@example.com/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
  });
});
