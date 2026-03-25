import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useGetCurrentMember } from "@workspace/api-client-react";
import { Link } from "wouter";
import { BookOpen, Users, Headphones, Trophy, MessageSquare, Rocket, ArrowRight, Mail, Target, DollarSign, Lightbulb, GraduationCap, Shield } from "lucide-react";

const pillars = [
  { icon: Target, title: "Pillar 1: Foundation", desc: "Set up your digital business infrastructure the right way from day one." },
  { icon: Mail, title: "Pillar 2: Traffic Mastery", desc: "Learn paid email media buys — the fastest way to generate mass traffic." },
  { icon: DollarSign, title: "Pillar 3: Monetization", desc: "Turn that traffic into consistent, scalable revenue streams." },
  { icon: Lightbulb, title: "Pillar 4: Optimization", desc: "Refine your campaigns for maximum ROI using data-driven strategies." },
  { icon: Users, title: "Pillar 5: Relationships", desc: "Build lasting partnerships with traffic sources and affiliate networks." },
  { icon: GraduationCap, title: "Pillar 6: Scaling", desc: "Take what works and multiply it across new markets and offers." },
  { icon: Shield, title: "Pillar 7: Sustainability", desc: "Create a business that generates long-term, passive income." },
];

export default function Home() {
  const { data: member } = useGetCurrentMember();
  const firstName = member?.name?.split(" ")[0] ?? "Member";

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-10">

        <div className="bg-[#1a56db] rounded-2xl p-10 text-white text-center shadow-lg">
          <h1 className="text-4xl md:text-5xl font-bold font-['Roboto'] tracking-tight mb-3">
            Thank You! And Welcome!
          </h1>
          <p className="text-lg md:text-xl opacity-90">
            You are now officially enrolled in <strong>Build Test Scale™</strong> Mentorship
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-6">
            <h2 className="text-2xl font-bold text-foreground text-center">
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

            <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-6 space-y-3">
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
          <CardContent className="p-8 md:p-10 space-y-6">
            <h2 className="text-2xl font-bold text-foreground text-center">What's in Store for You</h2>
            <p className="text-muted-foreground text-center leading-relaxed max-w-2xl mx-auto">
              Over the coming months, we will work through the 10,000 foot view of the BTS program — 
              <strong className="text-foreground"> The 7 Pillars™ Of A Profitable Digital Business</strong>, 
              using our proven email traffic sources and our full suite of tools.
            </p>
            <div className="grid md:grid-cols-2 gap-4 mt-6">
              {pillars.map((p, i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-[#faf9f7] border border-[#e8e4dc]">
                  <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center shrink-0">
                    <p.icon className="w-5 h-5 text-[#1a56db]" />
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
          <CardContent className="p-8 md:p-10 space-y-6">
            <h2 className="text-2xl font-bold text-foreground text-center">What You Are About To Learn</h2>
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
                We recommend you complete each lesson in the Core Training section in the order it's delivered. 
                Go through the material as it is laid out, top to bottom, and when you need help, our support 
                team and amazing mentors will be available to answer your questions.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10">
            <h2 className="text-2xl font-bold text-foreground text-center mb-6">Get Started Now</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Link href="/training">
                <div className="flex items-center gap-3 p-4 rounded-xl border border-[#e8e4dc] hover:border-[#1a56db]/30 hover:bg-[#1a56db]/5 transition-all cursor-pointer group">
                  <BookOpen className="w-8 h-8 text-[#1a56db] shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm text-foreground group-hover:text-[#1a56db]">Core Training</h4>
                    <p className="text-xs text-muted-foreground">Start your journey</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
              <Link href="/community">
                <div className="flex items-center gap-3 p-4 rounded-xl border border-[#e8e4dc] hover:border-[#1a56db]/30 hover:bg-[#1a56db]/5 transition-all cursor-pointer group">
                  <Users className="w-8 h-8 text-[#1a56db] shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm text-foreground group-hover:text-[#1a56db]">Community</h4>
                    <p className="text-xs text-muted-foreground">Connect with peers</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
              <Link href="/coaching">
                <div className="flex items-center gap-3 p-4 rounded-xl border border-[#e8e4dc] hover:border-[#1a56db]/30 hover:bg-[#1a56db]/5 transition-all cursor-pointer group">
                  <Headphones className="w-8 h-8 text-[#1a56db] shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm text-foreground group-hover:text-[#1a56db]">Coaching Calls</h4>
                    <p className="text-xs text-muted-foreground">Get live guidance</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
              <Link href="/wins">
                <div className="flex items-center gap-3 p-4 rounded-xl border border-[#e8e4dc] hover:border-[#1a56db]/30 hover:bg-[#1a56db]/5 transition-all cursor-pointer group">
                  <Trophy className="w-8 h-8 text-[#1a56db] shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm text-foreground group-hover:text-[#1a56db]">Wall of Wins</h4>
                    <p className="text-xs text-muted-foreground">Celebrate success</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
              <Link href="/chat">
                <div className="flex items-center gap-3 p-4 rounded-xl border border-[#e8e4dc] hover:border-[#1a56db]/30 hover:bg-[#1a56db]/5 transition-all cursor-pointer group">
                  <MessageSquare className="w-8 h-8 text-[#1a56db] shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm text-foreground group-hover:text-[#1a56db]">AI Assistant</h4>
                    <p className="text-xs text-muted-foreground">Get instant help</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
              <Link href="/support">
                <div className="flex items-center gap-3 p-4 rounded-xl border border-[#e8e4dc] hover:border-[#1a56db]/30 hover:bg-[#1a56db]/5 transition-all cursor-pointer group">
                  <Rocket className="w-8 h-8 text-[#1a56db] shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm text-foreground group-hover:text-[#1a56db]">Support</h4>
                    <p className="text-xs text-muted-foreground">We're here for you</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
            </div>

            <div className="mt-8 text-center">
              <p className="text-muted-foreground leading-relaxed italic">
                "Roll up your sleeves and let's get to work! Remember, you can learn at your own pace, and if 
                there's anything you don't understand, or need clarification on, please ask away. Having access 
                to our amazing team to answer all of your questions is the most valuable part of this mentorship, 
                so don't be shy! Reach out whenever you need to!"
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="text-center text-xs text-muted-foreground/60 pb-8 space-y-2">
          <p className="font-semibold">
            "Helping You Make The Most Money Possible, So You Can Do The Things You Love To Do, 
            With The People You Love To Do Them With!"
          </p>
          <p className="mt-4 leading-relaxed max-w-3xl mx-auto">
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
