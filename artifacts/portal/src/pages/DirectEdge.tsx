import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  BookOpen, ChevronDown, ChevronRight, PlayCircle,
  ArrowRight, Gift, Layers
} from "lucide-react";
import { useState } from "react";

interface Lesson {
  num: number;
  title: string;
  description: string;
}

interface Module {
  num: number | string;
  title: string;
  lessons: Lesson[];
  isBonus?: boolean;
}

const modules: Module[] = [
  {
    num: 1,
    title: "Why Direct Media Buying is the King of Advertising",
    lessons: [
      { num: 1, title: "What is Direct Media Buying?", description: "Discover the fundamentals, and why cutting out the middleman leads to better results." },
      { num: 2, title: "The $75 Million Journey with Direct Buys", description: "Over two decades of mastery and lessons learned in direct media buying." },
      { num: 3, title: "Direct vs. Programmatic: Why Direct Always Wins", description: "An in-depth comparison of these methods and the undeniable superiority of Direct Buys." },
    ],
  },
  {
    num: 2,
    title: "The Direct Media Buying Advantage",
    lessons: [
      { num: 1, title: "Guaranteed Inventory: Why Programmatic Can't Compete", description: "Learn the benefits of guaranteed placements and how it ensures campaign success." },
      { num: 2, title: "Build Publisher Relationships That Print Money", description: "Explore how to cultivate partnerships that unlock exclusive deals and opportunities." },
      { num: 3, title: "Customization Without Limits", description: "Discover how Direct Buys allow for tailored, high-impact campaigns." },
      { num: 4, title: "Proven Case Studies: Campaigns That Crushed It", description: "Real-world examples showcasing the power of Direct Media Buying." },
    ],
  },
  {
    num: 3,
    title: "How to Execute Direct Buys Like a Pro",
    lessons: [
      { num: 1, title: "Research Like a Million-Dollar Buyer", description: "Master tools and strategies to identify publishers that align with your goals." },
      { num: 2, title: "The Art of Negotiation: Getting the Best Deals", description: "Learn how to negotiate smartly to maximize your ad spend." },
      { num: 3, title: "Crafting the Perfect Request for Proposal (RFP)", description: "Step-by-step guidance to secure premium placements." },
      { num: 4, title: "Optimizing for Success", description: "Understand how to refine campaigns using data, tools, and rigorous testing." },
    ],
  },
  {
    num: 4,
    title: "Scaling Your Direct Media Empire",
    lessons: [
      { num: 1, title: "Expanding Across Publishers", description: "Strategies for scaling campaigns effectively and managing complexity." },
      { num: 2, title: "Nailing Multi-Publisher Coordination", description: "Best practices for managing campaigns across multiple publishers without losing control." },
      { num: 3, title: "Secrets to Long-Term Success", description: "Build a sustainable system to drive consistent results year after year." },
    ],
  },
  {
    num: 5,
    title: "Your Road to Direct Media Mastery",
    lessons: [
      { num: 1, title: "Becoming a Direct Media Buying Expert", description: "Tips and techniques to position yourself as a leader in the industry." },
      { num: 2, title: "Avoiding Pitfalls: Lessons Learned from $75M in Ad Spend", description: "Insights into common mistakes and how to sidestep them." },
      { num: 3, title: "Actionable Steps to Build Your Direct Media Buying Empire", description: "Concrete strategies to turn knowledge into action and scale your efforts." },
    ],
  },
  {
    num: "★",
    title: "The \"Responsive Rolodex™\"",
    isBonus: true,
    lessons: [
      { num: 1, title: "Tapping into the Responsive Rolodex", description: "Gain immediate access to a curated Rolodex of proven, high-performing publishers. Skip the hassle of brokering deals yourself and hit the ground running with trusted, ready-to-go direct traffic." },
    ],
  },
];

function ModuleAccordion({ module }: { module: Module }) {
  const [open, setOpen] = useState(false);
  const isBonus = module.isBonus;

  return (
    <Card className={`border-border/60 shadow-sm overflow-hidden ${isBonus ? "border-[#2d8a4e]/30" : ""}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-4 p-5 md:p-6 text-left hover:bg-muted/30 transition-colors"
      >
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isBonus ? "bg-[#2d8a4e]/10" : "bg-[#1a56db]/10"}`}>
          {isBonus ? (
            <Gift className="w-5 h-5 text-[#2d8a4e]" />
          ) : (
            <span className="text-sm font-bold text-[#1a56db]">{String(module.num)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {isBonus && (
            <span className="text-xs font-semibold uppercase tracking-widest text-[#2d8a4e] mb-1 block">
              Special Bonus
            </span>
          )}
          <h3 className="font-bold text-foreground text-base md:text-lg leading-snug">
            {!isBonus && `Module ${module.num}: `}{module.title}
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {module.lessons.length} {module.lessons.length === 1 ? "Lesson" : "Lessons"}
          </p>
        </div>
        {open ? (
          <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && (
        <div className="border-t border-border/60 bg-[#faf9f7]">
          {module.lessons.map((lesson) => (
            <div
              key={lesson.num}
              className="flex items-start gap-3 px-5 md:px-6 py-4 border-b border-border/40 last:border-b-0"
            >
              <PlayCircle className="w-5 h-5 text-[#1a56db] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-semibold text-foreground text-sm">
                  Lesson {lesson.num}: {lesson.title}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {lesson.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function DirectEdge() {
  const totalLessons = modules.reduce((sum, m) => sum + m.lessons.length, 0);

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">

        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-8 md:p-10 text-white shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            <div className="flex-1 space-y-3">
              <h1 className="text-3xl md:text-4xl font-bold font-['Roboto'] tracking-tight">
                The Direct Edge
              </h1>
              <p className="text-lg text-white/80">
                Mastering the Art of High-Impact Media Buying
              </p>
              <p className="text-white/60 text-sm leading-relaxed">
                Unlock the secrets to mastering Direct Media Buying. Discover how to bypass intermediaries, secure premium placements, and create ad campaigns that consistently outperform the competition. With over 20 years of experience and $75 million in ad spend behind this curriculum, this course reveals the insider strategies that drive success.
              </p>
            </div>
            <div className="shrink-0 bg-black/30 border border-white/10 rounded-xl p-6 text-center">
              <p className="text-3xl font-black tracking-tight">DIRECT EDGE</p>
              <div className="flex items-center justify-center gap-4 mt-3 text-sm text-white/60">
                <span className="flex items-center gap-1">
                  <Layers className="w-4 h-4" />
                  {modules.length} Modules
                </span>
                <span className="flex items-center gap-1">
                  <PlayCircle className="w-4 h-4" />
                  {totalLessons} Lessons
                </span>
              </div>
            </div>
          </div>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center shrink-0">
                <BookOpen className="w-5 h-5 text-[#1a56db]" />
              </div>
              <div className="space-y-2">
                <h2 className="font-bold text-foreground text-lg">About This Course</h2>
                <p className="text-muted-foreground leading-relaxed text-sm">
                  From foundational concepts to advanced scaling tactics, you'll learn how to research publishers, negotiate winning deals, craft high-performing campaigns, and optimize for maximum ROI. Whether you're a beginner or an experienced marketer, this course is designed to equip you with actionable steps to build your own Direct Media Buying empire.
                </p>
                <p className="text-muted-foreground leading-relaxed text-sm">
                  Plus, gain access to exclusive bonuses including over-the-shoulder walkthroughs, troubleshooting guides, and the Responsive Rolodex™ of high-performing publishers.
                </p>
                <p className="text-muted-foreground leading-relaxed text-sm font-medium text-foreground">
                  By the end of this course, you'll have the tools, confidence, and connections to dominate your niche and achieve unparalleled results.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[#1a56db]" />
            Course Modules
          </h2>
          {modules.map((mod, i) => (
            <ModuleAccordion key={i} module={mod} />
          ))}
        </div>

        <Card className="border-[#1a56db]/30 shadow-sm bg-gradient-to-br from-[#1a56db]/5 to-transparent">
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-col sm:flex-row gap-3">
              <Link href="/core-training">
                <Button variant="outline" className="gap-2">
                  <ArrowRight className="w-4 h-4 rotate-180" />
                  Back to Training
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  );
}
