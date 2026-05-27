import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

import TipsAndTricks from "@/pages/TipsAndTricks";

// Patterns that would indicate a date snuck back under a card title.
// Examples we want to catch:
//   "Jan 5, 2025", "January 5, 2025", "2025-01-05", "01/05/2025", "5 Jan 2025"
const DATE_PATTERNS: RegExp[] = [
  /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*\d{4})?\b/i,
  /\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?(?:\s+\d{4})?\b/i,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
];

const ALL_TIP_TITLES = [
  'Creating Images With Google\'s "Nano Banana"',
  "Making Slight Adjustments To Images With Qwen",
  "Creating Animated GIF's With Grok Imagine",
  "Creating Headlines In Specific Styles",
  "Creating Native Ad Headlines With Anstrex",
];

describe("TipsAndTricks — no date text under video card titles", () => {
  it("renders every tip card with only its title (no date text)", () => {
    render(<TipsAndTricks />);

    for (const title of ALL_TIP_TITLES) {
      const heading = screen.getByRole("heading", { level: 3, name: title });

      // The container that wraps the title within the card.
      const titleContainer = heading.parentElement;
      expect(titleContainer).not.toBeNull();
      const containerText = (titleContainer!.textContent ?? "").trim();

      // The title's container should contain *only* the title — no sibling
      // date line beneath it.
      expect(containerText).toBe(title);

      for (const pattern of DATE_PATTERNS) {
        expect(containerText).not.toMatch(pattern);
      }
    }
  });

  it("does not render any date-shaped text inside the Image Tips or Copywriting Tips sections", () => {
    render(<TipsAndTricks />);

    const imageHeading = screen.getByRole("heading", {
      level: 2,
      name: "Image Tips",
    });
    const copywritingHeading = screen.getByRole("heading", {
      level: 2,
      name: "Copywriting Tips",
    });

    // Each section is the closest <section> ancestor of its heading.
    const imageSection = imageHeading.closest("section");
    const copywritingSection = copywritingHeading.closest("section");
    expect(imageSection).not.toBeNull();
    expect(copywritingSection).not.toBeNull();

    for (const section of [imageSection!, copywritingSection!]) {
      // Sanity: at least one tip card heading is in this section.
      const cardHeadings = within(section).getAllByRole("heading", { level: 3 });
      expect(cardHeadings.length).toBeGreaterThan(0);

      const sectionText = section.textContent ?? "";
      for (const pattern of DATE_PATTERNS) {
        expect(sectionText).not.toMatch(pattern);
      }
    }
  });
});
