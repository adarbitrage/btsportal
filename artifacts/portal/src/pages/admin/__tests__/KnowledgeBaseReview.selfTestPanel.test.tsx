import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useSearch: () => "",
  useLocation: () => ["/admin/knowledge-base-review", () => {}],
}));

vi.mock("@/lib/auth", () => ({
  authFetch: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("../KnowledgeBaseDuplicates", () => ({
  default: () => null,
  LiveDocDialog: () => null,
}));

import { SelfTestPanel, type RetrievalSelfTest } from "../KnowledgeBaseReview";

function makeSelfTest(overrides: Partial<RetrievalSelfTest> = {}): RetrievalSelfTest {
  const results = [
    {
      question: "How do I reset my password?",
      passed: true,
      clearsFloor: true,
      topLiveTitle: null,
      topLiveLexRank: 0,
      topLiveSemanticScore: 0,
    },
    {
      question: "Where do I find my commissions?",
      passed: false,
      clearsFloor: false,
      topLiveTitle: "Commissions Overview",
      topLiveLexRank: 0.5,
      topLiveSemanticScore: 0,
    },
  ] as RetrievalSelfTest["results"];
  return {
    ranAt: "2026-07-09T00:00:00.000Z",
    semanticAvailable: true,
    memberQuestions: results.map((r) => r.question),
    results,
    passedCount: 1,
    failedCount: 1,
    ...overrides,
  };
}

describe("SelfTestPanel (Document Review dialog)", () => {
  it("renders collapsed by default so it never consumes the content/chat height", () => {
    render(<SelfTestPanel selfTest={makeSelfTest()} />);

    // Compact one-line summary is visible…
    expect(
      screen.getByText(/Retrieval self-test: 1\/2 member questions find this doc/),
    ).toBeInTheDocument();

    // …but the per-question detail rows are NOT rendered while collapsed.
    expect(screen.queryByText(/How do I reset my password\?/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Where do I find my commissions\?/)).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /Retrieval self-test/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("expands on click to show per-question detail with unchanged guidance text", async () => {
    const user = userEvent.setup();
    render(<SelfTestPanel selfTest={makeSelfTest()} />);

    await user.click(screen.getByRole("button", { name: /Retrieval self-test/ }));

    expect(screen.getByText(/How do I reset my password\?/)).toBeInTheDocument();
    expect(
      screen.getByText(/This draft would surface for this question\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /The draft doesn't match this question's wording — add this vocabulary to the draft\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Best live match: "Commissions Overview"\./)).toBeInTheDocument();

    // Collapses again on a second click.
    await user.click(screen.getByRole("button", { name: /Retrieval self-test/ }));
    expect(screen.queryByText(/How do I reset my password\?/)).not.toBeInTheDocument();
  });

  it("keeps pass/fail coloring: amber when any question fails, green when all pass", () => {
    const { container, unmount } = render(<SelfTestPanel selfTest={makeSelfTest()} />);
    expect(container.querySelector(".bg-amber-50")).not.toBeNull();
    unmount();

    const allPass = makeSelfTest({
      results: [
        {
          question: "How do I reset my password?",
          passed: true,
          clearsFloor: true,
          topLiveTitle: null,
          topLiveLexRank: 0,
          topLiveSemanticScore: 0,
        },
      ] as RetrievalSelfTest["results"],
      passedCount: 1,
      failedCount: 0,
    });
    const { container: c2 } = render(<SelfTestPanel selfTest={allPass} />);
    expect(c2.querySelector(".bg-green-50")).not.toBeNull();
  });
});
