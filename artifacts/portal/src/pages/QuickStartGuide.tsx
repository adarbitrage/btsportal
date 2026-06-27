import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useBrand } from "@/hooks/use-brand";
import {
  Rocket, Hammer, TestTubes, TrendingUp, Headphones,
  ArrowRight, ChevronUp, Search, BarChart3, Palette,
  LayoutGrid, MonitorPlay, Split, LineChart, Megaphone,
  Mail, Users, MessageSquare, Target, CheckCircle2
} from "lucide-react";
import { useRef } from "react";

function BackToTop({ topRef }: { topRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <button
      onClick={() => topRef.current?.scrollIntoView({ behavior: "smooth" })}
      className="flex items-center gap-1 text-sm text-[#1a56db] hover:underline font-medium mt-4"
    >
      <ChevronUp className="w-4 h-4" />
      Back to Top
    </button>
  );
}

export default function QuickStartGuide() {
  const topRef = useRef<HTMLDivElement>(null);
  const brand = useBrand();

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8" ref={topRef}>

        <div className="bg-[#1a56db] rounded-2xl p-8 md:p-10 text-white shadow-lg">
          <h1 className="text-3xl md:text-4xl font-bold font-['Roboto'] tracking-tight mb-2">
            The {brand.short} Quick-Start Guide
          </h1>
          <p className="text-lg md:text-xl opacity-90">
            Mastering Affiliate Arbitrage with the Build, Test, Scale Framework
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-5">
            <p className="text-muted-foreground leading-relaxed">
              Congratulations on taking the first step toward building a profitable affiliate
              arbitrage business using direct media buying. This <strong className="text-foreground">Quick-Start Guide</strong> is
              your <strong className="text-foreground">step-by-step roadmap</strong> through
              the <strong className="text-foreground">{brand.short} framework</strong> — guiding you from your first
              campaign setup to full-scale profitability.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Inside, you'll find detailed strategies, key resources, and exclusive tools designed to
              accelerate your success. You'll also discover how to leverage the power of
              the <Link href="/community" className="text-[#1a56db] underline hover:no-underline">BTS Community</Link>,
              the BTS Concierge™,
              the Responsive Rolodex™,
              and <Link href="/coaching" className="text-[#1a56db] underline hover:no-underline">live coaching calls</Link> to
              remove the guesswork and scale with confidence.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              This isn't just theory — it's a proven system built on <strong className="text-foreground">25+ years
              and $75M in ad spend</strong> that has generated millions in affiliate commissions. Let's dive in.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center">
                <Rocket className="w-5 h-5 text-[#1a56db]" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Quick-Start Guide Table of Contents</h2>
            </div>
            <div className="space-y-4">
              <div>
                <a href="#framework" className="text-[#1a56db] font-semibold hover:underline">Understanding the Build, Test, Scale Framework</a>
              </div>
              <div>
                <a href="#step-build" className="text-[#1a56db] font-semibold hover:underline">Step 1: Build — Setting Up for Success</a>
                <ul className="mt-2 ml-5 space-y-1 text-sm text-muted-foreground list-disc">
                  <li>Choosing the Right Affiliate Offer</li>
                  <li>Conducting Market Research for Winning Angles</li>
                  <li>Organizing Your Workflow</li>
                  <li>Building Banner Ads & Landing Pages with {brand.short} Tools</li>
                  <li>Submitting Your Ads for Approval</li>
                </ul>
              </div>
              <div>
                <a href="#step-test" className="text-[#1a56db] font-semibold hover:underline">Step 2: Test — Launching Your First Campaigns</a>
                <ul className="mt-2 ml-5 space-y-1 text-sm text-muted-foreground list-disc">
                  <li>Using the Responsive Rolodex™ for Proven Traffic</li>
                  <li>Split-Testing Banners within DIYTrax™</li>
                  <li>Tracking Performance in the P&L Tracker™</li>
                  <li>Refining Your Offer & Ad Angles</li>
                </ul>
              </div>
              <div>
                <a href="#step-scale" className="text-[#1a56db] font-semibold hover:underline">Step 3: Scale — Turning Profitable Campaigns into a Full Business</a>
                <ul className="mt-2 ml-5 space-y-1 text-sm text-muted-foreground list-disc">
                  <li>Increasing Ad Spend on Winning Placements</li>
                  <li>Testing Additional Rolodex Placements</li>
                  <li>Expanding to Dedicated Emails</li>
                </ul>
              </div>
              <div>
                <a href="#support" className="text-[#1a56db] font-semibold hover:underline">{brand.short} Support & Resources</a>
                <ul className="mt-2 ml-5 space-y-1 text-sm text-muted-foreground list-disc">
                  <li>The BTS Concierge™ — Done-For-You Ad Creation & Setup</li>
                  <li>Live Coaching Calls — Expert Guidance 6 Days/Week</li>
                  <li>The BTS Community — 24/7 Access to Mentors & Peers</li>
                </ul>
              </div>
              <div>
                <a href="#final-steps" className="text-[#1a56db] font-semibold hover:underline">Final Steps — Your Personalized Success Plan</a>
              </div>
            </div>
          </CardContent>
        </Card>

        <div id="framework" className="scroll-mt-6">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-8 md:p-10 space-y-5">
              <h2 className="text-2xl font-bold text-foreground">Understanding the Build, Test, Scale Framework</h2>
              <p className="text-muted-foreground leading-relaxed">
                Affiliate arbitrage is simple when you follow the right steps in order.
                Our proven process follows three key phases:
              </p>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Hammer className="w-5 h-5 text-[#1a56db]" />
                    <h3 className="font-bold text-foreground">Build</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Select your offer, conduct research, and create high-converting ads and landing pages.</p>
                </div>
                <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <TestTubes className="w-5 h-5 text-[#1a56db]" />
                    <h3 className="font-bold text-foreground">Test</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Launch ads on pre-vetted publisher traffic inside the Responsive Rolodex™ while split-testing creative.</p>
                </div>
                <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-[#1a56db]" />
                    <h3 className="font-bold text-foreground">Scale</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">Once profitable, increase ad spend and expand to dedicated emails or new direct buys.</p>
                </div>
              </div>
              <div className="bg-[#1a56db]/5 border border-[#1a56db]/20 rounded-xl p-4">
                <p className="text-sm text-foreground font-medium">
                  This system ensures that you don't waste money on bad traffic or ineffective creatives —
                  instead, you systematically refine what works and scale only when profitable.
                </p>
              </div>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </div>

        <div id="step-build" className="scroll-mt-6">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-8 md:p-10 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center">
                  <Hammer className="w-5 h-5 text-[#1a56db]" />
                </div>
                <h2 className="text-2xl font-bold text-foreground">Step 1: Build — Setting Up for Success</h2>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Target className="w-4 h-4 text-[#1a56db]" />
                  Choosing the Right Affiliate Offer
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  The best way to start is with a high-converting affiliate offer. We recommend networks
                  like <strong className="text-foreground">Media Mavens™</strong> (exclusive to {brand.short} members — 100%+ commissions)
                  and <strong className="text-foreground">ClickBank</strong> (fast approval and high-payout offers).
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  To get started, apply for these networks and choose a proven offer that aligns with {brand.short} traffic sources.
                  If you need help choosing, ask in
                  our <Link href="/coaching" className="text-[#1a56db] underline hover:no-underline">weekly coaching calls</Link> or
                  consult the BTS Concierge™.
                </p>
              </div>

              <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Search className="w-4 h-4 text-[#1a56db]" />
                  Conducting Market Research for Winning Angles
                </h3>
                <p className="text-muted-foreground leading-relaxed">Once you have an offer, you need a unique angle that speaks to the audience:</p>
                <ul className="space-y-2 text-muted-foreground ml-1">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" />
                    <span>Use spy tools like Anstrex, AdPlexity, and AdBeat to see what ads are running.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" />
                    <span>Analyze Amazon Reviews of similar products to uncover emotional pain points.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" />
                    <span>Use AI for brainstorming new hooks and creative approaches.</span>
                  </li>
                </ul>
              </div>

              <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <LayoutGrid className="w-4 h-4 text-[#1a56db]" />
                  Organizing Your Workflow
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  Success requires structure. We recommend using Google Drive to organize your offers,
                  ad creatives, landing page variations, and performance tracking.
                </p>
              </div>

              <div className="border-t border-[#e8e4dc] pt-5 space-y-3">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Palette className="w-4 h-4 text-[#1a56db]" />
                  Building Banner Ads & Landing Pages with {brand.short} Tools
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  Use {brand.short} proprietary tools to build your ads efficiently:
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {[
                    { name: "ScrapeBot™ & CropBot™", desc: "Find & crop high-quality ad images" },
                    { name: "Gifster™", desc: "Create animated banner & landing page images" },
                    { name: "PixelPress™", desc: "Generate hundreds of banners in minutes" },
                    { name: "Flexy™", desc: "Drag-and-drop landing page builder" },
                    { name: "DIYTrax™", desc: "Central hub for campaign tracking" },
                  ].map((tool) => (
                    <div key={tool.name} className="bg-[#faf9f7] border border-[#e8e4dc] rounded-lg p-3">
                      <p className="font-semibold text-sm text-foreground">{tool.name}</p>
                      <p className="text-xs text-muted-foreground">{tool.desc}</p>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground italic">
                  Need help building creatives? The BTS Concierge™ can do it for you!
                </p>
              </div>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </div>

        <div id="step-test" className="scroll-mt-6">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-8 md:p-10 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center">
                  <TestTubes className="w-5 h-5 text-[#1a56db]" />
                </div>
                <h2 className="text-2xl font-bold text-foreground">Step 2: Test — Launching Your First Campaigns</h2>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <MonitorPlay className="w-4 h-4 text-[#1a56db]" />
                  Using the Responsive Rolodex™ for Proven Traffic
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  Instead of guessing where to buy ads, start with pre-vetted, high-converting publishers inside
                  the <strong className="text-foreground">Responsive Rolodex™</strong>. Simply select a Responsive
                  Rolodex™ placement from within DIYTrax™ and launch your first test.
                </p>
              </div>

              <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Split className="w-4 h-4 text-[#1a56db]" />
                  Split-Testing Banners Within DIYTrax™
                </h3>
                <ul className="space-y-2 text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" />
                    <span>Upload multiple banner ads and let DIYTrax™ automatically split-test them.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" />
                    <span>Optimize by pausing underperformers and increasing spend on top performers.</span>
                  </li>
                </ul>
              </div>

              <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <LineChart className="w-4 h-4 text-[#1a56db]" />
                  Tracking Performance in the P&L Tracker™
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  "If you can't track it, you can't manage it." Use the <strong className="text-foreground">P&L
                  Tracker™</strong> to record ad spend, revenue, and ROI.
                </p>
              </div>

              <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#1a56db]" />
                  Refining Your Offer & Ad Angles
                </h3>
                <p className="text-muted-foreground leading-relaxed">Test different:</p>
                <ul className="space-y-2 text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" />
                    <span>Hooks for your banner ads</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" />
                    <span>Headlines and images in PixelPress™</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" />
                    <span>Offers from different affiliate networks</span>
                  </li>
                </ul>
              </div>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </div>

        <div id="step-scale" className="scroll-mt-6">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-8 md:p-10 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-[#1a56db]" />
                </div>
                <h2 className="text-2xl font-bold text-foreground">Step 3: Scale — Turning Profitable Campaigns into a Full Business</h2>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-[#1a56db]" />
                  Increasing Ad Spend on Winning Placements
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  Once a campaign is profitable, increase your daily budget on high-performing placements inside
                  the <strong className="text-foreground">Responsive Rolodex™</strong>.
                </p>
              </div>

              <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <MonitorPlay className="w-4 h-4 text-[#1a56db]" />
                  Testing Additional Rolodex Placements
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  After you've found success with your initial placements, expand your reach by testing other
                  placements within the Responsive Rolodex™. Each placement represents a unique audience with
                  profit potential. Take your winning creative and systematically test it across multiple
                  Rolodex placements to maximize your campaign's reach and profitability.
                </p>
              </div>

              <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Mail className="w-4 h-4 text-[#1a56db]" />
                  Expanding to Dedicated Emails
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  Dedicated emails are the next step after sponsorships. Resize your best-performing ads and run
                  dedicated placements in the Responsive Rolodex™ for bigger returns.
                </p>
              </div>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </div>

        <div id="support" className="scroll-mt-6">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-8 md:p-10 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center">
                  <Headphones className="w-5 h-5 text-[#1a56db]" />
                </div>
                <h2 className="text-2xl font-bold text-foreground">{brand.short} Support & Resources</h2>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-5 space-y-3">
                  <Palette className="w-8 h-8 text-[#1a56db]" />
                  <h3 className="font-bold text-foreground">The BTS Concierge™</h3>
                  <p className="text-sm text-muted-foreground">
                    Done-for-you ad creation & setup. Our team handles the technical work while you focus on strategy.
                  </p>
                </div>
                <Link href="/coaching">
                  <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-5 space-y-3 hover:border-[#1a56db]/30 transition-colors cursor-pointer h-full">
                    <MessageSquare className="w-8 h-8 text-[#1a56db]" />
                    <h3 className="font-bold text-foreground">Live Coaching Calls</h3>
                    <p className="text-sm text-muted-foreground">
                      Get expert guidance 6 days/week. Get your questions answered directly by experienced mentors.
                    </p>
                  </div>
                </Link>
                <Link href="/community">
                  <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-5 space-y-3 hover:border-[#1a56db]/30 transition-colors cursor-pointer h-full">
                    <Users className="w-8 h-8 text-[#1a56db]" />
                    <h3 className="font-bold text-foreground">The BTS Community</h3>
                    <p className="text-sm text-muted-foreground">
                      24/7 access to mentors & peers. Share wins, get feedback, and learn from others on the same journey.
                    </p>
                  </div>
                </Link>
              </div>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </div>

        <div id="final-steps" className="scroll-mt-6">
          <Card className="border-[#1a56db]/20 shadow-sm bg-[#1a56db]/5">
            <CardContent className="p-8 md:p-10 space-y-6">
              <h2 className="text-2xl font-bold text-foreground text-center">Final Steps — Your Personalized Success Plan</h2>
              <p className="text-muted-foreground text-center leading-relaxed">
                You now have <strong className="text-foreground">everything you need to succeed</strong>. Here are your next steps:
              </p>
              <div className="space-y-3 max-w-lg mx-auto">
                <div className="flex items-center gap-3 bg-white rounded-xl border border-[#e8e4dc] p-4">
                  <div className="w-8 h-8 rounded-full bg-[#1a56db] text-white flex items-center justify-center font-bold text-sm shrink-0">1</div>
                  <p className="text-sm text-foreground font-medium">Launch your first test campaign using the Responsive Rolodex™</p>
                </div>
                <div className="flex items-center gap-3 bg-white rounded-xl border border-[#e8e4dc] p-4">
                  <div className="w-8 h-8 rounded-full bg-[#1a56db] text-white flex items-center justify-center font-bold text-sm shrink-0">2</div>
                  <Link href="/coaching" className="text-sm text-foreground font-medium hover:text-[#1a56db]">
                    Join the next live coaching call
                  </Link>
                </div>
                <div className="flex items-center gap-3 bg-white rounded-xl border border-[#e8e4dc] p-4">
                  <div className="w-8 h-8 rounded-full bg-[#1a56db] text-white flex items-center justify-center font-bold text-sm shrink-0">3</div>
                  <Link href="/community" className="text-sm text-foreground font-medium hover:text-[#1a56db]">
                    Engage with the BTS Community for support
                  </Link>
                </div>
              </div>
              <p className="text-center text-lg font-bold text-foreground pt-2">
                The path is clear — now take action!
              </p>
              <div className="flex justify-center gap-3 flex-wrap">
                <Link href="/training">
                  <Button className="bg-[#2d8a4e] hover:bg-[#24713f] text-white font-semibold px-6">
                    <ArrowRight className="w-4 h-4 mr-2" />
                    Start Training
                  </Button>
                </Link>
                <Link href="/coaching">
                  <Button variant="outline" className="border-[#1a56db] text-[#1a56db] hover:bg-[#1a56db]/5 font-semibold px-6">
                    <Headphones className="w-4 h-4 mr-2" />
                    Join a Coaching Call
                  </Button>
                </Link>
              </div>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
