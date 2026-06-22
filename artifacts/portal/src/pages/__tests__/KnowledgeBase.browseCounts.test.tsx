import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

// Guards the Knowledge Base browse landing's per-category article-count cards.
// Each "Browse by category" card shows "N article(s)" sourced from the
// /api/kb/counts endpoint (passed in as the `counts` prop). A regression could
// drop the count line, mis-pluralize it, or crash when counts are still
// loading (null). These tests pin that behaviour.

// BrowseLanding renders wouter <Link> for result items; stub it so we don't
// need a Router context.
vi.mock("wouter", () => ({
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { BrowseLanding } from "@/pages/KnowledgeBase";

const CATEGORY_LABELS: Record<string, string> = {
  blitz: "Blitz Guide",
  resource: "Resource Library",
  glossary: "Glossary",
  tools: "Apps & Tools",
  faq: "FAQ",
  curriculum: "Training",
  coaching: "Coaching",
};

const DEFAULT_BROWSE_PROPS = {
  bookmarks: [] as Parameters<typeof BrowseLanding>[0]["bookmarks"],
  bookmarkedIds: new Set<number>(),
  onToggleBookmark: vi.fn(),
};

function cardFor(label: string): HTMLElement {
  const heading = screen.getByText(label);
  const button = heading.closest("button");
  if (!button) throw new Error(`No category card button found for "${label}"`);
  return button;
}

describe("BrowseLanding category counts", () => {
  it("renders 'N articles' beneath each category from the counts map", () => {
    const counts = {
      blitz: 12,
      resource: 5,
      glossary: 7,
      tools: 3,
      faq: 9,
      curriculum: 4,
      coaching: 2,
    };
    render(<BrowseLanding onSelectCategory={vi.fn()} counts={counts} {...DEFAULT_BROWSE_PROPS} />);

    for (const [cat, n] of Object.entries(counts)) {
      const card = cardFor(CATEGORY_LABELS[cat]);
      expect(within(card).getByText(`${n} articles`)).toBeInTheDocument();
    }
  });

  it("uses the singular 'article' for a count of exactly one", () => {
    const counts = { blitz: 1, resource: 0, glossary: 0, tools: 0, faq: 0, curriculum: 0, coaching: 0 };
    render(<BrowseLanding onSelectCategory={vi.fn()} counts={counts} {...DEFAULT_BROWSE_PROPS} />);

    const blitzCard = cardFor(CATEGORY_LABELS.blitz);
    expect(within(blitzCard).getByText("1 article")).toBeInTheDocument();

    const resourceCard = cardFor(CATEGORY_LABELS.resource);
    expect(within(resourceCard).getByText("0 articles")).toBeInTheDocument();
  });

  it("renders a zero count for categories absent from the counts map", () => {
    const counts = { blitz: 8 };
    render(<BrowseLanding onSelectCategory={vi.fn()} counts={counts} {...DEFAULT_BROWSE_PROPS} />);

    expect(within(cardFor(CATEGORY_LABELS.blitz)).getByText("8 articles")).toBeInTheDocument();
    expect(within(cardFor(CATEGORY_LABELS.faq)).getByText("0 articles")).toBeInTheDocument();
  });

  it("degrades gracefully when counts are absent (null), omitting the count line", () => {
    render(<BrowseLanding onSelectCategory={vi.fn()} counts={null} {...DEFAULT_BROWSE_PROPS} />);

    expect(cardFor(CATEGORY_LABELS.blitz)).toBeInTheDocument();
    expect(screen.queryByText(/\d+ articles?/)).not.toBeInTheDocument();
  });
});
