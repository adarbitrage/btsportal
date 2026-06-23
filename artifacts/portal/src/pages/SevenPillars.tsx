import { AppLayout } from "@/components/layout/AppLayout";
import { VidalyticsEmbed } from "@/components/VidalyticsEmbed";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Layers, Briefcase, ShoppingBag, Users2, Mail,
  Target, Zap, Heart, ChevronUp, ArrowRight, CheckCircle2, Rocket,
} from "lucide-react";
import { useRef, type ComponentType, type SVGProps, type RefObject } from "react";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

type PillarTint = {
  iconBg: string;
  iconBorder: string;
  iconText: string;
};

type Pillar = {
  id: string;
  num: number;
  title: string;
  icon: IconType;
  tint: PillarTint;
};

const pillars: Pillar[] = [
  {
    id: "pillar1",
    num: 1,
    title: "The Business Model",
    icon: Briefcase,
    tint: { iconBg: "bg-blue-50", iconBorder: "border-blue-200", iconText: "text-blue-700" },
  },
  {
    id: "pillar2",
    num: 2,
    title: "The Market",
    icon: ShoppingBag,
    tint: { iconBg: "bg-emerald-50", iconBorder: "border-emerald-200", iconText: "text-emerald-700" },
  },
  {
    id: "pillar3",
    num: 3,
    title: "The Demographic",
    icon: Users2,
    tint: { iconBg: "bg-violet-50", iconBorder: "border-violet-200", iconText: "text-violet-700" },
  },
  {
    id: "pillar4",
    num: 4,
    title: "The Traffic Channel",
    icon: Mail,
    tint: { iconBg: "bg-amber-50", iconBorder: "border-amber-200", iconText: "text-amber-700" },
  },
  {
    id: "pillar5",
    num: 5,
    title: "The Strategy",
    icon: Target,
    tint: { iconBg: "bg-rose-50", iconBorder: "border-rose-200", iconText: "text-rose-700" },
  },
  {
    id: "pillar6",
    num: 6,
    title: "The Edge",
    icon: Zap,
    tint: { iconBg: "bg-cyan-50", iconBorder: "border-cyan-200", iconText: "text-cyan-700" },
  },
  {
    id: "pillar7",
    num: 7,
    title: "The Commitment",
    icon: Heart,
    tint: { iconBg: "bg-orange-50", iconBorder: "border-orange-200", iconText: "text-orange-700" },
  },
];

function PillarQuickNav() {
  const scrollToPillar = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav aria-label="Jump to a pillar" className="!mt-3">
      <div className="overflow-x-auto pb-1">
        <div className="grid grid-cols-8 gap-1.5 sm:gap-2 min-w-[680px]">
          {pillars.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <button
                key={pillar.id}
                type="button"
                onClick={() => scrollToPillar(pillar.id)}
                className="group flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-card px-1 py-2.5 text-center transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border ${pillar.tint.iconBg} ${pillar.tint.iconBorder} shrink-0`}
                >
                  <Icon className={`h-4 w-4 ${pillar.tint.iconText}`} />
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
                  Pillar #{pillar.num}
                </span>
                <span className="text-[11px] font-semibold leading-tight text-foreground">
                  {pillar.title}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => scrollToPillar("conclusion")}
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

function PillarHeader({ pillar }: { pillar: Pillar }) {
  const Icon = pillar.icon;
  return (
    <div className="flex items-start gap-4 p-6 border-b border-border/60 bg-muted/30">
      <div
        className={`w-12 h-12 rounded-xl border ${pillar.tint.iconBg} ${pillar.tint.iconBorder} flex items-center justify-center shrink-0`}
      >
        <Icon className={`w-6 h-6 ${pillar.tint.iconText}`} />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Pillar #{pillar.num}
        </p>
        <h2 className="text-2xl font-bold text-foreground">{pillar.title}</h2>
      </div>
    </div>
  );
}

function HighlightBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/40 p-6 space-y-3">
      <h3 className="font-bold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function CheckList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2 text-sm text-foreground/85">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function SevenPillars() {
  const topRef = useRef<HTMLDivElement>(null);

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl" ref={topRef}>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">The 7 Pillars™</h1>
          </div>
          <p className="text-muted-foreground">
            The foundational framework behind every successful affiliate marketing
            business — the seven elements that turn paid traffic into a profitable
            digital business.
          </p>
          <div className="mt-4 rounded-xl border border-border/60 bg-muted/40 p-4">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Start here.</strong> This is where your path begins — it
              gives you the big-picture model so the hands-on build in The Blitz™ makes sense.
            </p>
          </div>
          <div className="mt-6 overflow-hidden rounded-xl border border-border/60 shadow-sm">
            <VidalyticsEmbed
              embedId="CsHMvOhZEPEm1Dpp"
              loaderUrl="https://fast.vidalytics.com/embeds/trR5xdVa/CsHMvOhZEPEm1Dpp/"
            />
          </div>
        </div>

        <PillarQuickNav />

        <section id="welcome" className="!mt-3">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-8 md:p-10 space-y-5">
              <h2 className="text-2xl font-bold text-foreground">
                Welcome To The 7 Pillars™ Of A Profitable Digital Business
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Welcome, and thank you for choosing to embark on this journey. Over the past 20+ years, we've immersed ourselves in the digital marketing industry, navigating its intricate pathways and learning its secrets. We've experienced the peaks of success, the valleys of failure, and the vast plains of steady progress. Each step of the way, we've gathered invaluable insights and honed strategies that work.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                In this training, we're going to dive deep into the heart of digital marketing. We're not just skimming the surface; we're dissecting the industry, breaking it down into its core components, and <strong className="text-foreground">revealing the essential elements that make a profitable digital business</strong>. This isn't a quick overview; it's a comprehensive exploration of the intricate details that can propel your success in this industry.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                The digital marketing landscape is vast and complex, but that shouldn't deter you. With the right guidance and a solid understanding of the fundamentals, <strong className="text-foreground">you can navigate this landscape with confidence and precision</strong>. That's where Build Test Scale comes in. This program is designed to equip you with the knowledge, skills, and strategies you need to thrive in the digital marketing world.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                We've broken down the process of building a successful digital business into <strong className="text-foreground">seven key pillars</strong>. These pillars are the foundation of any successful digital business, and understanding them is crucial to your success. Each pillar represents a vital component of your business, and we're going to explore each one in detail.
              </p>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </section>

        <section id="pillar1">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <PillarHeader pillar={pillars[0]} />
            <CardContent className="p-8 md:p-10 space-y-5">
              <p className="text-muted-foreground leading-relaxed">
                The first pillar of a successful digital business is <strong className="text-foreground">the business model</strong>. This is the framework that your business operates within, the strategy that guides your actions, and the mechanism that generates your profits.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                In the vast world of online business models, one stands out for its simplicity, predictability, and scalability: <strong className="text-foreground">Affiliate Marketing</strong>. Over the past two decades, we've explored numerous online business models, but none have proven as consistently profitable as Affiliate Marketing, particularly when combined with paid media — a strategy also known as <strong className="text-foreground">Affiliate Arbitrage</strong>.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Affiliate Arbitrage involves using paid advertising to promote affiliate offers, with the goal of earning more in affiliate commissions than you spend on advertising. If you spend $40 on ads to sell a product and earn a $60 commission, you've made a $20 profit. Scale that to 10 sales a day and you're looking at <strong className="text-foreground">$200 daily profit</strong>.
              </p>
              <HighlightBox title="Key Benefits of Affiliate Arbitrage:">
                <CheckList
                  items={[
                    "No need to build a complete website — we're in the business of making profits",
                    "No need to create your own product — leverage existing products with market demand",
                    "No merchant processing or customer support hassles",
                    "No existing audience required — start from scratch and turn a profit in your first week",
                    "Track ROI in real time — you're paid on the front-end sale",
                  ]}
                />
              </HighlightBox>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </section>

        <section id="pillar2">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <PillarHeader pillar={pillars[1]} />
            <CardContent className="p-8 md:p-10 space-y-5">
              <p className="text-muted-foreground leading-relaxed">
                Once you've committed to the path of affiliate arbitrage, the next crucial step is selecting the market you wish to operate in. Based on 20+ years of experience, two primary markets consistently deliver exceptional results: <strong className="text-foreground">Trendy Gadgets</strong> and <strong className="text-foreground">Health & Wellness Products</strong>.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-border/60 bg-muted/40 p-6">
                  <h3 className="font-bold text-foreground mb-2">Trendy Gadgets</h3>
                  <p className="text-sm text-muted-foreground">
                    These products have universal appeal. In an era of rapid technological advancements, there's always a new gadget catching the world's attention. The global gadget market is valued at hundreds of billions of dollars and is only projected to grow.
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/40 p-6">
                  <h3 className="font-bold text-foreground mb-2">Health & Wellness</h3>
                  <p className="text-sm text-muted-foreground">
                    This market is valued at over $300 billion globally. Post-pandemic, consumers are more focused than ever on improving their health. Supplements offer affordable, scalable solutions making them ideal for scaling campaigns.
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                As part of your enrollment in Build Test Scale, you'll gain access to hundreds of health and wellness offers through multiple affiliate network relationships. <strong className="text-foreground">You will never need to hunt for offers — your pathway to success is already paved.</strong>
              </p>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </section>

        <section id="pillar3">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <PillarHeader pillar={pillars[2]} />
            <CardContent className="p-8 md:p-10 space-y-5">
              <p className="text-muted-foreground leading-relaxed">
                Once we've established what we'll be promoting, it's time to identify our target audience. A significant portion of online spending comes from a demographic that many marketers overlook: <strong className="text-foreground">Baby Boomers</strong> — individuals in their late 50s to early 70s who are financially established with disposable income.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Contrary to popular belief, Baby Boomers are far from being technologically inept. They use smartphones, are active on social media, and regularly shop online. Studies show that <strong className="text-foreground">Boomers spend more money online than younger generations</strong>.
              </p>
              <HighlightBox title="Why Boomers Are the Perfect Demographic:">
                <CheckList
                  items={[
                    "They're drawn to products that make their lives easier and more enjoyable",
                    "They're highly motivated to invest in health & wellness products",
                    "They value convenience and immediate results",
                    "They make up one of the largest, most financially capable demographic groups",
                  ]}
                />
              </HighlightBox>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </section>

        <section id="pillar4">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <PillarHeader pillar={pillars[3]} />
            <CardContent className="p-8 md:p-10 space-y-5">
              <p className="text-muted-foreground leading-relaxed">
                We've identified our business model (Affiliate Marketing), our markets (Trendy Gadgets & Health), and our target demographic (Boomers). Now it's time to address WHERE we'll promote our products. The answer is <strong className="text-foreground">through the powerful medium of email</strong>.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Our strategy revolves around leveraging the power of existing email lists. Instead of building our own list, we seek out those who already have extensive email lists and place our ads within the emails they send to their subscribers.
              </p>
              <HighlightBox title="Why Email Traffic Reigns Supreme:">
                <CheckList
                  items={[
                    "Enormous scale — vast number of email lists available",
                    "Many newsletters are sent daily — plenty of inventory to purchase",
                    "Some lists have over a million subscribers for instant reach",
                    "No complicated, ever-changing algorithms like Google or Facebook",
                    "Warmer traffic — subscribers are already opted in and receptive",
                    "Less competition — most marketers are unaware of this channel",
                  ]}
                />
              </HighlightBox>
              <p className="text-muted-foreground leading-relaxed">
                As part of your enrollment, you'll gain access to hundreds of underground list management companies, brokers, publishers, and networks. <strong className="text-foreground">You'll never be left wondering where to buy advertising!</strong>
              </p>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </section>

        <section id="pillar5">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <PillarHeader pillar={pillars[4]} />
            <CardContent className="p-8 md:p-10 space-y-5">
              <p className="text-muted-foreground leading-relaxed">
                The strategy is our operational blueprint. In affiliate marketing, success isn't a game of chance — it's a calculated effort. <strong className="text-foreground">Our two-phase approach is built for simplicity and effectiveness.</strong>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-border/60 bg-muted/40 p-6">
                  <h3 className="font-bold text-foreground mb-2">Phase 1: Email Sponsorships</h3>
                  <p className="text-sm text-muted-foreground">
                    This is where the journey begins. Email Sponsorships put your offers directly in front of highly engaged audiences, giving you the perfect testing ground. Many students spend $5k+ per day, achieving ROI of 50% or higher during this phase.
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/40 p-6">
                  <h3 className="font-bold text-foreground mb-2">Phase 2: Dedicated Emails</h3>
                  <p className="text-sm text-muted-foreground">
                    Once you've identified the highest-performing ads and landing pages, you move to Dedicated Emails. This is where the big results happen — massive, highly targeted audiences with precision. This phase is all about execution with excellence.
                  </p>
                </div>
              </div>
              <p className="font-medium text-foreground leading-relaxed">
                Start strong with Sponsorships. Scale big with Dedicateds. This is the formula for success.
              </p>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </section>

        <section id="pillar6">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <PillarHeader pillar={pillars[5]} />
            <CardContent className="p-8 md:p-10 space-y-5">
              <p className="text-muted-foreground leading-relaxed">
                In the fiercely competitive landscape of affiliate marketing, having an edge is not just a luxury — it's a necessity. That's where Build Test Scale comes into play, providing you with the tools and resources you need to not just compete, but to <strong className="text-foreground">thrive and succeed</strong>.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Our edge is delivered through two primary channels: our <strong className="text-foreground">proprietary software (Paid Media Suite™)</strong> and our dedicated <strong className="text-foreground">BTS Concierge™</strong>. These two elements work in perfect harmony to give you a significant advantage.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                As part of Build Test Scale, you'll have access to the BTS Concierge™ — a dedicated group of top-tier experts who handle the creation of all your marketing materials, saving you countless hours and significant financial resources.
              </p>
              <HighlightBox title="Proprietary Software Suite:">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  {[
                    { name: "Flexy™", desc: "Drag-and-drop landing page app" },
                    { name: "MetricMover™", desc: "Create & test hundreds of pages" },
                    { name: "DIYTrax™", desc: "URL rotator and tracker" },
                    { name: "PixelPress™", desc: "Bulk create & split test banner ads" },
                    { name: "Blaze™", desc: "Personal ad server for scaling" },
                    { name: "NoEscape™", desc: "Exit pops & tab-overs to boost revenue" },
                  ].map((tool) => (
                    <div key={tool.name} className="flex items-start gap-2 text-muted-foreground">
                      <span className="font-bold shrink-0 text-foreground">{tool.name}</span>
                      <span>— {tool.desc}</span>
                    </div>
                  ))}
                </div>
              </HighlightBox>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </section>

        <section id="pillar7">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <PillarHeader pillar={pillars[6]} />
            <CardContent className="p-8 md:p-10 space-y-5">
              <p className="text-muted-foreground leading-relaxed">
                The final pillar, and perhaps the most critical, is <strong className="text-foreground">the commitment</strong>. Success in affiliate marketing, as in any business, requires a steadfast commitment to your goals and the willingness to put in the necessary work. Build Test Scale provides you with the tools, the team, and the strategy, but the commitment must come from you.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Affiliate marketing is not a get-rich-quick scheme. It's a legitimate business model that requires time, effort, and dedication. You must be willing to learn, adapt, and grow. You must be ready to face challenges and overcome obstacles. And most importantly, <strong className="text-foreground">you must be committed to taking consistent action towards your goals</strong>.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Build Test Scale is designed to guide you on this journey, providing you with a clear path to follow. But it's up to you to walk that path. It's up to you to make the commitment to your success.
              </p>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </section>

        <section id="conclusion">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-8 md:p-10 space-y-5">
              <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                <Rocket className="w-6 h-6 text-primary" />
                Conclusion & Next Steps
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Build Test Scale is a comprehensive training program that covers all aspects of affiliate marketing — from the business model to the product, the market, the demographic, the traffic, the edge, and the commitment. It's designed to provide you with a <strong className="text-foreground">clear, step-by-step guide to building a successful affiliate marketing business</strong>.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                But remember, the training program is just a tool. It's a roadmap to success. But you are the driver. You are the one who must take the wheel and steer your business towards your goals.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button asChild className="gap-2">
                  <Link href="/core-training/pillars-to-blitz">
                    Next: Before You Start The Blitz™
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="gap-2">
                  <Link href="/">Back to Welcome</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppLayout>
  );
}
