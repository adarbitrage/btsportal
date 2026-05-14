import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Megaphone, DollarSign, CheckCircle2,
  Calendar, Video, ExternalLink, TrendingUp,
  CreditCard, Layers, Clock
} from "lucide-react";

const participationBenefits = [
  "Build hands-on media buying experience you can use beyond BTS",
  "Learn campaign setup, testing and optimization",
  "Reach people who genuinely need the programs",
  "Earn performance-based compensation while promoting offers you believe in",
];

const frontEndProducts = ["IAS", "Phantom Protocol"];

const frontEndDetails = [
  "Fixed at $200 per sale",
  "Not tiered",
  "Not dependent on your mentorship level",
  "Automatically tracked for accuracy",
];

const qualificationTiers = ["3-Month", "6-Month", "12-Month", "Lifetime"];

const gettingStartedLinks = [
  {
    label: "Creating a Google Ad Account",
    url: "https://drive.google.com/file/d/1QLNRlSPWipTw2FY-8EHgRrLZidzxAmEp/view?usp=sharing",
  },
  {
    label: "Creating a Meta Business Manager Account",
    url: "https://www.loom.com/share/04984b100e6b455da482817eec75d3a0?sid=4b8914b2-9d92-48ed-9dad-ba360dbaea16",
  },
];

const urlSetupLinks = [
  {
    label: "Generating URLs for Google Campaigns",
    url: "https://www.loom.com/share/d27bdb97bded4d8381ef2a83ead0caa3?sid=f7fc8632-9597-4a72-85c8-20db05517cf6",
  },
  {
    label: "Generating URLs for Meta Campaigns",
    url: "https://www.loom.com/share/21c42ebae26b471480979c16f0a1d6c4?sid=cda6de3e-820c-4386-833f-551cccc24274",
  },
];

const liveCallBenefits = [
  "Get step-by-step instructions on launching campaigns",
  "Ask questions and receive live feedback",
  "Learn proven strategies from experienced media buyers",
];

export default function SelfPromoting() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Megaphone className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Promote BTS</h1>
          </div>
          <p className="text-muted-foreground">
            Mentorship powered by Meta and Google — your gateway to bigger impact and smarter income.
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5 sm:p-8 md:p-10 space-y-4">
            <p className="text-muted-foreground leading-relaxed">
              Ready to take your mentorship journey further?
            </p>
            <p className="text-muted-foreground leading-relaxed">
              This initiative shows you how to promote <strong className="text-foreground">BTS offers</strong> using <strong className="text-foreground">Meta and Google Ads</strong> — two of the most powerful traffic platforms available — while gaining real, transferable marketing skills along the way.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              This isn't about running ads. It's about execution, ownership, and learning how real campaigns work in the real world.
            </p>
            <div className="mt-2">
              <p className="text-sm font-medium text-foreground mb-2">By participating, you can:</p>
              <div className="space-y-2">
                {participationBenefits.map((b) => (
                  <div key={b} className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                    <p className="text-sm text-muted-foreground">{b}</p>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-sm text-muted-foreground italic">
              Whether your goal is skill-building, additional income, or both — this path allows you to do it simultaneously.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5 sm:p-8 md:p-10">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-lg border border-border/60 bg-muted flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">The Commission Opportunity</h2>
                <p className="text-sm text-muted-foreground">Simple. Clear. Performance-based.</p>
              </div>
            </div>

            <div className="space-y-5">
              <div className="p-5 bg-emerald-50/50 rounded-xl border border-emerald-200/60">
                <div className="flex items-center gap-2 mb-3">
                  <CreditCard className="w-4 h-4 text-emerald-700" />
                  <h3 className="font-bold text-foreground">Front-End Commissions (Immediate CPA)</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Whenever someone you refer purchases a <strong className="text-foreground">front-end product</strong>, you earn a <strong className="text-foreground">flat $200 CPA per sale</strong>.
                </p>
                <p className="text-xs font-medium text-foreground mb-2">Front-end products include:</p>
                <div className="flex gap-2 mb-3">
                  {frontEndProducts.map((p) => (
                    <span key={p} className="px-2.5 py-1 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-md text-xs font-medium">{p}</span>
                  ))}
                </div>
                <p className="text-xs font-medium text-foreground mb-1.5">This payout is:</p>
                <div className="space-y-1">
                  {frontEndDetails.map((d) => (
                    <div key={d} className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <p className="text-xs text-muted-foreground">{d}</p>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground mt-3 font-medium">
                  If a front-end sale is qualified and not refunded, you earn $200 — every time.
                </p>
              </div>

              <div className="p-5 bg-blue-50/50 rounded-xl border border-blue-200/60">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-blue-700" />
                  <h3 className="font-bold text-foreground">Back-End Mentorship Commissions (Longer-Term Opportunity)</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Back-end mentorship sales always pay out <strong className="text-foreground">30% total commission</strong>.
                </p>
                <div className="space-y-2 mb-3">
                  <div className="flex items-start gap-2.5">
                    <span className="px-2 py-0.5 bg-blue-700 text-white rounded text-xs font-bold shrink-0">25%</span>
                    <p className="text-sm text-muted-foreground">Goes to the first affiliate who is <em>qualified</em> for the product sold</p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="px-2 py-0.5 bg-blue-400 text-white rounded text-xs font-bold shrink-0">5%</span>
                    <p className="text-sm text-muted-foreground">Goes to the unqualified seller or qualified upline as an override</p>
                  </div>
                </div>
                <p className="text-xs font-medium text-foreground mb-1.5">Your qualification level is based on the highest mentorship tier you personally own:</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {qualificationTiers.map((t) => (
                    <span key={t} className="px-2.5 py-1 bg-blue-100 text-blue-700 border border-blue-200 rounded-md text-xs font-medium">{t}</span>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  You are qualified to earn the full 25% on the product you own and any lower-tier product. If not qualified, you may still earn 5% while the remaining 25% passes to the first qualified upline.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-bold text-foreground text-sm">Payouts & Tracking</h3>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Commissions are reconciled and paid every <strong className="text-foreground">Monday, Wednesday, and Friday</strong>.</p>
                <p className="text-sm text-muted-foreground">All sales and commissions are fully trackable using your <strong className="text-foreground">CAP account</strong>.</p>
                <Button asChild variant="link" size="sm" className="px-0 h-auto">
                  <a
                    href="https://affiliates.buildtestscale.com/affiliates/login.php#login"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Register / Login to CAP
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-bold text-foreground text-sm">Creatives Provided</h3>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">All <strong className="text-foreground">approved BTS creatives</strong> are ready and provided for you.</p>
                <p className="text-sm text-muted-foreground">Only approved creatives may be used for promoting the BTS mentorship.</p>
                <p className="text-sm text-muted-foreground">Access details will be shared once registration steps are completed.</p>
                <p className="text-xs text-muted-foreground italic mt-1">This ensures brand consistency, compliance, and clean tracking.</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5 sm:p-8 md:p-10">
            <h2 className="text-xl font-bold text-foreground mb-5">Where to Begin</h2>

            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">Getting Started</h3>
                <div className="space-y-2">
                  {gettingStartedLinks.map((l) => (
                    <a
                      key={l.label}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg border border-border/60 hover:border-foreground/30 hover:bg-muted/40 transition-colors group"
                    >
                      <Video className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-foreground">{l.label}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0" />
                    </a>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">URL Set-Up</h3>
                <div className="space-y-2">
                  {urlSetupLinks.map((l) => (
                    <a
                      key={l.label}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg border border-border/60 hover:border-foreground/30 hover:bg-muted/40 transition-colors group"
                    >
                      <Video className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-foreground">{l.label}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5 sm:p-8 md:p-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg border border-border/60 bg-muted flex items-center justify-center">
                <Calendar className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Your Next Step: Join the Live Calls</h2>
                <p className="text-sm text-muted-foreground">Where strategy meets execution.</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Your best move is to attend our <strong className="text-foreground">Media Buyer Specialist's live onboarding and Q&amp;A sessions</strong>.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div className="p-3 bg-muted/40 rounded-lg border border-border/60">
                <p className="text-xs text-muted-foreground">Schedule</p>
                <p className="text-sm font-medium text-foreground">Every Tuesday &amp; Thursday</p>
              </div>
              <div className="p-3 bg-muted/40 rounded-lg border border-border/60">
                <p className="text-xs text-muted-foreground">Time</p>
                <p className="text-sm font-medium text-foreground">7:00–8:00 PM CST</p>
              </div>
            </div>
            <div className="space-y-2 mb-5">
              {liveCallBenefits.map((b) => (
                <div key={b} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground">{b}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a href="https://meet.google.com/xki-vwfi-xia" target="_blank" rel="noopener noreferrer">
                  Join Live Call
                </a>
              </Button>
              <Button asChild>
                <a href="https://drive.google.com/drive/folders/1cvPBSwpkTY2Ah7mYX9ojMVP1jzwH1oBk" target="_blank" rel="noopener noreferrer">
                  View Past Recordings
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
