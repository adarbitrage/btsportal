import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Building2, CheckCircle2, ArrowRight, Shield,
  DollarSign, TrendingUp, FileText, CreditCard
} from "lucide-react";

const reveals = [
  { icon: Shield, text: "The exact entity structure that protects your assets AND saves you thousands" },
  { icon: FileText, text: "How to write off your entire Build Test Scale investment (yes, really)" },
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
      <div className="max-w-3xl mx-auto space-y-8">

        <div className="bg-[#1a56db] rounded-2xl p-8 md:p-10 text-white shadow-lg">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold font-['Roboto'] tracking-tight">
                Prime Corporate Services
              </h1>
              <p className="text-lg opacity-90">Your Business Empire Starts Here</p>
            </div>
          </div>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-4">
            <p className="text-muted-foreground leading-relaxed">
              There's a secret the top 1% of affiliate marketers know…
            </p>
            <p className="text-muted-foreground leading-relaxed">
              And it has nothing to do with traffic sources, conversion rates, or scaling strategies.
            </p>
            <p className="text-muted-foreground leading-relaxed font-medium text-foreground">
              It's this… They treat their business like a BUSINESS.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Not a hobby. Not a side hustle. Not a "let's see what happens" experiment.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              And that's exactly why we partnered with <strong className="text-foreground">Prime Corporate Services</strong> — to give you the same unfair advantage.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map((s) => (
            <Card key={s.label} className="border-border/60 shadow-sm">
              <CardContent className="p-4 text-center">
                <p className="text-xl md:text-2xl font-bold text-[#1a56db]">{s.value}</p>
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
              {reveals.map((r) => (
                <div key={r.text} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#2d8a4e]/10 flex items-center justify-center shrink-0 mt-0.5">
                    <r.icon className="w-4 h-4 text-[#2d8a4e]" />
                  </div>
                  <p className="text-sm text-muted-foreground pt-1">{r.text}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm bg-gradient-to-br from-[#1a56db]/5 to-transparent">
          <CardContent className="p-8 md:p-10 space-y-4 text-center">
            <p className="text-muted-foreground leading-relaxed">
              This isn't just another bonus. This is your bridge from amateur to empire builder. From hustler to CEO. From hoping to knowing.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Prime's team has filed 100,000+ business tax returns. They've seen every mistake, every opportunity, every loophole — and now they're ready to hand you the blueprint.
            </p>
            <a
              href="https://www.primecorporateservices.com/buildtestscale/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2"
            >
              <Button size="lg" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-2 text-base">
                <ArrowRight className="w-5 h-5" />
                Book Your Free Empire-Building Session
              </Button>
            </a>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  );
}
