/**
 * Swipe Resource Bank — disclaimer rendering (Task #2104).
 *
 * The ownership/use disclaimer is legally load-bearing: the gallery must
 * always render BOTH the top anchor link and the full block at the bottom,
 * and sparsely-populated sections must show intentional empty states.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SwipeBank from "../SwipeBank";
import type { SwipeBankResponse } from "@/lib/swipe-bank-api";

const RESPONSE: SwipeBankResponse = {
  verticals: [
    {
      id: 1,
      name: "Health",
      subVerticals: [
        { id: 11, name: "Diet/Weight Loss", angles: [], items: [] },
      ],
    },
    { id: 2, name: "Wealth", subVerticals: [] },
  ],
  disclaimer: {
    topNote: "Read the full ownership & use disclaimer below.",
    heading: "Ownership & Use Disclaimer",
    paragraphs: [
      "We do not claim ownership of any of the creatives in this resource.",
      "If you are the rights holder and want an item removed, contact support.",
    ],
  },
};

vi.mock("@/lib/swipe-bank-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/swipe-bank-api")>(
    "@/lib/swipe-bank-api",
  );
  return {
    ...actual,
    fetchSwipeBank: vi.fn(async () => RESPONSE),
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SwipeBank />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("SwipeBank disclaimer + empty states", () => {
  it("renders the top disclaimer link anchored to the full bottom block", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("swipe-bank-disclaimer-block")).toBeTruthy(),
    );

    const topLink = screen.getByTestId(
      "swipe-bank-disclaimer-top-link",
    ) as HTMLAnchorElement;
    expect(topLink.getAttribute("href")).toBe("#swipe-bank-disclaimer");
    expect(topLink.textContent).toContain(RESPONSE.disclaimer.topNote);

    const block = screen.getByTestId("swipe-bank-disclaimer-block");
    expect(block.id).toBe("swipe-bank-disclaimer");
    expect(block.textContent).toContain(RESPONSE.disclaimer.heading);
    for (const p of RESPONSE.disclaimer.paragraphs) {
      expect(block.textContent).toContain(p);
    }
  });

  it("shows a clean empty state for a sub-vertical with no items", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByTestId("swipe-bank-empty-state").length).toBeGreaterThan(0),
    );
    expect(
      screen.getByText(/No Diet\/Weight Loss swipes yet/i),
    ).toBeTruthy();
  });
});
