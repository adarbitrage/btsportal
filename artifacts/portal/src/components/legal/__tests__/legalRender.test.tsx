import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/layout/AppLayout", async () => {
  const { Footer } = await import("@/components/layout/Footer");
  // Minimal AppLayout stand-in that, like the real one, renders the shared
  // Footer beneath the page content.
  return {
    AppLayout: ({ children }: { children: React.ReactNode }) => (
      <div>
        {children}
        <Footer />
      </div>
    ),
  };
});

import { LegalDocument } from "../LegalDocument";
import { Footer } from "@/components/layout/Footer";
import { privacyPolicyTitle, privacyPolicyBody } from "@/content/legal/privacy-policy";

describe("Footer", () => {
  it("renders all nine legal links, the copyright line, and the disclaimer once", () => {
    render(<Footer />);
    for (const label of [
      "Privacy Policy",
      "Terms of Use",
      "Earnings Disclaimer",
      "Affiliate Disclaimer",
      "DMCA Policy",
      "Accessibility",
      "SMS Terms",
      "Refund Policy",
      "Contact Us",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    const text = document.body.textContent ?? "";
    expect(
      text.match(/Copyright 2025 Build\. Test\. Scale\., LLC dba Build, Test, Scale™/g),
    ).toHaveLength(1);
    expect(text.match(/✳DISCLAIMER/g)).toHaveLength(1);
  });
});

describe("legal pages render the marketing footer exactly once", () => {
  it("privacy policy body no longer embeds the footer copy duplicated by the shared Footer", () => {
    render(<LegalDocument title={privacyPolicyTitle} body={privacyPolicyBody} />);
    const text = document.body.textContent ?? "";
    // Page renders (title + first/last sections present)...
    expect(screen.getByTestId("legal-page-title")).toHaveTextContent("Privacy Policy");
    expect(text).toContain("1. INTRODUCTION AND SCOPE");
    // ...and the footer block appears only once (from the shared Footer).
    expect(
      text.match(/Copyright 2025 Build\. Test\. Scale\., LLC dba Build, Test, Scale™/g),
    ).toHaveLength(1);
    expect(text.match(/✳DISCLAIMER/g)).toHaveLength(1);
    expect(text.match(/We are committed to transparency and integrity/g)).toHaveLength(1);
  });
});
