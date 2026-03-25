import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Rocket, Search, CalendarDays, Layers, Radio,
  BookOpen, ArrowRight
} from "lucide-react";

interface CourseItem {
  number: number;
  title: string;
  description: string;
  icon: typeof Rocket;
  ctaLabel: string;
  href: string;
}

const courses: CourseItem[] = [
  {
    number: 1,
    title: "The BTS Quick-Start Guide: Mastering Affiliate Arbitrage with the Build, Test, Scale Framework",
    description: "Your step-by-step roadmap to mastering affiliate arbitrage using the Build, Test, Scale framework. Whether you're just getting started or looking to refine your approach, this guide walks you through the exact process of launching and scaling profitable campaigns — from choosing high-converting offers to split-testing banners with Blaze™ Ad Server and leveraging the Responsive Rolodex™ for proven traffic. You'll also discover how to tap into our powerful support system, including the BTS Concierge™ for done-for-you ad creation, live coaching calls with expert mentors, and the BTS Community for round-the-clock guidance.",
    icon: Rocket,
    ctaLabel: "HEAD TO THE QUICK-START GUIDE",
    href: "/training",
  },
  {
    number: 2,
    title: "Finding Your \"Edge\" In Affiliate Arbitrage",
    description: "This isn't just another training — it's a game-changer. Discover how to create an unbeatable advantage in the ultra-competitive world of affiliate marketing. Whether it's unlocking hidden traffic sources, leveraging cutting-edge tools, optimizing ad creatives, or perfecting landing pages, this training reveals the five critical ways top affiliates separate themselves from the pack. If you're ready to stop competing and start dominating, this is where it begins.",
    icon: Search,
    ctaLabel: "WATCH THE VIDEO TRAINING",
    href: "/training",
  },
  {
    number: 3,
    title: "The 21-Day Blitz™: 21 Days To Scale",
    description: "An exclusive, behind-the-scenes video series that pulls back the curtain and shows you exactly how to build, test, and scale a high-converting affiliate campaign from scratch. Over 21 days, you'll watch the Build, Test, Scale framework applied in real time — selecting an offer, crafting winning ad creatives, launching with proven traffic sources, optimizing for performance, and ultimately scaling to profitability. No theory, no fluff — just real campaigns, real data, and real results.",
    icon: CalendarDays,
    ctaLabel: "WATCH THE VIDEO TRAINING",
    href: "/training",
  },
  {
    number: 4,
    title: "Live Group Calls: Join Us Live 6 Days/Week For Q&A!",
    description: "Join our seasoned coaches 6 days per week for Live Zoom Q&A Calls. These interactive sessions are your opportunity to get real-time answers, tackle challenges, and gain insights from experts who have mastered Direct Media Buying. Whether you need campaign advice, strategy tips, or clarity on course content, our coaches are here to ensure your success. Stay connected, stay supported, and take your skills to the next level!",
    icon: Radio,
    ctaLabel: "HOP ON A LIVE CALL WITH OUR COACHES",
    href: "/coaching",
  },
  {
    number: 5,
    title: "The 7 Pillars™ Of A Profitable Digital Business",
    description: "The ultimate roadmap to building a thriving online business. This comprehensive training dives deep into the core elements required to create, scale, and sustain a successful digital business. From the fundamentals of Affiliate Arbitrage to mastering email traffic and leveraging cutting-edge tools, this program equips you with everything you need to thrive. You'll discover the seven essential pillars that drive profitability: business model, market, demographic, traffic channel, strategy, edge, and commitment.",
    icon: Layers,
    ctaLabel: "WATCH THE VIDEO TRAINING",
    href: "/training",
  },
  {
    number: 6,
    title: "The Direct Edge: Mastering the Art of High-Impact Media Buying",
    description: "Master the art of Direct Media Buying with expert-level guidance backed by $75 million+ in ad spend experience. Learn how to bypass intermediaries, secure premium placements, and create high-performing campaigns that deliver maximum ROI. From research and negotiation to scaling and optimization, you'll gain actionable strategies to build your Direct Media Buying empire — plus access exclusive bonuses including walkthroughs and troubleshooting guides.",
    icon: BookOpen,
    ctaLabel: "WATCH THE VIDEO TRAINING",
    href: "/training",
  },
];

export default function CoreTraining() {
  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">

        <div className="bg-[#1a56db] rounded-2xl p-8 text-white text-center shadow-lg">
          <h1 className="text-3xl md:text-4xl font-bold font-['Roboto'] tracking-tight">
            Build Test Scale™ Training
          </h1>
        </div>

        <div className="text-center">
          <p className="text-muted-foreground italic font-medium">
            *For best results, progress through the training in the order presented below:
          </p>
        </div>

        <div className="space-y-6">
          {courses.map((course) => (
            <Card key={course.number} className="border-border/60 shadow-sm overflow-hidden">
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row">
                  <div className="w-full md:w-44 shrink-0 bg-[#faf9f7] border-b md:border-b-0 md:border-r border-[#e8e4dc] flex items-center justify-center p-8">
                    <div className="w-20 h-20 rounded-2xl bg-[#1a56db]/10 flex items-center justify-center">
                      <course.icon className="w-10 h-10 text-[#1a56db]" />
                    </div>
                  </div>

                  <div className="flex-1 p-6 md:p-8 space-y-4">
                    <h3 className="text-lg font-bold text-foreground leading-snug">
                      {course.number}) {course.title}
                    </h3>

                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {course.description}
                    </p>

                    <Link href={course.href}>
                      <Button className="bg-[#2d8a4e] hover:bg-[#24713f] text-white font-semibold tracking-wide text-sm px-6">
                        <ArrowRight className="w-4 h-4 mr-2" />
                        {course.ctaLabel}
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
