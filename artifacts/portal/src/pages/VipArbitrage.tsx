import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import {
  Gem, ShieldAlert, BadgeCheck, FileText, Scale, Landmark,
} from "lucide-react";

const highlights = [
  {
    icon: Landmark,
    title: "A Private Placement Offering",
    text: "VIP Arbitrage is a private securities offering conducted under Rule 506(c) of Regulation D. It is entirely separate from your BTS membership, training, and software products.",
  },
  {
    icon: BadgeCheck,
    title: "Accredited Investors Only",
    text: "Participation is limited to verified accredited investors. Federal law requires us to take reasonable steps to verify your accredited status before you can invest.",
  },
  {
    icon: FileText,
    title: "Offering Documents Govern",
    text: "Complete terms, strategy details, fees, and risk factors are provided exclusively in the official offering documents (private placement memorandum and subscription agreement).",
  },
  {
    icon: Scale,
    title: "No Obligation",
    text: "Requesting information does not commit you to anything. Review the materials with your own legal, tax, and financial advisers before making any decision.",
  },
];

const accreditationExamples = [
  "Individual income over $200,000 (or $300,000 jointly with a spouse or spousal equivalent) in each of the two most recent years, with a reasonable expectation of the same this year",
  "Net worth over $1 million, alone or with a spouse or spousal equivalent, excluding the value of your primary residence",
  "Certain professional certifications, designations, or credentials recognized by the SEC (such as Series 7, 65, or 82 licenses)",
  "Certain entities, trusts, and family offices meeting SEC asset or ownership requirements",
];

export default function VipArbitrage() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl" data-testid="page-vip-arbitrage">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Gem className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold" data-testid="text-vip-arbitrage-title">VIP Arbitrage</h1>
          </div>
          <p className="text-muted-foreground">
            A private investment opportunity for verified accredited investors,
            offered under Rule 506(c) of Regulation D.
          </p>
        </div>

        <Card className="border-amber-300/70 bg-amber-50/60 shadow-sm" data-testid="card-vip-arbitrage-disclaimer">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg border border-amber-300 bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                <ShieldAlert className="w-5 h-5 text-amber-700" />
              </div>
              <div className="space-y-2">
                <h2 className="font-semibold text-foreground">Important Disclosures</h2>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  This page is a general announcement made in reliance on Rule 506(c) of
                  Regulation D under the Securities Act of 1933. It is not an offer to sell,
                  or a solicitation of an offer to buy, any security. Any offer or sale will
                  be made only to verified accredited investors and only through official
                  offering documents, which describe the investment strategy, fees, conflicts
                  of interest, and risk factors in full.
                </p>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  Investing in private securities involves a high degree of risk, including
                  possible loss of your entire investment. These securities are illiquid, are
                  not registered with the SEC or any state securities regulator, and no
                  regulator has approved or passed upon the merits of this offering. Past
                  performance does not guarantee future results, and no returns are promised
                  or guaranteed.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-4">
            <h2 className="text-xl font-bold text-foreground">What Is VIP Arbitrage?</h2>
            <p className="text-muted-foreground leading-relaxed">
              VIP Arbitrage is a private placement offering available to a limited group of
              verified accredited investors within the BTS community. It is designed for
              members who want exposure to an arbitrage-oriented investment strategy managed
              by the offering's sponsor, as described in the offering documents.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Because this is a securities offering — not a course, membership tier, or
              software product — everything about it is governed by securities law. That
              means eligibility is restricted, communications are carefully reviewed, and
              the only authoritative description of the opportunity is found in the official
              offering documents you receive after your accredited status is verified.
            </p>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-4">
          {highlights.map((h) => {
            const Icon = h.icon;
            return (
              <Card key={h.title} className="border-border/60 shadow-sm">
                <CardContent className="p-6 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg border border-emerald-200 bg-emerald-50 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-emerald-700" />
                    </div>
                    <h3 className="font-semibold text-foreground">{h.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{h.text}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-4">
            <h2 className="text-xl font-bold text-foreground">Who Is an Accredited Investor?</h2>
            <p className="text-muted-foreground leading-relaxed">
              The SEC defines who qualifies as an accredited investor. Common ways
              individuals qualify include:
            </p>
            <ul className="space-y-2">
              {accreditationExamples.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <BadgeCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-1" />
                  <span className="text-sm text-foreground/85">{item}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This summary is provided for convenience only and is not legal advice. Under
              Rule 506(c), your accredited status must be verified through documentation or
              third-party confirmation before you may participate.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-4 text-center" data-testid="card-vip-arbitrage-next-steps">
            <h2 className="text-xl font-bold text-foreground">Interested in Learning More?</h2>
            <p className="text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              If you believe you qualify as an accredited investor and would like to receive
              the official offering documents, reach out to our team through member support
              and mention VIP Arbitrage. We will guide you through accreditation
              verification and provide the full offering materials for your review.
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Securities are offered only through the offering's sponsor as described in the
              offering documents. Nothing on this page constitutes investment, legal, or tax
              advice. Consult your own advisers before investing.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
