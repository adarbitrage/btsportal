import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { authFetch } from "@/lib/auth";
import {
  Rocket, Search, CalendarDays, Layers, Radio,
  BookOpen, ArrowRight, CheckCircle2, Circle
} from "lucide-react";

interface CourseItem {
  number: number;
  courseId: string;
  title: string;
  description: string;
  icon: typeof Rocket;
  ctaLabel: string;
  href: string;
}

const courses: CourseItem[] = [
  {
    number: 1,
    courseId: "quick-start",
    title: "The BTS Quick-Start Guide: Mastering Affiliate Arbitrage with the Build, Test, Scale Framework",
    description: "Your step-by-step roadmap to mastering affiliate arbitrage using the Build, Test, Scale framework. Whether you're just getting started or looking to refine your approach, this guide walks you through the exact process of launching and scaling profitable campaigns — from choosing high-converting offers to split-testing banners with Blaze\u2122 Ad Server and leveraging the Responsive Rolodex\u2122 for proven traffic. You'll also discover how to tap into our powerful support system, including the BTS Concierge\u2122 for done-for-you ad creation, live coaching calls with expert mentors, and the BTS Community for round-the-clock guidance.",
    icon: Rocket,
    ctaLabel: "HEAD TO THE QUICK-START GUIDE",
    href: "/core-training/quick-start",
  },
  {
    number: 2,
    courseId: "finding-your-edge",
    title: "Finding Your \"Edge\" In Affiliate Arbitrage",
    description: "This isn't just another training \u2014 it's a game-changer. Discover how to create an unbeatable advantage in the ultra-competitive world of affiliate marketing. Whether it's unlocking hidden traffic sources, leveraging cutting-edge tools, optimizing ad creatives, or perfecting landing pages, this training reveals the five critical ways top affiliates separate themselves from the pack. If you're ready to stop competing and start dominating, this is where it begins.",
    icon: Search,
    ctaLabel: "WATCH THE VIDEO TRAINING",
    href: "/training",
  },
  {
    number: 3,
    courseId: "21-day-blitz",
    title: "The Blitz\u2122",
    description: "An exclusive, behind-the-scenes video series that pulls back the curtain and shows you exactly how to build, test, and scale a high-converting affiliate campaign from scratch. Watch the Build, Test, Scale framework applied in real time \u2014 selecting an offer, crafting winning ad creatives, launching with proven traffic sources, optimizing for performance, and ultimately scaling to profitability. No theory, no fluff \u2014 just real campaigns, real data, and real results.",
    icon: CalendarDays,
    ctaLabel: "WATCH THE VIDEO TRAINING",
    href: "/training",
  },
  {
    number: 4,
    courseId: "live-coaching",
    title: "Live Group Calls: Join Us Live 6 Days/Week For Q&A!",
    description: "Join our seasoned coaches 6 days per week for Live Zoom Q&A Calls. These interactive sessions are your opportunity to get real-time answers, tackle challenges, and gain insights from experts who have mastered Direct Media Buying. Whether you need campaign advice, strategy tips, or clarity on course content, our coaches are here to ensure your success. Stay connected, stay supported, and take your skills to the next level!",
    icon: Radio,
    ctaLabel: "HOP ON A LIVE CALL WITH OUR COACHES",
    href: "/coaching",
  },
  {
    number: 5,
    courseId: "7-pillars",
    title: "The 7 Pillars\u2122 Of A Profitable Digital Business",
    description: "The ultimate roadmap to building a thriving online business. This comprehensive training dives deep into the core elements required to create, scale, and sustain a successful digital business. From the fundamentals of Affiliate Arbitrage to mastering email traffic and leveraging cutting-edge tools, this program equips you with everything you need to thrive. You'll discover the seven essential pillars that drive profitability: business model, market, demographic, traffic channel, strategy, edge, and commitment.",
    icon: Layers,
    ctaLabel: "HEAD TO THE 7 PILLARS",
    href: "/core-training/7-pillars",
  },
  {
    number: 6,
    courseId: "direct-edge",
    title: "The Direct Edge: Mastering the Art of High-Impact Media Buying",
    description: "Master the art of Direct Media Buying with expert-level guidance backed by $75 million+ in ad spend experience. Learn how to bypass intermediaries, secure premium placements, and create high-performing campaigns that deliver maximum ROI. From research and negotiation to scaling and optimization, you'll gain actionable strategies to build your Direct Media Buying empire \u2014 plus access exclusive bonuses including walkthroughs and troubleshooting guides.",
    icon: BookOpen,
    ctaLabel: "HEAD TO THE DIRECT EDGE",
    href: "/core-training/direct-edge",
  },
];

interface CourseProgressEntry {
  id: number;
  userId: number;
  courseId: string;
  completedAt: string;
}

export default function CoreTraining() {
  const [completedCourses, setCompletedCourses] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchProgress = useCallback(async () => {
    try {
      const res = await authFetch("/course-progress");
      if (res.ok) {
        const data: CourseProgressEntry[] = await res.json();
        setCompletedCourses(new Set(data.map((d) => d.courseId)));
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  const toggleComplete = async (courseId: string) => {
    setToggling(courseId);
    try {
      if (completedCourses.has(courseId)) {
        const res = await authFetch(`/course-progress/${courseId}`, { method: "DELETE" });
        if (res.ok) {
          setCompletedCourses((prev) => {
            const next = new Set(prev);
            next.delete(courseId);
            return next;
          });
        } else {
          await fetchProgress();
        }
      } else {
        const res = await authFetch("/course-progress", {
          method: "POST",
          body: JSON.stringify({ courseId }),
        });
        if (res.ok) {
          setCompletedCourses((prev) => new Set(prev).add(courseId));
        } else {
          await fetchProgress();
        }
      }
    } catch {
      await fetchProgress();
    } finally {
      setToggling(null);
    }
  };

  const completedCount = completedCourses.size;
  const totalCourses = courses.length;
  const progressPercent = Math.round((completedCount / totalCourses) * 100);

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">

        <div className="bg-[#1a56db] rounded-2xl p-6 sm:p-8 text-white text-center shadow-lg">
          <h1 className="text-3xl md:text-4xl font-bold font-['Roboto'] tracking-tight">
            Build Test Scale&trade; Training
          </h1>
        </div>

        {!loading && (
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">Your Progress</span>
                  {progressPercent === 100 && (
                    <span className="text-xs bg-green-100 text-green-700 font-bold px-2 py-0.5 rounded-full">
                      COMPLETE
                    </span>
                  )}
                </div>
                <span className="text-sm font-bold text-[#1a56db]">
                  {completedCount} / {totalCourses} courses
                </span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${progressPercent}%`,
                    background: progressPercent === 100
                      ? "linear-gradient(90deg, #2d8a4e, #34d399)"
                      : "linear-gradient(90deg, #1a56db, #3b82f6)",
                  }}
                />
              </div>
              <div className="flex justify-between mt-2">
                <span className="text-xs text-muted-foreground">{progressPercent}% complete</span>
                {progressPercent > 0 && progressPercent < 100 && (
                  <span className="text-xs text-muted-foreground">
                    {totalCourses - completedCount} remaining
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="text-center">
          <p className="text-muted-foreground italic font-medium">
            *For best results, progress through the training in the order presented below:
          </p>
        </div>

        <div className="space-y-6">
          {courses.map((course) => {
            const isComplete = completedCourses.has(course.courseId);
            const isToggling = toggling === course.courseId;

            return (
              <Card
                key={course.number}
                className={`border-border/60 shadow-sm overflow-hidden transition-all ${
                  isComplete ? "ring-2 ring-green-200 border-green-300" : ""
                }`}
              >
                <CardContent className="p-0">
                  <div className="flex flex-col md:flex-row">
                    <div className={`w-full md:w-44 shrink-0 border-b md:border-b-0 md:border-r border-[#e8e4dc] flex items-center justify-center p-8 relative ${
                      isComplete ? "bg-green-50" : "bg-[#faf9f7]"
                    }`}>
                      <div className={`w-20 h-20 rounded-2xl flex items-center justify-center ${
                        isComplete ? "bg-green-100" : "bg-[#1a56db]/10"
                      }`}>
                        {isComplete ? (
                          <CheckCircle2 className="w-10 h-10 text-green-600" />
                        ) : (
                          <course.icon className="w-10 h-10 text-[#1a56db]" />
                        )}
                      </div>
                    </div>

                    <div className="flex-1 p-6 md:p-8 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-lg font-bold text-foreground leading-snug">
                          {course.number}) {course.title}
                        </h3>
                      </div>

                      <p className="text-muted-foreground text-sm leading-relaxed">
                        {course.description}
                      </p>

                      <div className="flex flex-wrap items-center gap-3">
                        <Link href={course.href}>
                          <Button className="bg-[#2d8a4e] hover:bg-[#24713f] text-white font-semibold tracking-wide text-sm px-6">
                            <ArrowRight className="w-4 h-4 mr-2" />
                            {course.ctaLabel}
                          </Button>
                        </Link>

                        <button
                          onClick={() => toggleComplete(course.courseId)}
                          disabled={isToggling}
                          className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border transition-all ${
                            isComplete
                              ? "bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                              : "bg-white border-gray-200 text-muted-foreground hover:border-[#1a56db]/30 hover:text-[#1a56db]"
                          } ${isToggling ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          {isComplete ? (
                            <>
                              <CheckCircle2 className="w-4 h-4" />
                              Completed
                            </>
                          ) : (
                            <>
                              <Circle className="w-4 h-4" />
                              Mark as Complete
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
