import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Briefcase, ShoppingBag, Users2, Mail, Target, Zap, Heart,
  Route, ArrowRight, ArrowLeft, Sparkles, ChevronUp, Rocket,
} from "lucide-react";
import { useRef, type ComponentType, type SVGProps, type RefObject } from "react";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

type Tint = { iconBg: string; iconBorder: string; iconText: string };

type Bridge = {
  num: number;
  title: string;
  icon: IconType;
  tint: Tint;
  quote: string;
  body: string[];
};

const bridges: Bridge[] = [
  {
    num: 1,
    title: "The Business Model — Affiliate Arbitrage",
    icon: Briefcase,
    tint: { iconBg: "bg-blue-50", iconBorder: "border-blue-200", iconText: "text-blue-700" },
    quote:
      "Spend less on ads than you earn in commissions. Scale that and the numbers get very big, very fast.",
    body: [
      "The Blitz is built around a short Introduction, then three working phases — Build, Test, and Scale. Build is where you set everything up before spending a dollar on ads. Test is where you run small amounts of traffic to find what works. Scale is where you spend more on the combinations that are already proven profitable. The entire sequence exists for one reason — to find a reliable spread between what you spend on ads and what you earn in commissions. That's the arbitrage. The Blitz is the process of finding it systematically rather than by guessing.",
      "You'll notice The Blitz has strict rules about when you're allowed to move from one phase to the next. Those rules exist to protect the math — you don't scale until the arbitrage is proven.",
    ],
  },
  {
    num: 2,
    title: "The Market — Health & Wellness",
    icon: ShoppingBag,
    tint: { iconBg: "bg-emerald-50", iconBorder: "border-emerald-200", iconText: "text-emerald-700" },
    quote:
      "Traditional supplements and wellness gadgets — two categories that work together beautifully and cover all the bases for people serious about their health.",
    body: [
      "One of your first steps in The Blitz is choosing a product to promote. You'll do this inside one of two affiliate networks — Media Mavens (BTS's in-house network) or ClickBank. Both are stocked with health and wellness products: supplements, gadgets, and wellness devices aimed at the exact market described in Pillar 2. You won't be hunting for a market or a niche — that decision has already been made. Your job is simply to choose a specific product within it.",
    ],
  },
  {
    num: 3,
    title: "The Demographic — Know Your Buyer",
    icon: Users2,
    tint: { iconBg: "bg-violet-50", iconBorder: "border-violet-200", iconText: "text-violet-700" },
    quote:
      "Approximately 80% of the money that flows through the internet comes from women in their 40s, 50s, and 60s. Health and wellness products aimed at this group convert like nothing else.",
    body: [
      "A significant portion of The Blitz is devoted to creating your marketing materials — the ads people see and the landing pages they arrive at after clicking. The core principle is simple: know exactly who you're writing for before you write a single word. For the majority of health and wellness products in our networks, that person is a woman in her 40s, 50s, or 60s dealing with a real health challenge — joint pain, low energy, sleep issues, stress. She has disposable income, wants something that works, and isn't looking for complicated solutions.",
      "That said, the demographic follows the product. Some offers skew toward a broader or younger audience — a trendy pet gadget, for example, attracts a different buyer than a joint support supplement. The principle from Pillar 3 isn't a rigid rule; it's a reminder to think clearly about who your specific product is actually for, and make sure every headline, image, and landing page speaks directly to that person. Your coach can help you identify the right target if you're unsure.",
    ],
  },
  {
    num: 4,
    title: "The Traffic Channel — Email",
    icon: Mail,
    tint: { iconBg: "bg-amber-50", iconBorder: "border-amber-200", iconText: "text-amber-700" },
    quote:
      "We're not building our own email list. We're finding the people who already have massive lists and placing our ads inside the emails they send to their subscribers.",
    body: [
      "In The Blitz you'll be running your ads on a platform called Caterpillar — that's the name used throughout the guide to protect the source. Caterpillar is one of the large email publishers described in Pillar 4. When your ad runs there, it's appearing inside emails being sent to large subscriber lists. You're not on Google. You're not on Facebook. You're doing exactly what Pillar 4 described: placing your ad inside someone else's email, reaching their audience.",
      "This is why the channel works the way it does — no algorithm changes, no account bans, warmer traffic because those subscribers already opted in to receive those emails. The advantages described in Pillar 4 are real, and Caterpillar is where you'll experience them firsthand.",
    ],
  },
  {
    num: 5,
    title: "The Strategy — Test with Sponsorships, Scale with Dedicateds",
    icon: Target,
    tint: { iconBg: "bg-rose-50", iconBorder: "border-rose-200", iconText: "text-rose-700" },
    quote:
      "Dedicateds are where you want to end up — that's where the big scale happens. But sponsorships are where you test. You don't spend dedicated money until you know what works.",
    body: [
      "The Blitz is built so these stages map directly onto this strategy. During the Test phase, your ads run as sponsorships — your ad appears alongside other content inside an email, at a lower cost per click. This is your testing ground. You run several rounds of tests to find the combination of ad and landing page that works best, while keeping your spend manageable.",
      "Once you've found a profitable combination and run it for 14 or more consecutive profitable days, The Blitz graduates you to what's called the Master Publisher — a dedicated email send where the entire email is your ad, going out to a massive list all at once. That's the dedicated email phase from Pillar 5. It's where the real scale happens — and The Blitz won't let you go there until you've earned it through the data.",
    ],
  },
  {
    num: 6,
    title: "The Edge — Proprietary Software + Your VA Team",
    icon: Zap,
    tint: { iconBg: "bg-cyan-50", iconBorder: "border-cyan-200", iconText: "text-cyan-700" },
    quote:
      "You don't want to be the one working your business. We are entrepreneurs — not cogs in the machine. The software and the team exist so you can focus on strategy.",
    body: [
      "Throughout the Build phase of The Blitz, you'll use proprietary software built specifically for this system, including Flexy™, MetricMover™, and DIYTrax™. Flexy™ is the tool you'll use to build your landing pages — no coding required. MetricMover™ automatically generates 25 different versions of your landing page by combining your headlines and images, then rotates visitors through all of them to find what converts best. DIYTrax™ is your tracking dashboard — it connects your ads, your landing pages, and your affiliate link, and records exactly which combinations produce sales.",
      "At any step where you'd rather hand off the technical work and stay focused on the bigger picture, BTS Concierge™ — your VA team — can handle it for you. That option is available at every step throughout The Blitz.",
    ],
  },
  {
    num: 7,
    title: "The Mindset — Perseverance over Perfection",
    icon: Heart,
    tint: { iconBg: "bg-orange-50", iconBorder: "border-orange-200", iconText: "text-orange-700" },
    quote:
      "You're going to have days when you want to throw in the towel. I've been there dozens of times, if not hundreds. What you must cultivate is a tenacity to persevere.",
    body: [
      "The first rounds of testing in The Blitz almost always lose money — and that is completely by design. You are spending money to buy data: to find out which headlines your audience responds to, which images stop the scroll, which landing pages turn visitors into buyers. That information is what makes the later rounds — and eventually the Scale phase — profitable. The early loss is the price of the knowledge, not a sign that something is wrong.",
      "The Blitz has built the mindset pillar into its structure: there are rules about how long to wait before making decisions, checkpoints that prevent you from panicking and changing things too early, and clear instructions on when to ask for help instead of spinning in place. When the early rounds feel discouraging, come back to Pillar 7. This is what it looks like in practice.",
    ],
  },
];

function BackToTop({ topRef }: { topRef: RefObject<HTMLDivElement | null> }) {
  return (
    <button
      onClick={() => topRef.current?.scrollIntoView({ behavior: "smooth" })}
      className="flex items-center gap-1 text-sm text-primary hover:underline font-medium mt-6"
    >
      <ChevronUp className="w-4 h-4" />
      Back to Top
    </button>
  );
}

function PillarQuickNav() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav aria-label="Jump to a pillar" className="!mt-3">
      <div className="overflow-x-auto pb-1">
        <div className="grid grid-cols-8 gap-1.5 sm:gap-2 min-w-[680px]">
          {bridges.map((bridge) => {
            const Icon = bridge.icon;
            return (
              <button
                key={bridge.num}
                type="button"
                onClick={() => scrollTo(`bridge${bridge.num}`)}
                className="group flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-card px-1 py-2.5 text-center transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border ${bridge.tint.iconBg} ${bridge.tint.iconBorder} shrink-0`}
                >
                  <Icon className={`h-4 w-4 ${bridge.tint.iconText}`} />
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
                  Pillar #{bridge.num}
                </span>
                <span className="text-[11px] font-semibold leading-tight text-foreground">
                  {bridge.title.split(" — ")[0]}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => scrollTo("next-steps")}
            className="group flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-card px-1 py-2.5 text-center transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border bg-primary/10 border-primary/30 shrink-0">
              <Rocket className="h-4 w-4 text-primary" />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
              Up Next
            </span>
            <span className="text-[11px] font-semibold leading-tight text-foreground">
              Next Steps
            </span>
          </button>
        </div>
      </div>
    </nav>
  );
}

function BridgeCard({ bridge, topRef }: { bridge: Bridge; topRef: RefObject<HTMLDivElement | null> }) {
  const Icon = bridge.icon;
  return (
    <Card id={`bridge${bridge.num}`} className="border-border/60 shadow-sm overflow-hidden scroll-mt-6">
      <div className="flex items-start gap-4 p-6 border-b border-border/60 bg-muted/30">
        <div
          className={`w-12 h-12 rounded-xl border ${bridge.tint.iconBg} ${bridge.tint.iconBorder} flex items-center justify-center shrink-0`}
        >
          <Icon className={`w-6 h-6 ${bridge.tint.iconText}`} />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Pillar #{bridge.num}
          </p>
          <h2 className="text-2xl font-bold text-foreground">{bridge.title}</h2>
        </div>
      </div>
      <CardContent className="p-8 md:p-10 space-y-6">
        <blockquote className={`rounded-xl border-l-4 ${bridge.tint.iconBorder} ${bridge.tint.iconBg} px-5 py-4`}>
          <p className="text-foreground/90 italic leading-relaxed">“{bridge.quote}”</p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            From the 7 Pillars™
          </p>
        </blockquote>

        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ArrowRight className={`w-4 h-4 ${bridge.tint.iconText}`} />
          What this becomes in The Blitz™
        </div>

        <div className="space-y-4">
          {bridge.body.map((para, i) => (
            <p key={i} className="text-muted-foreground leading-relaxed">
              {para}
            </p>
          ))}
        </div>

        <BackToTop topRef={topRef} />
      </CardContent>
    </Card>
  );
}

export default function PillarsToBlitz() {
  const topRef = useRef<HTMLDivElement>(null);

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl" ref={topRef}>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Route className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">What The Blitz™ Is — And Why It's Built the Way It Is</h1>
          </div>
          <p className="text-muted-foreground">
            A bridge from the 7 Pillars™ to your first campaign
          </p>

          <Card className="mt-4 border-border/60 shadow-sm">
            <CardContent className="px-8 md:px-10 py-4 md:py-5 space-y-5">
              <p className="text-muted-foreground leading-relaxed">
                You've just finished the <strong className="text-foreground">7 Pillars™</strong> — the
                foundation of everything in this business. Now you're about to open{" "}
                <strong className="text-foreground">The Blitz™</strong>, the step-by-step system for actually
                building and launching your first campaign.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Before you dive in, it helps to understand what The Blitz is going to ask you to do — and
                exactly why. <strong className="text-foreground">Every major step in The Blitz is a direct
                application of one of the pillars you just learned.</strong> Nothing in it is arbitrary. This
                page connects those dots so the whole system makes sense from the start.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-2 px-1">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Each pillar → what it becomes in The Blitz™
          </span>
        </div>

        <PillarQuickNav />

        {bridges.map((bridge) => (
          <BridgeCard key={bridge.num} bridge={bridge} topRef={topRef} />
        ))}

        <Card id="next-steps" className="border-primary/30 bg-primary/5 shadow-sm scroll-mt-6">
          <CardContent className="p-8 md:p-10 space-y-5">
            <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
              <Sparkles className="w-6 h-6 text-primary" />
              Before You Start
            </h2>
            <p className="text-foreground/90 leading-relaxed">
              The <strong className="text-foreground">7 Pillars™</strong> shows you the destination — a
              profitable campaign scaling with dedicated email blasts. <strong className="text-foreground">The
              Blitz™</strong> starts you at step one of getting there. The early steps will look nothing like
              the finished picture, and that's exactly right.
            </p>
            <p className="text-foreground/90 leading-relaxed font-medium">
              Every step you take in The Blitz is grounded in one of the pillars you just learned. Trust the
              process and the destination comes into view.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button asChild className="gap-2">
                <Link href="/blitz">
                  Open The Blitz™
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="gap-2">
                <Link href="/core-training/7-pillars">
                  <ArrowLeft className="w-4 h-4" />
                  Back to the 7 Pillars™
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
