import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// The guide body is served by the gated /blitz/guide endpoint (never
// bundled); load it from the shared package and serve it via mocked authFetch.
import { BLITZ_BODY_HTML } from "@workspace/blitz-curriculum/blitz-body-html";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("@/lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth")>();
  return {
    ...actual,
    authFetch: vi.fn(async (path: string) => {
      if (path === "/blitz/guide") {
        return { ok: true, json: async () => ({ html: BLITZ_BODY_HTML }) } as Response;
      }
      return { ok: true, json: async () => [] } as unknown as Response;
    }),
  };
});

import Blitz from "../Blitz";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Blitz />
      </Router>
    </QueryClientProvider>,
  );
}

const visibleSections = (container: HTMLElement): string[] => {
  const mods = Array.from(
    container.querySelectorAll<HTMLElement>(".module[data-section]"),
  );
  return mods
    .filter((m) => m.style.display !== "none")
    .map((m) => m.getAttribute("data-section") || "");
};

describe("Blitz section-view routing", () => {
  it("renders only the targeted lesson section at /blitz/guide/:lessonId", async () => {
    const { container } = renderAt("/blitz/guide/5");
    // Guide HTML arrives async from the gated endpoint — wait for injection.
    await waitFor(() => {
      expect(
        container.querySelectorAll(".module[data-section]").length,
      ).toBeGreaterThan(0);
    });
    await waitFor(() => {
      const shown = visibleSections(container);
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.every((s) => s.split(/\s+/).includes("s5"))).toBe(true);
    });
  });

  it("shows the full guide (all modules) at /blitz/guide with no lesson id", async () => {
    const { container } = renderAt("/blitz/guide");
    await waitFor(() => {
      expect(
        container.querySelectorAll(".module[data-section]").length,
      ).toBeGreaterThan(0);
    });
    const shown = visibleSections(container);
    const all = Array.from(
      container.querySelectorAll<HTMLElement>(".module[data-section]"),
    );
    expect(shown.length).toBe(all.length);
  });
});
