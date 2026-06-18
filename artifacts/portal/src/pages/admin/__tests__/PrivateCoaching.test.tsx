import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

// Locks in the merged "Private Coaching" admin page: a single AppLayout +
// heading hosting the Sessions and Session Credits panels under tabs. The
// Sessions tab is shown by default; switching reveals the Credits panel. A
// refactor that splits these back into two pages or drops a tab breaks here.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

vi.mock("@/pages/admin/PackSessions", () => ({
  default: () => <div data-testid="sessions-panel">Sessions panel</div>,
}));

vi.mock("@/pages/admin/PackCredits", () => ({
  default: () => <div data-testid="credits-panel">Credits panel</div>,
}));

import PrivateCoaching from "../PrivateCoaching";

describe("PrivateCoaching — merged admin page", () => {
  it("renders the Private Coaching heading with both panels under tabs", async () => {
    render(<PrivateCoaching />);

    expect(
      screen.getByRole("heading", { name: "Private Coaching" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("tab-sessions")).toBeInTheDocument();
    expect(screen.getByTestId("tab-credits")).toBeInTheDocument();

    // Sessions tab is active by default.
    expect(screen.getByTestId("sessions-panel")).toBeInTheDocument();

    // Switching to the Credits tab reveals the credits panel.
    await userEvent.click(screen.getByTestId("tab-credits"));
    expect(await screen.findByTestId("credits-panel")).toBeInTheDocument();
  });
});
