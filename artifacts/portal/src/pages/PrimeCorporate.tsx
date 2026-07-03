import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Building2, Shield,
  DollarSign, TrendingUp, FileText, CreditCard,
} from "lucide-react";

const reveals = [
  { icon: Shield, text: "The exact entity structure that protects your assets AND saves you thousands" },
  { icon: FileText, text: "How to write off your entire Build Test Scale™ investment (yes, really)" },
  { icon: DollarSign, text: "The 250+ deductions affiliate marketers miss every single year" },
  { icon: CreditCard, text: "How to build business credit without touching your personal score" },
  { icon: TrendingUp, text: "Why some affiliates pay 40% in taxes while others pay 15%" },
];

const stats = [
  { value: "170,000+", label: "Businesses Formed" },
  { value: "$60M", label: "Business Credit Accessed" },
  { value: "$8K–$15K", label: "Saved Annually Per Entrepreneur" },
  { value: "100,000+", label: "Business Tax Returns Filed" },
];

export default function PrimeCorporate() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Prime Corporate Services</h1>
          </div>
          <p className="text-muted-foreground">
            Your business empire starts here — entity formation, business credit, and
            tax strategy through our partnership with Prime Corporate Services.
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-4">
            <p className="text-muted-foreground leading-relaxed">
              There's a secret the top 1% of affiliate marketers know…
            </p>
            <p className="text-muted-foreground leading-relaxed">
              And it has nothing to do with traffic sources, conversion rates, or scaling strategies.
            </p>
            <p className="font-medium text-foreground leading-relaxed">
              It's this… They treat their business like a BUSINESS.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Not a hobby. Not a side hustle. Not a "let's see what happens" experiment.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              And that's exactly why we partnered with{" "}
              <strong className="text-foreground">Prime Corporate Services</strong> — to
              give you the same unfair advantage.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map((s) => (
            <Card key={s.label} className="border-border/60 shadow-sm">
              <CardContent className="p-4 text-center">
                <p className="text-xl md:text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-5">
            <h2 className="text-xl font-bold text-foreground">
              Your FREE 45-Minute Strategy Session Reveals:
            </h2>
            <div className="space-y-3">
              {reveals.map((r) => {
                const Icon = r.icon;
                return (
                  <div key={r.text} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg border border-emerald-200 bg-emerald-50 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon className="w-4 h-4 text-emerald-700" />
                    </div>
                    <p className="text-sm text-foreground/85 pt-1">{r.text}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-4 text-center">
            <p className="text-muted-foreground leading-relaxed">
              This isn't just another bonus. This is your bridge from amateur to empire
              builder. From hustler to CEO. From hoping to knowing.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Prime's team has filed 100,000+ business tax returns. They've seen every
              mistake, every opportunity, every loophole — and now they're ready to hand
              you the blueprint.
            </p>
            <div className="pt-2">
              <Button asChild size="lg" className="text-base">
                <a
                  href="https://primepartner.info/BuildTestScale"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Book Your Free Empire-Building Session
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
