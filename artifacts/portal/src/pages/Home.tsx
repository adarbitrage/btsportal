import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGetCurrentMember } from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  Layers, ArrowRight, Mail, Target,
  Sparkles, Video, Zap, Briefcase, ShoppingBag, Users2, Heart
} from "lucide-react";

const pillars = [
  { icon: Briefcase, title: "Pillar 1: The Business Model", desc: "Affiliate Arbitrage — use paid advertising to promote affiliate offers for profit." },
  { icon: ShoppingBag, title: "Pillar 2: The Market", desc: "Choose markets that consistently deliver, like trendy gadgets and health & wellness." },
  { icon: Users2, title: "Pillar 3: The Demographic", desc: "Target the audience that spends, with a focus on Baby Boomers." },
  { icon: Mail, title: "Pillar 4: The Traffic Channel", desc: "Promote through email by leveraging existing email lists." },
  { icon: Target, title: "Pillar 5: The Strategy", desc: "A two-phase approach: email sponsorships, then dedicated emails." },
  { icon: Zap, title: "Pillar 6: The Edge", desc: "Proprietary software (Paid Media Suite™) and the BTS Concierge™." },
  { icon: Heart, title: "Pillar 7: The Commitment", desc: "A legitimate business model requiring consistent, dedicated action." },
];

const firstSteps = [
  {
    href: "/core-training/7-pillars",
    icon: Layers,
    title: "Learn the 7 Pillars",
    desc: "Get the big-picture model behind the whole program before you build anything.",
  },
  {
    href: "/blitz",
    icon: Zap,
    title: "Start the Blitz™",
    desc: "Build · Test · Scale — your step-by-step sprint from setup to your first live campaign.",
  },
  {
    href: "/coaching",
    icon: Video,
    title: "Join a live group coaching call",
    desc: "Get your questions answered live and keep your momentum going.",
  },
];

export default function Home() {
  const { data: member } = useGetCurrentMember();
  const firstName = member?.name?.split(" ")[0] ?? "Member";

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Thank You! And Welcome!</h1>
          </div>
          <p className="text-muted-foreground">
            You are now officially enrolled in <strong className="text-foreground">Build Test Scale™</strong> Mentorship.
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5 sm:p-8 md:p-10 space-y-6">
            <h2 className="text-xl font-bold text-foreground">
              Welcome to the Best Money-Making Opportunity, {firstName}!
            </h2>

            <div className="text-muted-foreground space-y-4 leading-relaxed">
              <p>
                Welcome to the <strong className="text-foreground">Build Test Scale™ (BTS)</strong> Affiliate Marketing Mentorship.
              </p>
              <p>
                You're about to learn how to make big money using <strong className="text-foreground">paid email media buys</strong>.
                Not sure what that means? No worries. We'll break it down for you. Once you get it, you won't want
                to use any other type of online advertising. Trust us.
              </p>
            </div>

            <div className="bg-muted/40 border border-border/60 rounded-xl p-6 space-y-3">
              <h3 className="font-semibold text-foreground text-lg">Why BTS?</h3>
              <p className="text-muted-foreground leading-relaxed">
                After talking to lots of our past students, we found out two things everyone wants:
              </p>
              <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                <li>To get <strong className="text-foreground">tons of traffic fast</strong> without using Facebook, Google or TikTok.</li>
                <li>To <strong className="text-foreground">make money</strong> from that traffic.</li>
              </ol>
              <p className="text-muted-foreground leading-relaxed">
                That's why you're here, right? Because email traffic is powerful and fast. Imagine a flood of
                visitors to your site, filling up your bank account. It's addictive!
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5 sm:p-8 md:p-10 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">What's in Store for You</h2>
              <p className="text-muted-foreground leading-relaxed mt-2">
                Over the coming months, we will work through the 10,000 foot view of the BTS program —
                <strong className="text-foreground"> The 7 Pillars™ Of A Profitable Digital Business</strong>,
                using our proven email traffic sources and our full suite of tools.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {pillars.map((p, i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-muted/40 border border-border/60">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                    <p.icon className="w-5 h-5 text-blue-700" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground text-sm">{p.title}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{p.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5 sm:p-8 md:p-10 space-y-6">
            <h2 className="text-xl font-bold text-foreground">What You Are About To Learn</h2>
            <div className="text-muted-foreground space-y-4 leading-relaxed">
              <p>
                In this mentorship, we teach you <strong className="text-foreground">everything</strong> we know about generating
                mass traffic via paid email media buys, with nothing held back.
              </p>
              <p>
                You'll get the exact info you need to start running your own email campaigns profitably,
                no matter what you promote, and you'll learn how to create a valuable, lasting relationship
                with the traffic sources you work with along the way.
              </p>
              <p>
                Although you have immediate access to all content now, <em>it is intended to be consumed over
                several months</em>. Of course, you can go through the training faster than that, or skip around if
                you like. But a lot of students prefer the way we chunk it up. It's sometimes easier to consume
                and digest when taken a little slower.
              </p>
              <p>
                <strong className="text-foreground">We recommend you start with the 7 Pillars and then move into The Blitz™, completing each
                lesson in the order it's delivered.</strong> Go through the material as it is laid out, top to bottom,
                and when you need help, our support team and amazing mentors will be available to answer your
                questions.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-primary/30 shadow-sm bg-primary/[0.03]">
          <CardContent className="p-5 sm:p-8 md:p-10 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">Your First Steps</h2>
              <p className="text-muted-foreground leading-relaxed mt-2">
                New here? Follow these three steps in order — it's the fastest path from signing up to
                running your first campaign.
              </p>
            </div>

            <div className="space-y-3">
              {firstSteps.map((s, i) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <div className="flex items-start gap-4 p-4 rounded-xl border border-border/60 bg-background hover:border-foreground/30 hover:bg-muted/40 transition-all cursor-pointer group">
                    <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 font-bold">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <s.icon className="w-4 h-4 text-foreground shrink-0" />
                        <h4 className="font-semibold text-foreground">{s.title}</h4>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{s.desc}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground self-center ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
              <Button asChild size="lg" className="gap-2">
                <Link href="/core-training/7-pillars">
                  Start with the 7 Pillars
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
              <p className="text-sm text-muted-foreground">
                Start at the top — no setup required yet.
              </p>
            </div>

            <div className="bg-muted/40 border border-border/60 rounded-xl p-4">
              <p className="text-sm text-muted-foreground leading-relaxed italic">
                "Roll up your sleeves and let's get to work! Remember, you can learn at your own pace, and if
                there's anything you don't understand, or need clarification on, please ask away. Having access
                to our amazing team to answer all of your questions is the most valuable part of this mentorship,
                so don't be shy! Reach out whenever you need to!"
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="text-xs text-muted-foreground/70 pb-8 space-y-2">
          <p className="font-semibold">
            "Helping You Make The Most Money Possible, So You Can Do The Things You Love To Do,
            With The People You Love To Do Them With!"
          </p>
          <p className="mt-4 leading-relaxed">
            <strong>*DISCLAIMER:</strong> There is NO GUARANTEE and NO WARRANTY that employing the same techniques,
            ideas, strategies, products or services detailed here will produce the same results. Your earning
            potential is entirely dependent upon you, your skills, financial resources, marketing knowledge
            and the time you devote. THE LEVEL OF SUCCESS YOU REACH IS ENTIRELY DEPENDENT UPON YOUR OWN EFFORT
            AND DEDICATION.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
