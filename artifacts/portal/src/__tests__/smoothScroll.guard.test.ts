import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = path.resolve(__dirname, "..");
const INDEX_CSS = readFileSync(path.resolve(SRC_DIR, "index.css"), "utf8");
const APP_TSX = readFileSync(path.resolve(SRC_DIR, "App.tsx"), "utf8");

describe("global smooth-scroll CSS", () => {
  it("declares scroll-behavior: smooth inside a prefers-reduced-motion: no-preference media query", () => {
    const match = INDEX_CSS.match(
      /@media\s*\(\s*prefers-reduced-motion:\s*no-preference\s*\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(
      match,
      "expected a `@media (prefers-reduced-motion: no-preference)` block in index.css",
    ).not.toBeNull();
    expect(match![1]).toMatch(/scroll-behavior:\s*smooth/);
  });
});

describe("ScrollToTop route reset", () => {
  it("scrolls instantly (behavior: \"instant\") so route changes do not animate", () => {
    const fnStart = APP_TSX.indexOf("function ScrollToTop()");
    expect(fnStart, "expected a ScrollToTop function in App.tsx").toBeGreaterThan(-1);

    const body = APP_TSX.slice(fnStart, fnStart + 400);
    expect(body).toMatch(/window\.scrollTo\(\s*\{[^}]*behavior:\s*["']instant["'][^}]*\}/);
  });
});
