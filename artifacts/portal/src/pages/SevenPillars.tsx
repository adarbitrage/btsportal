import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Layers, Briefcase, ShoppingBag, Users2, Mail,
  Target, Zap, Heart, ChevronUp, ArrowRight
} from "lucide-react";
import { useRef } from "react";

function BackToTop({ topRef }: { topRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <button
      onClick={() => topRef.current?.scrollIntoView({ behavior: "smooth" })}
      className="flex items-center gap-1 text-sm text-[#1a56db] hover:underline font-medium mt-6"
    >
      <ChevronUp className="w-4 h-4" />
      Back to Top
    </button>
  );
}

const pillars = [
  { id: "pillar1", num: 1, title: "The Business Model", icon: Briefcase, color: "bg-blue-600" },
  { id: "pillar2", num: 2, title: "The Market", icon: ShoppingBag, color: "bg-emerald-600" },
  { id: "pillar3", num: 3, title: "The Demographic", icon: Users2, color: "bg-violet-600" },
  { id: "pillar4", num: 4, title: "The Traffic Channel", icon: Mail, color: "bg-amber-600" },
  { id: "pillar5", num: 5, title: "The Strategy", icon: Target, color: "bg-rose-600" },
  { id: "pillar6", num: 6, title: "The Edge", icon: Zap, color: "bg-cyan-600" },
  { id: "pillar7", num: 7, title: "The Commitment", icon: Heart, color: "bg-orange-600" },
];

export default function SevenPillars() {
  const topRef = useRef<HTMLDivElement>(null);

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8" ref={topRef}>

        <div className="bg-[#1a56db] rounded-2xl p-8 md:p-10 text-white shadow-lg">
          <h1 className="text-3xl md:text-4xl font-bold font-['Roboto'] tracking-tight mb-2">
            The 7 Pillars™ Of A Profitable Digital Business
          </h1>
          <p className="text-lg md:text-xl opacity-90">
            The foundational framework behind every successful affiliate marketing business.
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center">
                <Layers className="w-5 h-5 text-[#1a56db]" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Table of Contents</h2>
            </div>
            <div className="space-y-2">
              <a href="#welcome" className="block text-[#1a56db] font-semibold hover:underline">
                Welcome: Overview of the 7 Pillar™ System
              </a>
              {pillars.map((p) => (
                <a key={p.id} href={`#${p.id}`} className="flex items-center gap-2 text-[#1a56db] hover:underline">
                  <span className="w-6 h-6 rounded-full bg-[#1a56db]/10 text-[#1a56db] text-xs font-bold flex items-center justify-center shrink-0">
                    {p.num}
                  </span>
                  <span className="font-semibold">{p.title}</span>
                </a>
              ))}
              <a href="#conclusion" className="block text-[#1a56db] font-semibold hover:underline">
                Conclusion and Next Steps
              </a>
            </div>
          </CardContent>
        </Card>

        <section id="welcome">
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
            <div className="bg-blue-600 p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <Briefcase className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-white/70 text-sm font-semibold uppercase tracking-widest">Pillar #1</p>
                <h2 className="text-2xl font-bold text-white">The Business Model</h2>
              </div>
            </div>
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
              <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-6 space-y-3">
                <h3 className="font-bold text-foreground">Key Benefits of Affiliate Arbitrage:</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> No need to build a complete website — we're in the business of making profits</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> No need to create your own product — leverage existing products with market demand</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> No merchant processing or customer support hassles</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> No existing audience required — start from scratch and turn a profit in your first week</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> Track ROI in real time — you're paid on the front-end sale</li>
                </ul>
              </div>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </section>

        <section id="pillar2">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <div className="bg-emerald-600 p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <ShoppingBag className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-white/70 text-sm font-semibold uppercase tracking-widest">Pillar #2</p>
                <h2 className="text-2xl font-bold text-white">The Market</h2>
              </div>
            </div>
            <CardContent className="p-8 md:p-10 space-y-5">
              <p className="text-muted-foreground leading-relaxed">
                Once you've committed to the path of affiliate arbitrage, the next crucial step is selecting the market you wish to operate in. Based on 20+ years of experience, two primary markets consistently deliver exceptional results: <strong className="text-foreground">Trendy Gadgets</strong> and <strong className="text-foreground">Health & Wellness Products</strong>.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-6">
                  <h3 className="font-bold text-foreground mb-2">Trendy Gadgets</h3>
                  <p className="text-sm text-muted-foreground">
                    These products have universal appeal. In an era of rapid technological advancements, there's always a new gadget catching the world's attention. The global gadget market is valued at hundreds of billions of dollars and is only projected to grow.
                  </p>
                </div>
                <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-6">
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
            <div className="bg-violet-600 p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <Users2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-white/70 text-sm font-semibold uppercase tracking-widest">Pillar #3</p>
                <h2 className="text-2xl font-bold text-white">The Demographic</h2>
              </div>
            </div>
            <CardContent className="p-8 md:p-10 space-y-5">
              <p className="text-muted-foreground leading-relaxed">
                Once we've established what we'll be promoting, it's time to identify our target audience. A significant portion of online spending comes from a demographic that many marketers overlook: <strong className="text-foreground">Baby Boomers</strong> — individuals in their late 50s to early 70s who are financially established with disposable income.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Contrary to popular belief, Baby Boomers are far from being technologically inept. They use smartphones, are active on social media, and regularly shop online. Studies show that <strong className="text-foreground">Boomers spend more money online than younger generations</strong>.
              </p>
              <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-6 space-y-3">
                <h3 className="font-bold text-foreground">Why Boomers Are the Perfect Demographic:</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> They're drawn to products that make their lives easier and more enjoyable</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> They're highly motivated to invest in health & wellness products</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> They value convenience and immediate results</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> They make up one of the largest, most financially capable demographic groups</li>
                </ul>
              </div>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </section>

        <section id="pillar4">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <div className="bg-amber-600 p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <Mail className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-white/70 text-sm font-semibold uppercase tracking-widest">Pillar #4</p>
                <h2 className="text-2xl font-bold text-white">The Traffic Channel</h2>
              </div>
            </div>
            <CardContent className="p-8 md:p-10 space-y-5">
              <p className="text-muted-foreground leading-relaxed">
                We've identified our business model (Affiliate Marketing), our markets (Trendy Gadgets & Health), and our target demographic (Boomers). Now it's time to address WHERE we'll promote our products. The answer is <strong className="text-foreground">through the powerful medium of email</strong>.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Our strategy revolves around leveraging the power of existing email lists. Instead of building our own list, we seek out those who already have extensive email lists and place our ads within the emails they send to their subscribers.
              </p>
              <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-6 space-y-3">
                <h3 className="font-bold text-foreground">Why Email Traffic Reigns Supreme:</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> Enormous scale — vast number of email lists available</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> Many newsletters are sent daily — plenty of inventory to purchase</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> Some lists have over a million subscribers for instant reach</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> No complicated, ever-changing algorithms like Google or Facebook</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> Warmer traffic — subscribers are already opted in and receptive</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e] mt-0.5">&#10003;</span> Less competition — most marketers are unaware of this channel</li>
                </ul>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                As part of your enrollment, you'll gain access to hundreds of underground list management companies, brokers, publishers, and networks. <strong className="text-foreground">You'll never be left wondering where to buy advertising!</strong>
              </p>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </section>

        <section id="pillar5">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <div className="bg-rose-600 p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <Target className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-white/70 text-sm font-semibold uppercase tracking-widest">Pillar #5</p>
                <h2 className="text-2xl font-bold text-white">The Strategy</h2>
              </div>
            </div>
            <CardContent className="p-8 md:p-10 space-y-5">
              <p className="text-muted-foreground leading-relaxed">
                The strategy is our operational blueprint. In affiliate marketing, success isn't a game of chance — it's a calculated effort. <strong className="text-foreground">Our two-phase approach is built for simplicity and effectiveness.</strong>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-6">
                  <h3 className="font-bold text-foreground mb-2">Phase 1: Email Sponsorships</h3>
                  <p className="text-sm text-muted-foreground">
                    This is where the journey begins. Email Sponsorships put your offers directly in front of highly engaged audiences, giving you the perfect testing ground. Many students spend $5k+ per day, achieving ROI of 50% or higher during this phase.
                  </p>
                </div>
                <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-6">
                  <h3 className="font-bold text-foreground mb-2">Phase 2: Dedicated Emails</h3>
                  <p className="text-sm text-muted-foreground">
                    Once you've identified the highest-performing ads and landing pages, you move to Dedicated Emails. This is where the big results happen — massive, highly targeted audiences with precision. This phase is all about execution with excellence.
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground leading-relaxed font-medium text-foreground">
                Start strong with Sponsorships. Scale big with Dedicateds. This is the formula for success.
              </p>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </section>

        <section id="pillar6">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <div className="bg-cyan-600 p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-white/70 text-sm font-semibold uppercase tracking-widest">Pillar #6</p>
                <h2 className="text-2xl font-bold text-white">The Edge</h2>
              </div>
            </div>
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
              <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-6 space-y-3">
                <h3 className="font-bold text-foreground">Proprietary Software Suite:</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <span className="text-[#1a56db] font-bold shrink-0">Flexy™</span> — Drag-and-drop landing page app
                  </div>
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <span className="text-[#1a56db] font-bold shrink-0">MetricMover™</span> — Create & test hundreds of pages
                  </div>
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <span className="text-[#1a56db] font-bold shrink-0">DIYTrax™</span> — URL rotator and tracker
                  </div>
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <span className="text-[#1a56db] font-bold shrink-0">PixelPress™</span> — Bulk create & split test banner ads
                  </div>
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <span className="text-[#1a56db] font-bold shrink-0">Blaze™</span> — Personal ad server for scaling
                  </div>
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <span className="text-[#1a56db] font-bold shrink-0">NoEscape™</span> — Exit pops & tab-overs to boost revenue
                  </div>
                </div>
              </div>
              <BackToTop topRef={topRef} />
            </CardContent>
          </Card>
        </section>

        <section id="pillar7">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <div className="bg-orange-600 p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <Heart className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-white/70 text-sm font-semibold uppercase tracking-widest">Pillar #7</p>
                <h2 className="text-2xl font-bold text-white">The Commitment</h2>
              </div>
            </div>
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
          <Card className="border-[#1a56db]/30 shadow-sm bg-gradient-to-br from-[#1a56db]/5 to-transparent">
            <CardContent className="p-8 md:p-10 space-y-5">
              <h2 className="text-2xl font-bold text-foreground">Conclusion & Next Steps</h2>
              <p className="text-muted-foreground leading-relaxed">
                Build Test Scale is a comprehensive training program that covers all aspects of affiliate marketing — from the business model to the product, the market, the demographic, the traffic, the edge, and the commitment. It's designed to provide you with a <strong className="text-foreground">clear, step-by-step guide to building a successful affiliate marketing business</strong>.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                But remember, the training program is just a tool. It's a roadmap to success. But you are the driver. You are the one who must take the wheel and steer your business towards your goals.
              </p>
              <p className="text-lg font-bold text-foreground">
                You are made for BIG things. This is YOUR time, so PLAY BIG!
              </p>
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Link href="/core-training/quick-start">
                  <Button className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-2">
                    <ArrowRight className="w-4 h-4" />
                    Head to the Quick-Start Guide
                  </Button>
                </Link>
                <Link href="/core-training">
                  <Button variant="outline" className="gap-2">
                    Back to Core Training
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>

      </div>
    </AppLayout>
  );
}
