import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Router, Switch, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

const accessState = {
  accessiblePageKeys: new Set<string>(["blitz"]),
  isLoading: false,
  isError: false,
};
vi.mock("@/hooks/use-content-access", () => ({
  CONTENT_ACCESS_QUERY_KEY: ["content-access", "me"],
  useContentAccess: () => accessState,
}));

vi.mock("@/lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth")>();
  return {
    ...actual,
    AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    useAuth: () => ({
      user: {
        id: "u1",
        role: "member",
        onboardingComplete: true,
        mustChangePassword: false,
      },
      loading: false,
    }),
  };
});

vi.mock("@workspace/api-client-react", async (importActual) => {
  const actual =
    await importActual<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useGetCurrentMember: () => ({ data: { role: "member" }, isLoading: false }),
  };
});

import { ContentAccessRoute } from "../../App";
import BlitzHub from "../BlitzHub";
import Blitz from "../Blitz";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const visibleSections = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll<HTMLElement>(".module[data-section]"))
    .filter((m) => m.style.display !== "none")
    .map((m) => m.getAttribute("data-section") || "");

describe("Blitz hub → guide section navigation (SPA click, real route guard)", () => {
  it("clicking 'Go to Section' opens only that lesson's section, not the full guide", async () => {
    const { hook } = memoryLocation({ path: "/blitz", record: true });
    const { container } = render(
      <Router hook={hook}>
        <Switch>
          <Route path="/blitz">
            {() => <ContentAccessRoute component={BlitzHub} pageKey="blitz" />}
          </Route>
          <Route path="/blitz/guide">
            {() => <ContentAccessRoute component={Blitz} pageKey="blitz" />}
          </Route>
          <Route path="/blitz/guide/:lessonId">
            {() => <ContentAccessRoute component={Blitz} pageKey="blitz" />}
          </Route>
        </Switch>
      </Router>,
    );

    const buttons = await screen.findAllByRole("link", {
      name: /Go to Section/i,
    });
    expect(buttons.length).toBeGreaterThan(0);
    await userEvent.click(buttons[4]);

    await waitFor(() => {
      expect(
        container.querySelector(".blitz-content.section-filtered"),
      ).toBeTruthy();
    });

    const shown = visibleSections(container);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((s) => s.split(/\s+/).includes("s5"))).toBe(true);
  });
});
