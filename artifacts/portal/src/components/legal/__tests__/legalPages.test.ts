import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseLegalBody } from "../LegalDocument";
import { privacyPolicyTitle, privacyPolicyBody } from "@/content/legal/privacy-policy";
import { termsOfServiceTitle, termsOfServiceBody } from "@/content/legal/terms-of-service";
import { earningsDisclaimerTitle, earningsDisclaimerBody } from "@/content/legal/earnings-disclaimer";
import { affiliateDisclaimerTitle, affiliateDisclaimerBody } from "@/content/legal/affiliate-disclaimer";
import { dmcaPolicyTitle, dmcaPolicyBody } from "@/content/legal/dmca-policy";
import { accessibilityTitle, accessibilityBody } from "@/content/legal/accessibility";
import { smsTermsTitle, smsTermsBody } from "@/content/legal/sms-terms";
import { refundPolicyBody } from "@/content/legal/refund-policy";

const docs: [string, string, string][] = [
  ["privacy", privacyPolicyTitle, privacyPolicyBody],
  ["terms", termsOfServiceTitle, termsOfServiceBody],
  ["earnings", earningsDisclaimerTitle, earningsDisclaimerBody],
  ["affiliate", affiliateDisclaimerTitle, affiliateDisclaimerBody],
  ["dmca", dmcaPolicyTitle, dmcaPolicyBody],
  ["accessibility", accessibilityTitle, accessibilityBody],
  ["sms", smsTermsTitle, smsTermsBody],
  ["refund", "Refund Policy", refundPolicyBody],
];

describe("legal page copy preservation", () => {
  it.each(docs)("%s: every non-blank source line survives parsing", (_name, title, body) => {
    const { subtitle, meta, blocks } = parseLegalBody(body, title);
    const rendered = new Set([
      ...subtitle,
      ...meta,
      ...blocks.map((b) => b.text),
      title.toUpperCase(), // the H1 replaces an all-caps banner line equal to the title
    ]);
    const sourceLines = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    const missing = sourceLines.filter(
      (l) => !rendered.has(l) && l.toUpperCase() !== title.toUpperCase(),
    );
    expect(missing).toEqual([]);
  });

  it.each(docs)(
    "%s: body does not embed the marketing footer block (shared Footer renders it)",
    (_name, _title, body) => {
      expect(body).not.toContain("Copyright 2025 Build. Test. Scale.");
      expect(body).not.toContain("We are committed to transparency and integrity");
    },
  );

  it("terms of service is the new Oct 1, 2025 copy", () => {
    expect(termsOfServiceBody).toContain("Effective Date: October 1, 2025");
    expect(termsOfServiceBody).toContain("1. ACCEPTANCE AND MODIFICATION OF TERMS");
  });
});

describe("footer links have real SPA routes", () => {
  const appSrc = fs.readFileSync(
    path.resolve(__dirname, "../../../App.tsx"),
    "utf8",
  );
  const footerSrc = fs.readFileSync(
    path.resolve(__dirname, "../../layout/Footer.tsx"),
    "utf8",
  );
  const hrefs = [...footerSrc.matchAll(/href:\s*"(\/legal\/[a-z-]+)"/g)].map(
    (m) => m[1],
  );

  it("footer renders all nine legal/contact links", () => {
    expect(hrefs).toHaveLength(9);
  });

  it.each([
    "/legal/privacy",
    "/legal/terms",
    "/legal/earnings-disclaimer",
    "/legal/affiliate-disclaimer",
    "/legal/dmca",
    "/legal/accessibility",
    "/legal/sms-terms",
    "/legal/refund-policy",
    "/legal/contact",
  ])("route registered for %s", (href) => {
    expect(hrefs).toContain(href);
    expect(appSrc).toContain(`<Route path="${href}">`);
  });
});
