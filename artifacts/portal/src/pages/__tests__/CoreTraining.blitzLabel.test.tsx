import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ full: "Build Test Scale", short: "BTS", possessive: "Build Test Scale's", shortPossessive: "BTS'" }),
}));

const authFetch = vi.fn();

vi.mock("@/lib/auth", () => ({
  authFetch: (...args: unknown[]) => authFetch(...args),
}));

import CoreTraining from "@/pages/CoreTraining";

beforeEach(() => {
  authFetch.mockReset();
  authFetch.mockResolvedValue({
    ok: true,
    json: async () => [],
  });
});

describe("CoreTraining Blitz card copy", () => {
  it("renders the Blitz card title without any day-count prefix", async () => {
    render(<CoreTraining />);

    const heading = await screen.findByRole("heading", { name: /The Blitz™/ });
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).toMatch(/The Blitz™/);
  });

  it("does not contain a day-count label anywhere on the Core Training page", async () => {
    const { container } = render(<CoreTraining />);

    await screen.findByRole("heading", { name: /The Blitz™/ });

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/21-Day/);
    expect(text).not.toMatch(/14-Day/);
    expect(text).not.toMatch(/Days To Scale/);
  });
});
