import { Link } from "wouter";

// Browsewrap footer — mirrors the buildtestscale.com marketing-site footer:
// full legal link row, Contact Us, the copyright line, and the disclaimer
// paragraphs. The platform Terms of Service stays reachable here without
// requiring a signature (Task #1625 removed the onboarding signing gate).

const FOOTER_LINKS: { label: string; href: string }[] = [
  { label: "Privacy Policy", href: "/legal/privacy" },
  { label: "Terms of Use", href: "/legal/terms" },
  { label: "Earnings Disclaimer", href: "/legal/earnings-disclaimer" },
  { label: "Affiliate Disclaimer", href: "/legal/affiliate-disclaimer" },
  { label: "DMCA Policy", href: "/legal/dmca" },
  { label: "Accessibility", href: "/legal/accessibility" },
  { label: "SMS Terms", href: "/legal/sms-terms" },
  { label: "Refund Policy", href: "/legal/refund-policy" },
  { label: "Contact Us", href: "/legal/contact" },
];

export function Footer() {
  return (
    <footer className="border-t border-border mt-8 py-6 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-4">
        <nav
          aria-label="Legal"
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2"
        >
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-xs text-muted-foreground hover:text-foreground underline"
              data-testid={`footer-link-${link.href.split("/").pop()}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <p className="text-xs text-muted-foreground text-center">
          Copyright 2025 Build. Test. Scale., LLC dba Build, Test, Scale™
        </p>

        <div className="space-y-2 text-[11px] leading-relaxed text-muted-foreground/80 text-left">
          <p>
            <span className="font-semibold underline">✳DISCLAIMER</span>: We are
            committed to transparency and integrity. Please understand that
            building a successful business takes time, effort, and dedication.
            We do not promote "get rich quick" schemes. The results you achieve
            will depend on your own background, dedication, desire, and
            motivation.
          </p>
          <p>
            There is <span className="font-semibold underline">NO GUARANTEE</span>{" "}
            and <span className="font-semibold underline">NO WARRANTY</span> that
            employing the same techniques, ideas, strategies, products or
            services that are detailed on buildtestscale.com will produce the
            same results for you and/or your web properties. Historical
            performance is not indicative of future results. Examples that may
            be provided in articles, videos and other sources on the site are
            just that – examples. They may or may not work for your specific
            situation and are not to be interpreted as a guarantee or promise of
            earnings.
          </p>
          <p>
            The materials provided on buildtestscale.com are not to be
            interpreted as a "get rich quick" scheme in any way. Your earning
            potential is entirely dependent upon you, and the then current state
            of web marketing at the time you employ such techniques and ideas.{" "}
            <span className="font-semibold">
              THE LEVEL OF SUCCESS YOU REACH EMPLOYING THESE TECHNIQUES AND IDEAS
              IS ENTIRELY DEPENDENT UPON YOUR SKILLS, FINANCIAL RESOURCES,
              MARKETING KNOWLEDGE AND TIME YOU DEVOTE TO BECOMING AN ONLINE
              SUCCESS. BECAUSE OF THIS, WE CANNOT GUARANTEE YOUR EARNINGS LEVEL
              NOR DO WE IN ANY WAY WHETHER DIRECTLY OR INDIRECTLY DO SO.
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
}
