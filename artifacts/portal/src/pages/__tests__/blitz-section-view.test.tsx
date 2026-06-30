import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

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
  return render(
    <Router hook={hook}>
      <Blitz />
    </Router>,
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
  it("renders only the targeted lesson section at /blitz/guide/:lessonId", () => {
    const { container } = renderAt("/blitz/guide/5");
    const shown = visibleSections(container);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((s) => s.split(/\s+/).includes("s5"))).toBe(true);
  });

  it("shows the full guide (all modules) at /blitz/guide with no lesson id", () => {
    const { container } = renderAt("/blitz/guide");
    const shown = visibleSections(container);
    const all = Array.from(
      container.querySelectorAll<HTMLElement>(".module[data-section]"),
    );
    expect(shown.length).toBe(all.length);
  });
});
