import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// Locks in the merged "Private Coaching" admin page: a single AppLayout +
// heading hosting the Sessions and Session Credits panels under tabs. The
// active tab is driven by the URL (`?tab=credits`) so admins can bookmark and
// share a direct link to the Credits view and it survives a refresh. A refactor
// that splits these back into two pages, drops a tab, or stops persisting the
// tab in the URL breaks here.

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

function renderAt(path: string) {
  const { hook, history } = memoryLocation({ path, record: true });
  const utils = render(
    <Router hook={hook}>
      <PrivateCoaching />
    </Router>,
  );
  return { ...utils, history };
}

afterEach(() => {
  cleanup();
});

describe("PrivateCoaching — merged admin page", () => {
  it("renders the Private Coaching heading with both tabs", () => {
    renderAt("/admin/coaching/sessions");

    expect(
      screen.getByRole("heading", { name: "Private Coaching" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("tab-sessions")).toBeInTheDocument();
    expect(screen.getByTestId("tab-credits")).toBeInTheDocument();
  });

  it("opens the Sessions tab by default when no tab is in the URL", () => {
    renderAt("/admin/coaching/sessions");
    expect(screen.getByTestId("sessions-panel")).toBeInTheDocument();
  });

  it("opens the Credits tab directly when ?tab=credits is in the URL", async () => {
    renderAt("/admin/coaching/sessions?tab=credits");
    expect(await screen.findByTestId("credits-panel")).toBeInTheDocument();
  });

  it("reflects the active tab in the URL when switching tabs", async () => {
    const { history } = renderAt("/admin/coaching/sessions");

    await userEvent.click(screen.getByTestId("tab-credits"));
    expect(await screen.findByTestId("credits-panel")).toBeInTheDocument();
    expect(history[history.length - 1]).toBe("/admin/coaching/sessions?tab=credits");

    // Switching back to Sessions drops the query param.
    await userEvent.click(screen.getByTestId("tab-sessions"));
    expect(await screen.findByTestId("sessions-panel")).toBeInTheDocument();
    expect(history[history.length - 1]).toBe("/admin/coaching/sessions");
  });
});
