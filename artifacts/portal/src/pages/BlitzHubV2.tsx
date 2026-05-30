import { useEffect, useState, useCallback, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, ArrowUpRight, Check } from "lucide-react";

type Phase = "intro" | "build" | "test" | "scale";
type Tag = { kind: "mm" | "cb" | "all" | "warn"; label: string };

interface HubLesson {
  id: number;
  phase: Phase;
  step: string;
  title: string;
  desc: React.ReactNode;
  tags?: Tag[];
  ctas: { label: string; section: string; secondary?: boolean }[];
}

const LESSONS: HubLesson[] = [
  {
    id: 1, phase: "intro", step: "Introduction",
    title: "What Is Affiliate Arbitrage?",
    desc: "Start here before anything else. This short video explains the business model behind The Blitz™ — how affiliate arbitrage works, and why the Build → Test → Scale framework makes it predictable and scalable. The Key Terms reference guide is also available for any unfamiliar affiliate marketing terms you encounter throughout the guide — bookmark it and use it as needed.",
    ctas: [
      { label: "Watch Video", section: "s1" },
      { label: "Key Terms Reference", section: "s1", secondary: true },
    ],
  },
  {
    id: 2, phase: "intro", step: "Before You Start",
    title: "Understand the System — The Three Phases, Your Budget, and the Phase Gates",
    desc: "Read this entire section before touching any technical setup. It covers how the three phases work, what your money is actually buying in the early rounds, realistic budget expectations including net cost after commissions, and the gates you must pass before advancing to the next phase.",
    ctas: [{ label: "Read Section", section: "s2" }],
  },
  {
    id: 3, phase: "build", step: "Phase 1 — Overview",
    title: "How Phase 1 Works — Campaign Architecture and Your Path",
    desc: "Read this before starting Product Selection. Start here to understand how all the tools and pieces fit together — the Campaign Architecture diagram (how Caterpillar, Flexy™, DIYTrax, and your affiliate network connect), the Path Decision Tree (which path you're on based on whether your product has a pre-built advertorial), and an orientation to the Phase 1 build sections. Work through the sections in order — understanding angles and creative direction in the Creative Assets lessons directly shapes everything you build afterward.",
    tags: [
      { kind: "mm", label: "Path A: Pre-built advertorial → MetricMover™" },
      { kind: "cb", label: "Path B: Jump page template → MetricMover™" },
    ],
    ctas: [{ label: "Go to Section", section: "s3" }],
  },
  {
    id: 4, phase: "build", step: "Phase 1 — Network Selection",
    title: "Choose Your Affiliate Network",
    desc: "Select the network you'll use to find and promote products. Media Mavens is recommended for first campaigns — pre-built advertorials, no chargebacks, higher commissions. Affiliati and MaxWeb require proof of prior affiliate revenue — check with your coach before applying to either.",
    tags: [
      { kind: "mm", label: "Media Mavens ⭐ Recommended" },
      { kind: "cb", label: "ClickBank · MaxWeb · Affiliati" },
    ],
    ctas: [{ label: "Go to Section", section: "s4" }],
  },
  {
    id: 5, phase: "build", step: "Phase 1 — Product Selection",
    title: "Select Your Offer and Get Your Affiliate Link",
    desc: "Choose the specific product you'll promote within your network. Save your unique affiliate tracking link. For ClickBank and MaxWeb, confirm the product's sales page URL — you'll refer to it when writing your jump page body copy.",
    tags: [
      { kind: "mm", label: "MM: Look for products with pre-built advertorial" },
      { kind: "cb", label: "CB/MW: Confirm jump page path applies" },
    ],
    ctas: [{ label: "Go to Section", section: "s5" }],
  },
  {
    id: 6, phase: "build", step: "Phase 1 — Creative Assets",
    title: "Understanding Creative Assets — The Foundation of Your Campaign",
    desc: (
      <>
        Before creating anything, understand what you're actually testing and why. This lesson covers the <strong>Two-Headline Concept</strong> (ad headlines vs landing page headlines and their different jobs), what an angle is, and why every headline and image you create is an angle hypothesis. The angles section includes a table showing how angles play out across all four asset types.
      </>
    ),
    ctas: [{ label: "Go to Section", section: "s6" }],
  },
  {
    id: 7, phase: "build", step: "Phase 1 — Creative Assets",
    title: "Create Your Native Ad Assets",
    desc: "Create the three assets that make up your Caterpillar ad: 10 headlines (max 90 characters each), 1 description, and 1 static image (16:9, min 960×540px). Covers using FreeAdCopy™ to generate headlines, what makes a strong ad image, and the optional dynamic macro codes for personalization.",
    tags: [
      { kind: "all", label: "10 Headlines · 1 Description · 1 Image" },
    ],
    ctas: [{ label: "Go to Section", section: "s6b" }],
  },
  {
    id: 8, phase: "build", step: "Phase 1 — Creative Assets",
    title: "Create Your Landing Page Assets — Media Mavens",
    desc: (
      <>
        For Media Mavens: generate 5 landing page headlines using AffAngleArchitect and Copy Blocks, then source 5 hero shot images. These 5 headlines × 5 hero shots = 25 combinations that MetricMover™ will create automatically in the next step. <em>Skip this lesson if you're using a ClickBank, MaxWeb, or Affiliati (jump page) offer — go to the next lesson instead.</em>
      </>
    ),
    tags: [
      { kind: "mm", label: "5 LP Headlines + 5 Hero Shots = 25 combinations" },
    ],
    ctas: [{ label: "Go to Section", section: "s6c" }],
  },
  {
    id: 9, phase: "build", step: "Phase 1 — Creative Assets",
    title: "Create Your Landing Page Assets — ClickBank",
    desc: "For ClickBank, MaxWeb, and Affiliati (jump page): download the product VSL using DownloadHelper, transcribe it using Temi, then use the Bridge Page Copy Bot to write your jump page body copy. Then follow the same process as Media Mavens — generate 5 LP headlines and 5 hero shots for MetricMover™.",
    tags: [
      { kind: "cb", label: "VSL → Transcript → Body Copy → 5 Headlines + 5 Hero Shots" },
    ],
    ctas: [{ label: "Go to Section", section: "s6d" }],
  },
  {
    id: 10, phase: "build", step: "Phase 1 — Compliance",
    title: "Submit Your Assets for Compliance Review",
    desc: "Before building any pages, submit your headlines, images, and landing page assets to BTS for compliance review. Typical turnaround is 24–48 hours. You may begin Flexy™ setup while waiting, but do not go live until approval is confirmed.",
    tags: [{ kind: "warn", label: "Do not go live until compliance is confirmed" }],
    ctas: [{ label: "Go to Section", section: "s7" }],
  },
  {
    id: 11, phase: "build", step: "Phase 1 — Flexy™ Setup",
    title: "Setting Up Your Website in Flexy™",
    desc: "Clone the pre-built Flexy™ website template into your account, connect a custom domain, and learn how to duplicate individual pages within your site. This is the universal setup everyone completes before moving on to MetricMover™ — regardless of whether you're on the Media Mavens or ClickBank/MaxWeb path.",
    tags: [
      { kind: "all", label: "Universal — Everyone Does This First" },
      { kind: "all", label: "Ends with: Clone Page Into Any Website" },
    ],
    ctas: [{ label: "Go to Section", section: "s8" }],
  },
  {
    id: 12, phase: "build", step: "Phase 1 — MetricMover™",
    title: "Using MetricMover™",
    desc: "Turn your 5 landing page headlines and 5 hero shots into 25 trackable landing page combinations. The MetricMover™ process is identical for every path — follow MM1–MM5 to set up your project, add your headline and hero shot variants, build your Flexy™ landing page with the embed code, and upload all 25 variants to DIYTrax. (ClickBank / MaxWeb jump page customization is handled earlier in the Landing Page Assets lesson.)",
    tags: [
      { kind: "all", label: "MM1–MM5 Video Series" },
      { kind: "all", label: "Same process for every path" },
    ],
    ctas: [{ label: "Go to Section", section: "s8b" }],
  },
  {
    id: 13, phase: "build", step: "Phase 1 — DIYTrax Setup",
    title: "Set Up DIYTrax",
    desc: "Configure your campaign tracking system. Create your Campaign Placeholder to generate your tracking link, set up IPN integration if using ClickBank, embed your offer link in landing pages, and import your MetricMover™ page variants. DIYTrax connects every part of your campaign and records which combinations generate sales.",
    tags: [
      { kind: "cb", label: "ClickBank: IPN integration required" },
      { kind: "all", label: "Complete 5-step setup sequence in order" },
    ],
    ctas: [{ label: "Go to Section", section: "s9" }],
  },
  {
    id: 14, phase: "build", step: "Phase 1 — Go Live",
    title: "Configure Caterpillar and Go Live",
    desc: "Create your campaign in Caterpillar, upload all 10 ad headlines across 2 sub-campaigns of 5 each, upload your ad image, fund your account with at least $500, and complete the pre-launch checklist before activating. Watch T1–T9 in order.",
    tags: [
      { kind: "all", label: "T1–T9 Video Series" },
      { kind: "all", label: "2 Sub-Campaigns × 5 headlines" },
      { kind: "warn", label: "Complete pre-launch checklist before going live" },
    ],
    ctas: [{ label: "Go to Section", section: "s10" }],
  },
  {
    id: 15, phase: "test", step: "Testing — Getting Started",
    title: "Find Your Winners Through Data",
    desc: "Read this before launching Round 1. Phase 2 is where your campaign gets smarter — most mentees go through multiple rounds before reaching profitability, and that's the process working as designed. Learn the daily monitoring routine (conversions → ad CTR → landing page CTR) and set up your P&L Tracker so every round produces clean data for the next one.",
    ctas: [{ label: "Go to Phase 2 Overview", section: "s11" }],
  },
  {
    id: 16, phase: "test", step: "Round 1 · Min. $500",
    title: "Find Your Top Performing Headline",
    desc: "Run all 10 ads and monitor performance daily. At $25/ad: cut any ad with 33+ clicks but zero landing page clicks. At $500 total: identify the headline with the strongest metrics. Expect ~20% ROAS — you are buying data, not revenue.",
    tags: [{ kind: "all", label: "Target: ~$100 returned (20% ROAS)" }],
    ctas: [{ label: "Go to Round 1", section: "s12" }],
  },
  {
    id: 17, phase: "test", step: "Between Rounds 1 and 2",
    title: "Prepare Additional Static Images While Round 1 Runs",
    desc: "While Round 1 is running, prepare your Round 2 assets. Create 9 new static images in 16:9 format using AI tools. These will compete against your original Round 1 image in Round 2. MM/CB path: also prepare 5 new landing page headlines, 5 new hero shots, and set up a new MetricMover™ project.",
    ctas: [{ label: "Go to Between Rounds", section: "s13" }],
  },
  {
    id: 18, phase: "test", step: "Round 2 · Min. $500",
    title: "Find Your Top Performing Visual Creative",
    desc: "Run 10 static images in 16:9 format — your original plus 9 new ones — all using your Round 1 top performing headline. Identify which visual generates the best return. Target approximately 75% ROAS before advancing to Round 3.",
    tags: [
      { kind: "all", label: "Target: ~$375 returned (75% ROAS)" },
      { kind: "all", label: "All creatives 16:9 static format" },
    ],
    ctas: [{ label: "Go to Round 2", section: "s14" }],
  },
  {
    id: 19, phase: "test", step: "Between Rounds 2 and 3",
    title: "Prepare Your Round 3 Placement Format Assets",
    desc: "Take your Round 2 top performing creative and convert it into all 6 placement formats: 16:9 static image, 9:16 static image, 16:9 GIF, 9:16 GIF, 16:9 video, and 9:16 video. Use Cropbot, Adobe Express, and GIFSTER as needed.",
    ctas: [{ label: "Go to Between Rounds", section: "s15" }],
  },
  {
    id: 20, phase: "test", step: "Round 3 · Min. $1,000",
    title: "Find Your Top Performing Placement Format",
    desc: "Run all 6 placement formats as 6 separate sub-campaigns — one format per sub-campaign, as required by the publisher. Identify which placement format generates the best return. Earning ~$600 on $1,000 means you're closing in on profitability — continue refining until the campaign generates a positive return.",
    tags: [
      { kind: "all", label: "Target: ~$600 returned (60% ROAS)" },
      { kind: "warn", label: "1 placement format per sub-campaign — publisher requirement" },
    ],
    ctas: [{ label: "Go to Round 3", section: "s16" }],
  },
  {
    id: 21, phase: "scale", step: "Method 1",
    title: "Increase Budget on Your Top Performing Placement",
    desc: "Remove non-profitable ads and increase your daily budget 2× on your top performing placement. If ROAS stays stable after 3–5 days, increase to 5×, then 10×. Monitor daily — stop scaling a placement if ROAS declines for 5+ consecutive days.",
    tags: [{ kind: "warn", label: "Only enter Phase 3 once Phase 2 is profitable" }],
    ctas: [{ label: "Go to Scale Module", section: "s17" }],
  },
  {
    id: 22, phase: "scale", step: "Method 2",
    title: "Test New Placements and Publishers",
    desc: "Use your proven ads and landing pages on Grasshopper or Crane publishers — no new creative required. Minimum $1,500 per new placement. See the Grasshopper and Crane Supplemental Guides for setup instructions.",
    ctas: [{ label: "Go to Scale Module", section: "s18" }],
  },
  {
    id: 23, phase: "scale", step: "Method 3",
    title: "Master Publisher",
    desc: "A dedicated email blast to a large subscriber list — dramatically higher reach than native or banner ads. Only available after 14+ consecutive profitable days. Requires a single best headline, image, and landing page. Discuss with your coach before pursuing.",
    tags: [
      { kind: "warn", label: "14+ consecutive profitable days required" },
      { kind: "warn", label: "Coach approval required" },
    ],
    ctas: [{ label: "Go to Scale Module", section: "s19" }],
  },
];

const TOTAL = LESSONS.length;
const STEP_COURSE_PREFIX = "blitzv2-hub-step-v2-";
const API_BASE = `${import.meta.env.BASE_URL}api`;
const GUIDE_BASE = `${import.meta.env.BASE_URL}blitzv2/guide`;

type PhaseTint = {
  iconBg: string;
  iconBorder: string;
  iconText: string;
  accent: string;
  btn: string;
  pillBg: string;
  pillBorder: string;
  pillText: string;
  numBg: string;
  numBorder: string;
  numText: string;
};

const PHASE_TINT: Record<Phase, PhaseTint> = {
  intro: {
    iconBg: "bg-slate-50", iconBorder: "border-slate-200", iconText: "text-slate-600",
    accent: "bg-slate-400", btn: "bg-slate-600 hover:bg-slate-700",
    pillBg: "bg-slate-50", pillBorder: "border-slate-200", pillText: "text-slate-600",
    numBg: "bg-background", numBorder: "border-slate-200", numText: "text-slate-600",
  },
  build: {
    iconBg: "bg-[#188f4a]", iconBorder: "border-[#136b38]", iconText: "text-white",
    accent: "bg-[#188f4a]", btn: "bg-[#188f4a] hover:bg-[#136b38]",
    pillBg: "bg-[#188f4a]", pillBorder: "border-[#136b38]", pillText: "text-white",
    numBg: "bg-white", numBorder: "border-[#136b38]", numText: "text-[#188f4a]",
  },
  test: {
    iconBg: "bg-[#cf550a]", iconBorder: "border-[#a03f07]", iconText: "text-white",
    accent: "bg-[#cf550a]", btn: "bg-[#cf550a] hover:bg-[#a03f07]",
    pillBg: "bg-[#cf550a]", pillBorder: "border-[#a03f07]", pillText: "text-white",
    numBg: "bg-white", numBorder: "border-[#a03f07]", numText: "text-[#cf550a]",
  },
  scale: {
    iconBg: "bg-[#7f2ac9]", iconBorder: "border-[#641f9e]", iconText: "text-white",
    accent: "bg-[#7f2ac9]", btn: "bg-[#7f2ac9] hover:bg-[#641f9e]",
    pillBg: "bg-[#7f2ac9]", pillBorder: "border-[#641f9e]", pillText: "text-white",
    numBg: "bg-white", numBorder: "border-[#641f9e]", numText: "text-[#7f2ac9]",
  },
};

const TAG_TINT: Record<Tag["kind"], string> = {
  mm: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cb: "bg-amber-50 text-amber-700 border-amber-200",
  all: "bg-blue-50 text-blue-700 border-blue-200",
  warn: "bg-red-50 text-red-700 border-red-200",
};

interface ProgressEntry {
  courseId: string;
}

export default function BlitzHubV2() {
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState<Set<number>>(new Set());

  // Hydrate from server on mount.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/course-progress`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ProgressEntry[]) => {
        if (cancelled) return;
        const next = new Set<number>();
        for (const row of rows ?? []) {
          const m = row.courseId?.match(/^blitzv2-hub-step-v2-(\d+)$/);
          if (m) next.add(Number(m[1]));
        }
        setCompleted(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setBusy = useCallback((id: number, busy: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleComplete = useCallback(
    async (id: number) => {
      const courseId = `${STEP_COURSE_PREFIX}${id}`;
      const wasCompleted = completed.has(id);
      // Optimistic update
      setCompleted((prev) => {
        const next = new Set(prev);
        if (wasCompleted) next.delete(id);
        else next.add(id);
        return next;
      });
      setBusy(id, true);
      try {
        if (wasCompleted) {
          const res = await fetch(
            `${API_BASE}/course-progress/${courseId}`,
            { method: "DELETE", credentials: "include" },
          );
          if (!res.ok) throw new Error("delete failed");
        } else {
          const res = await fetch(`${API_BASE}/course-progress`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courseId }),
          });
          if (!res.ok) throw new Error("post failed");
        }
      } catch {
        // Roll back on failure
        setCompleted((prev) => {
          const next = new Set(prev);
          if (wasCompleted) next.add(id);
          else next.delete(id);
          return next;
        });
      } finally {
        setBusy(id, false);
      }
    },
    [completed, setBusy],
  );

  const resetProgress = useCallback(async () => {
    if (!window.confirm("Reset all progress? This cannot be undone.")) return;
    const previous = new Set(completed);
    const ids = Array.from(previous);
    setCompleted(new Set());
    await Promise.all(
      ids.map((id) =>
        fetch(`${API_BASE}/course-progress/${STEP_COURSE_PREFIX}${id}`, {
          method: "DELETE",
          credentials: "include",
        }).catch(() => null),
      ),
    );
    // Reconcile with server in case any DELETE failed.
    try {
      const res = await fetch(`${API_BASE}/course-progress`, {
        credentials: "include",
      });
      if (res.ok) {
        const rows: ProgressEntry[] = await res.json();
        const next = new Set<number>();
        for (const row of rows ?? []) {
          const m = row.courseId?.match(/^blitzv2-hub-step-v2-(\d+)$/);
          if (m) next.add(Number(m[1]));
        }
        setCompleted(next);
      } else {
        setCompleted(previous);
      }
    } catch {
      setCompleted(previous);
    }
  }, [completed]);

  const doneCount = completed.size;
  const pct = Math.round((doneCount / TOTAL) * 100);

  const grouped = useMemo(() => {
    const intro = LESSONS.filter((l) => l.phase === "intro");
    const build = LESSONS.filter((l) => l.phase === "build");
    const test = LESSONS.filter((l) => l.phase === "test");
    const scale = LESSONS.filter((l) => l.phase === "scale");
    return { intro, build, test, scale };
  }, []);

  const phaseGroups = [
    { key: "intro" as const, label: "Introduction", num: "✦", items: grouped.intro },
    { key: "build" as const, label: "Phase 1 — Build", items: grouped.build },
    { key: "test" as const, label: "Phase 2 — Test", items: grouped.test },
    { key: "scale" as const, label: "Phase 3 — Scale", items: grouped.scale },
  ];

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">The Blitz™</h1>
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Caterpillar Edition
            <span className="mx-2.5 text-border font-normal" aria-hidden="true">|</span>
            Build · Test · Scale
            <span className="mx-2.5 text-border font-normal" aria-hidden="true">|</span>
            V4.0 (Released April 21, 2026)
          </p>
          <p className="text-muted-foreground max-w-3xl leading-relaxed">
            A <strong className="text-foreground font-semibold">proven, step-by-step system</strong> for
            launching profitable affiliate marketing campaigns. Work through each module in order, make
            decisions based on data, and the results will follow.
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Your Progress
              </span>
              <span className="text-sm font-semibold text-foreground">
                {doneCount} / {TOTAL} Complete
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 text-right text-xs text-muted-foreground">{pct}% complete</div>
          </CardContent>
        </Card>

        {phaseGroups.map((group) => (
          <div key={group.key}>
            <PhaseDivider
              phase={group.key}
              label={group.label}
              num={"num" in group ? group.num : undefined}
            />
            <div className="space-y-3">
              {group.items.map((l) => (
                <LessonCard
                  key={l.id}
                  lesson={l}
                  completed={completed.has(l.id)}
                  busy={pending.has(l.id)}
                  onToggle={() => toggleComplete(l.id)}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="text-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={resetProgress}
            disabled={doneCount === 0}
          >
            Reset Progress
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground pt-2">
          The Blitz™ — Caterpillar Edition · BTS · v4.0
        </p>
      </div>
    </AppLayout>
  );
}

function PhaseDivider({
  phase,
  label,
  num,
}: {
  phase: Phase;
  label: string;
  num?: string;
}) {
  const tint = PHASE_TINT[phase];
  return (
    <div className="flex items-center gap-3 mb-4">
      <div
        className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 ${tint.pillBg} ${tint.pillBorder} ${tint.pillText}`}
      >
        {num && (
          <span
            className={`flex items-center justify-center w-5 h-5 rounded-full border text-[0.7rem] font-bold ${tint.numBg} ${tint.numBorder} ${tint.numText}`}
          >
            {num}
          </span>
        )}
        <span className={`text-sm font-semibold tracking-wide ${num ? "" : "uppercase"}`}>
          {label}
        </span>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function LessonCard({
  lesson,
  completed,
  busy,
  onToggle,
}: {
  lesson: HubLesson;
  completed: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const tint = PHASE_TINT[lesson.phase];
  return (
    <Card
      className={`overflow-hidden border shadow-sm transition-shadow hover:shadow-md ${
        completed ? "border-emerald-200 bg-emerald-50/40" : "border-border/60"
      }`}
    >
      <div className="flex">
        <div className={`w-1 shrink-0 ${completed ? "bg-emerald-500" : tint.accent}`} />
        <CardContent className="flex items-start gap-4 p-5 flex-1 min-w-0">
          <div
            className={`flex items-center justify-center w-10 h-10 rounded-xl border shrink-0 text-base font-bold ${
              completed
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : `${tint.iconBg} ${tint.iconBorder} ${tint.iconText}`
            }`}
          >
            {completed ? <Check className="w-5 h-5" /> : lesson.id}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              {lesson.step}
            </p>
            <h3 className="font-bold text-foreground leading-snug mb-1.5">{lesson.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">{lesson.desc}</p>
            {lesson.tags && lesson.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {lesson.tags.map((t, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${TAG_TINT[t.kind]}`}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {lesson.ctas.map((cta, i) => (
                <Button
                  key={i}
                  asChild
                  size="sm"
                  className={`text-white ${cta.secondary ? "bg-slate-600 hover:bg-slate-700" : tint.btn}`}
                >
                  <a href={`${GUIDE_BASE}/${lesson.id}${i > 0 ? `#${cta.section}` : ""}`}>
                    {cta.label}
                    <ArrowUpRight className="w-4 h-4 ml-1.5" />
                  </a>
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={onToggle}
                disabled={busy}
                className={completed ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50" : ""}
              >
                <Check className="w-4 h-4 mr-1.5" />
                {completed ? "Completed" : "Mark as Complete"}
              </Button>
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}
