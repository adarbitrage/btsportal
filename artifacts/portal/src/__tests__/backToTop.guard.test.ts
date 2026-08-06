import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = path.resolve(__dirname, "..");
const BUTTON_TSX = readFileSync(
  path.resolve(SRC_DIR, "components/layout/BackToTopButton.tsx"),
  "utf8",
);
const APP_LAYOUT_TSX = readFileSync(
  path.resolve(SRC_DIR, "components/layout/AppLayout.tsx"),
  "utf8",
);

describe("BackToTopButton", () => {
  it("scrolls the window to the top, instant when reduced motion is preferred", () => {
    // Motion-preference check drives the behavior choice.
    expect(BUTTON_TSX).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(BUTTON_TSX).toMatch(
      /window\.scrollTo\(\s*\{[^}]*top:\s*0[^}]*behavior:\s*prefersReducedMotion\s*\?\s*["']instant["']\s*:\s*["']smooth["'][^}]*\}/,
    );
  });

  it("only appears after a meaningful scroll (tracks window scroll position)", () => {
    expect(BUTTON_TSX).toMatch(/addEventListener\(\s*["']scroll["']/);
    expect(BUTTON_TSX).toMatch(/window\.scrollY\s*>\s*SCROLL_THRESHOLD_PX/);
  });

  it("has an accessible label", () => {
    expect(BUTTON_TSX).toMatch(/aria-label=["']Back to top["']/);
  });
});

describe("AppLayout mounts the back-to-top button", () => {
  it("renders BackToTopButton once, raised when the FE call bar is visible", () => {
    expect(APP_LAYOUT_TSX).toMatch(/<BackToTopButton\s+raised=\{showFeCallBar\}\s*\/>/);
    expect(APP_LAYOUT_TSX.match(/<BackToTopButton/g)).toHaveLength(1);
  });
});
