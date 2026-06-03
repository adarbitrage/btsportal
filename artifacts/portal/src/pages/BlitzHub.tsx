import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, ArrowUpRight, Check, Lock } from "lucide-react";
import {
  BLITZ_SECTIONS,
  BLITZ_SECTION_COUNT,
  buildBlitzCourseId,
  blitzLessonIdFromCourseId,
  type BlitzPhaseKey,
} from "@workspace/blitz-curriculum";

type Phase = BlitzPhaseKey;
type Tag = { kind: "mm" | "cb" | "all" | "warn"; label: string };

// Surface-specific lesson presentation (long description + path tags). The
// curriculum skeleton (id, phase, step, title, guide anchor) is the shared
// source of truth in @workspace/blitz-curriculum; this map is keyed by that id.
interface HubLessonContent {
  desc: React.ReactNode;
  tags?: Tag[];
}

interface HubLesson {
  id: number;
  phase: Phase;
  step: string;
  title: string;
  desc: React.ReactNode;
  tags?: Tag[];
  ctas: { label: string; section: string; secondary?: boolean }[];
}

export const LESSON_CONTENT: Record<number, HubLessonContent> = {
  1: {
    desc: "Start here before anything else. This short video explains the business model behind The Blitz™ — how affiliate arbitrage works, and why the Build → Test → Scale framework makes it predictable and scalable. The Key Terms reference guide is also available for any unfamiliar affiliate marketing terms you encounter throughout the guide — bookmark it and use it as needed.",
  },
  2: {
    desc: "Read this entire section before touching any technical setup. It covers how the three phases work, what your money is actually buying in the early rounds, realistic budget expectations including net cost after commissions, and the gates you must pass before advancing to the next phase.",
  },
  3: {
    desc: "Read this before starting Product Selection. Start here to understand how all the tools and pieces fit together — the Campaign Architecture diagram (how Caterpillar, Flexy™, DIYTrax, and your affiliate network connect), the Path Decision Tree (which path you're on based on whether your product has a pre-built advertorial), and an orientation to the Phase 1 build sections. Work through the sections in order — understanding angles and creative direction in the Creative Assets lessons directly shapes everything you build afterward.",
    tags: [
      { kind: "mm", label: "Path A: Pre-built advertorial → MetricMover™" },
      { kind: "cb", label: "Path B: Jump page template → MetricMover™" },
    ],
  },
  4: {
    desc: "Select the network you'll use to find and promote products. Media Mavens is recommended for first campaigns — pre-built advertorials, no chargebacks, higher commissions. ClickBank is a large public marketplace with instant signup.",
    tags: [
      { kind: "mm", label: "Media Mavens ⭐ Recommended" },
      { kind: "cb", label: "ClickBank" },
    ],
  },
  5: {
    desc: "Choose the specific product you'll promote within your network. Save your unique affiliate tracking link. For ClickBank, confirm the product's sales page URL — you'll refer to it when writing your jump page body copy.",
    tags: [
      { kind: "mm", label: "MM: Look for products with pre-built advertorial" },
      { kind: "cb", label: "CB: Confirm jump page path applies" },
    ],
  },
  6: {
    desc: (
      <>
        Before creating anything, understand what you're actually testing and why. This lesson covers the <strong>Two-Headline Concept</strong> (ad headlines vs landing page headlines and their different jobs), what an angle is, and why every headline and image you create is an angle hypothesis. The angles section includes a table showing how angles play out across all four asset types.
      </>
    ),
  },
  7: {
    desc: "Create the three assets that make up your Caterpillar ad: 10 headlines (max 90 characters each), 1 description, and 1 static image (16:9, min 960×540px). Covers using FreeAdCopy™ to generate headlines, what makes a strong ad image, and the optional dynamic macro codes for personalization.",
    tags: [
      { kind: "all", label: "10 Headlines · 1 Description · 1 Image" },
    ],
  },
  8: {
    desc: (
      <>
        For Media Mavens: generate 5 landing page headlines using AffAngleArchitect and Copy Blocks, then source 5 hero shot images. These 5 headlines × 5 hero shots = 25 combinations that MetricMover™ will create automatically in the next step. <em>Skip this lesson if you're using a ClickBank (jump page) offer — go to the next lesson instead.</em>
      </>
    ),
    tags: [
      { kind: "mm", label: "5 LP Headlines + 5 Hero Shots = 25 combinations" },
    ],
  },
  9: {
    desc: "For ClickBank (jump page): download the product VSL using DownloadHelper, transcribe it using Temi, then use the Bridge Page Copy Bot to write your jump page body copy. Then follow the same process as Media Mavens — generate 5 LP headlines and 5 hero shots for MetricMover™.",
    tags: [
      { kind: "cb", label: "VSL → Transcript → Body Copy → 5 Headlines + 5 Hero Shots" },
    ],
  },
  10: {
    desc: "Before building any pages, submit your headlines, images, and landing page assets to BTS for compliance review. Typical turnaround is 24–48 hours. You may begin Flexy™ setup while waiting, but do not go live until approval is confirmed.",
    tags: [{ kind: "warn", label: "Do not go live until compliance is confirmed" }],
  },
  11: {
    desc: "Clone the pre-built Flexy™ website template into your account, connect a custom domain, and learn how to duplicate individual pages within your site. This is the universal setup everyone completes before moving on to MetricMover™ — regardless of whether you're on the Media Mavens or ClickBank path.",
    tags: [
      { kind: "all", label: "Universal — Everyone Does This First" },
      { kind: "all", label: "Ends with: Clone Page Into Any Website" },
    ],
  },
  12: {
    desc: "Turn your 5 landing page headlines and 5 hero shots into 25 trackable landing page combinations. The MetricMover™ process is identical for every path — follow MM1–MM5 to set up your project, add your headline and hero shot variants, build your Flexy™ landing page with the embed code, and upload all 25 variants to DIYTrax. (ClickBank jump page customization is handled earlier in the Landing Page Assets lesson.)",
    tags: [
      { kind: "all", label: "MM1–MM5 Video Series" },
      { kind: "all", label: "Same process for every path" },
    ],
  },
  13: {
    desc: "Configure your campaign tracking system. Create your Campaign Placeholder to generate your tracking link, set up IPN integration if using ClickBank, embed your offer link in landing pages, and import your MetricMover™ page variants. DIYTrax connects every part of your campaign and records which combinations generate sales.",
    tags: [
      { kind: "cb", label: "ClickBank: IPN integration required" },
      { kind: "all", label: "Complete 5-step setup sequence in order" },
    ],
  },
  14: {
    desc: "Create your campaign in Caterpillar, upload all 10 ad headlines across 2 sub-campaigns of 5 each, upload your ad image, fund your account with at least $500, and complete the pre-launch checklist before activating. Watch T1–T9 in order.",
    tags: [
      { kind: "all", label: "T1–T9 Video Series" },
      { kind: "all", label: "2 Sub-Campaigns × 5 headlines" },
      { kind: "warn", label: "Complete pre-launch checklist before going live" },
    ],
  },
  15: {
    desc: "Read this before launching Round 1. Phase 2 is where your campaign gets smarter — most mentees go through multiple rounds before reaching profitability, and that's the process working as designed. Learn the daily monitoring routine (conversions → ad CTR → landing page CTR) and set up your P&L Tracker so every round produces clean data for the next one.",
  },
  16: {
    desc: "Run all 10 ads and monitor performance daily. At $25/ad: cut any ad with 33+ clicks but zero landing page clicks. At $500 total: identify the headline with the strongest metrics. Expect ~20% ROAS — you are buying data, not revenue.",
    tags: [{ kind: "all", label: "Target: ~$100 returned (20% ROAS)" }],
  },
  17: {
    desc: "While Round 1 is running, prepare your Round 2 assets. Create 9 new static images in 16:9 format using AI tools. These will compete against your original Round 1 image in Round 2. MM/CB path: also prepare 5 new landing page headlines, 5 new hero shots, and set up a new MetricMover™ project.",
  },
  18: {
    desc: "Run 10 static images in 16:9 format — your original plus 9 new ones — all using your Round 1 top performing headline. Identify which visual generates the best return. Target approximately 75% ROAS before advancing to Round 3.",
    tags: [
      { kind: "all", label: "Target: ~$375 returned (75% ROAS)" },
      { kind: "all", label: "All creatives 16:9 static format" },
    ],
  },
  19: {
    desc: "Take your Round 2 top performing creative and convert it into all 6 placement formats: 16:9 static image, 9:16 static image, 16:9 GIF, 9:16 GIF, 16:9 video, and 9:16 video. Use Cropbot, Adobe Express, and GIFSTER as needed.",
  },
  20: {
    desc: "Run all 6 placement formats as 6 separate sub-campaigns — one format per sub-campaign, as required by the publisher. Identify which placement format generates the best return. Earning ~$600 on $1,000 means you're closing in on profitability — continue refining until the campaign generates a positive return.",
    tags: [
      { kind: "all", label: "Target: ~$600 returned (60% ROAS)" },
      { kind: "warn", label: "1 placement format per sub-campaign — publisher requirement" },
    ],
  },
  21: {
    desc: "Remove non-profitable ads and increase your daily budget 2× on your top performing placement. If ROAS stays stable after 3–5 days, increase to 5×, then 10×. Monitor daily — stop scaling a placement if ROAS declines for 5+ consecutive days.",
    tags: [{ kind: "warn", label: "Only enter Phase 3 once Phase 2 is profitable" }],
  },
  22: {
    desc: "Use your proven ads and landing pages on Grasshopper or Crane publishers — no new creative required. Minimum $1,500 per new placement. See the Grasshopper and Crane Supplemental Guides for setup instructions.",
  },
  23: {
    desc: "A dedicated email blast to a large subscriber list — dramatically higher reach than native or banner ads. Only available after 14+ consecutive profitable days. Requires a single best headline, image, and landing page. Discuss with your coach before pursuing.",
    tags: [
      { kind: "warn", label: "14+ consecutive profitable days required" },
      { kind: "warn", label: "Coach approval required" },
    ],
  },
};

// Compose the rendered lesson list from the shared curriculum skeleton + the
// local presentation map. Every step links to its guide section anchor.
const LESSONS: HubLesson[] = BLITZ_SECTIONS.map((section) => {
  const content = LESSON_CONTENT[section.id] ?? { desc: "" };
  return {
    id: section.id,
    phase: section.phase,
    step: section.step,
    title: section.title,
    desc: content.desc,
    tags: content.tags,
    ctas: [{ label: "Go to Section", section: section.sectionAnchor }],
  };
});

const TOTAL = BLITZ_SECTION_COUNT;
const API_BASE = `${import.meta.env.BASE_URL}api`;

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
    iconBg: "bg-slate-600", iconBorder: "border-slate-700", iconText: "text-white",
    accent: "bg-slate-600", btn: "bg-slate-600 hover:bg-slate-700",
    pillBg: "bg-slate-600", pillBorder: "border-slate-700", pillText: "text-white",
    numBg: "bg-white", numBorder: "border-slate-700", numText: "text-slate-600",
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

interface PhaseStatusEntry {
  slug: string;
  name: string;
  sortOrder: number;
  color: string;
  totalLessons: number;
  completedLessons: number;
  completionPct: number;
  unlocked: boolean;
}

export default function BlitzHub() {
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [phaseStatus, setPhaseStatus] = useState<PhaseStatusEntry[]>([]);
  const [adminOverride, setAdminOverride] = useState(false);
  const [phaseStatusLoaded, setPhaseStatusLoaded] = useState(false);

  // Tracks last time a viewed event was sent per lesson (rate-limit: 1/min).
  const lastViewedAt = useRef<Map<number, number>>(new Map());

  // Hydrate progress from server on mount.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/course-progress`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ProgressEntry[]) => {
        if (cancelled) return;
        const next = new Set<number>();
        for (const row of rows ?? []) {
          const id = row.courseId ? blitzLessonIdFromCourseId(row.courseId) : 0;
          if (id) next.add(id);
        }
        setCompleted(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch phase-gate status.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/blitz/phase-status`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { phases: [], adminOverride: false }))
      .then((data) => {
        if (cancelled) return;
        setPhaseStatus(data.phases ?? []);
        setAdminOverride(data.adminOverride ?? false);
        setPhaseStatusLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setPhaseStatusLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore scroll to last-viewed lesson after both data sources are ready.
  useEffect(() => {
    if (!phaseStatusLoaded) return;
    fetch(`${API_BASE}/blitz/continue`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.sectionId) return;
        const el = document.getElementById(`lesson-card-${data.sectionId}`);
        if (el) {
          // Small delay so the layout has settled.
          setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
        }
      })
      .catch(() => {});
  }, [phaseStatusLoaded]);

  // Derived: phase → locked status. Empty map = all unlocked (while loading).
  const phaseLockedMap = useMemo(() => {
    const map = new Map<Phase, boolean>();
    for (const ps of phaseStatus) {
      map.set(ps.slug as Phase, !ps.unlocked);
    }
    return map;
  }, [phaseStatus]);

  // Derived: phase → status entry for computing tooltip text.
  const phaseStatusMap = useMemo(() => {
    const map = new Map<string, PhaseStatusEntry>();
    for (const ps of phaseStatus) map.set(ps.slug, ps);
    return map;
  }, [phaseStatus]);

  const setBusy = useCallback((id: number, busy: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Send a viewed event for a lesson (rate-limited: once per minute per lesson).
  const sendViewed = useCallback((id: number) => {
    const now = Date.now();
    const lastAt = lastViewedAt.current.get(id) ?? 0;
    if (now - lastAt < 60_000) return;
    lastViewedAt.current.set(id, now);
    const courseId = buildBlitzCourseId(id);
    fetch(`${API_BASE}/blitz/events`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, eventType: "viewed" }),
    }).catch(() => {});
  }, []);

  const toggleComplete = useCallback(
    async (id: number) => {
      const courseId = buildBlitzCourseId(id);
      const wasCompleted = completed.has(id);
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
        fetch(`${API_BASE}/course-progress/${buildBlitzCourseId(id)}`, {
          method: "DELETE",
          credentials: "include",
        }).catch(() => null),
      ),
    );
    try {
      const res = await fetch(`${API_BASE}/course-progress`, {
        credentials: "include",
      });
      if (res.ok) {
        const rows: ProgressEntry[] = await res.json();
        const next = new Set<number>();
        for (const row of rows ?? []) {
          const id = row.courseId ? blitzLessonIdFromCourseId(row.courseId) : 0;
          if (id) next.add(id);
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

  const phaseGroups: {
    key: Phase;
    label: string;
    items: HubLesson[];
    prevKey: Phase | null;
    prevLabel: string | null;
  }[] = [
    { key: "intro", label: "Introduction", items: grouped.intro, prevKey: null, prevLabel: null },
    { key: "build", label: "Phase 1 — Build", items: grouped.build, prevKey: "intro", prevLabel: "Introduction" },
    { key: "test", label: "Phase 2 — Test", items: grouped.test, prevKey: "build", prevLabel: "Phase 1 — Build" },
    { key: "scale", label: "Phase 3 — Scale", items: grouped.scale, prevKey: "test", prevLabel: "Phase 2 — Test" },
  ];

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div className="space-y-4">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-stretch sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-6 h-6 text-primary" />
                <h1 className="text-3xl font-bold">The Blitz™</h1>
              </div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Caterpillar Edition
                <span className="mx-2.5 text-border font-normal" aria-hidden="true">|</span>
                Build · Test · Scale
                <span className="mx-2.5 text-border font-normal" aria-hidden="true">|</span>
                V4.0 (Released April 21, 2026)
              </p>
            </div>

            <Card className="border-border/60 shadow-sm w-full shrink-0 sm:w-64">
              <CardContent className="px-4 py-2 h-full flex flex-col justify-center">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Your Progress
                  </span>
                  <span className="text-xs font-semibold text-foreground">
                    {doneCount} / {TOTAL}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 text-right text-[11px] text-muted-foreground">{pct}% complete</div>
              </CardContent>
            </Card>
          </div>

          <p className="text-muted-foreground leading-relaxed">
            A <strong className="text-foreground font-semibold">proven, step-by-step system</strong> for
            launching profitable affiliate marketing campaigns. Work through each module in order, make
            decisions based on data, and the results will follow.
          </p>
        </div>

        {phaseGroups.map((group) => {
          const isLocked = !adminOverride && (phaseLockedMap.get(group.key) ?? false);
          const prevStatus = group.prevKey ? phaseStatusMap.get(group.prevKey) : null;
          // How many lessons in the previous phase still need to be done to hit 80%.
          const neededToUnlock = prevStatus
            ? Math.max(0, Math.ceil(prevStatus.totalLessons * 0.8) - prevStatus.completedLessons)
            : 0;

          return (
            <div key={group.key}>
              <PhaseDivider
                phase={group.key}
                label={group.label}
                locked={isLocked}
                prevLabel={group.prevLabel}
                neededToUnlock={neededToUnlock}
              />
              <div className="space-y-3">
                {group.items.map((l) => (
                  <LessonCard
                    key={l.id}
                    lesson={l}
                    completed={completed.has(l.id)}
                    busy={pending.has(l.id)}
                    locked={isLocked}
                    neededToUnlock={neededToUnlock}
                    prevLabel={group.prevLabel}
                    onToggle={() => toggleComplete(l.id)}
                    onView={() => sendViewed(l.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}

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
  locked,
  prevLabel,
  neededToUnlock,
}: {
  phase: Phase;
  label: string;
  locked: boolean;
  prevLabel: string | null;
  neededToUnlock: number;
}) {
  const tint = PHASE_TINT[phase];
  return (
    <div className="mb-4">
      <div className="flex items-center gap-3">
        <div
          className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 ${
            locked ? "bg-slate-200 border-slate-300 text-slate-500" : `${tint.pillBg} ${tint.pillBorder} ${tint.pillText}`
          }`}
        >
          {locked && <Lock className="w-3.5 h-3.5" />}
          <span className="text-sm font-semibold tracking-wide uppercase">{label}</span>
        </div>
        <div className="flex-1 h-px bg-border" />
      </div>
      {locked && prevLabel && (
        <p className="mt-1.5 ml-1 text-xs text-muted-foreground flex items-center gap-1">
          <Lock className="w-3 h-3 shrink-0" />
          Complete 80% of {prevLabel} to unlock
          {neededToUnlock > 0 && (
            <span className="text-foreground font-medium">
              &nbsp;({neededToUnlock} lesson{neededToUnlock !== 1 ? "s" : ""} remaining)
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function LessonCard({
  lesson,
  completed,
  busy,
  locked,
  neededToUnlock,
  prevLabel,
  onToggle,
  onView,
}: {
  lesson: HubLesson;
  completed: boolean;
  busy: boolean;
  locked: boolean;
  neededToUnlock: number;
  prevLabel: string | null;
  onToggle: () => void;
  onView: () => void;
}) {
  const tint = PHASE_TINT[lesson.phase];

  const tooltipText = locked && prevLabel
    ? neededToUnlock > 0
      ? `Complete ${neededToUnlock} more lesson${neededToUnlock !== 1 ? "s" : ""} in ${prevLabel} to unlock this phase.`
      : `Complete 80% of ${prevLabel} to unlock this phase.`
    : undefined;

  return (
    <div id={`lesson-card-${lesson.id}`}>
      <Card
        className={`overflow-hidden border shadow-sm transition-all duration-200 ${
          locked
            ? "border-slate-200 bg-slate-50/60 opacity-60"
            : completed
            ? "border-emerald-200 bg-emerald-50/40 hover:shadow-md"
            : "border-border/60 hover:shadow-md"
        }`}
      >
        <div className="flex">
          <div
            className={`w-1 shrink-0 ${
              locked ? "bg-slate-300" : completed ? "bg-emerald-500" : tint.accent
            }`}
          />
          <CardContent className="flex items-start gap-4 p-5 flex-1 min-w-0">
            <div
              className={`flex items-center justify-center w-10 h-10 rounded-xl border shrink-0 text-base font-bold ${
                locked
                  ? "bg-slate-100 border-slate-300 text-slate-400"
                  : completed
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : `${tint.iconBg} ${tint.iconBorder} ${tint.iconText}`
              }`}
            >
              {locked ? (
                <Lock className="w-4 h-4" />
              ) : completed ? (
                <Check className="w-5 h-5" />
              ) : (
                lesson.id
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                {lesson.step}
              </p>
              <h3 className={`font-bold leading-snug mb-1.5 ${locked ? "text-muted-foreground" : "text-foreground"}`}>
                {lesson.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">{lesson.desc}</p>
              {lesson.tags && lesson.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {lesson.tags.map((t, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                        locked ? "bg-slate-100 text-slate-400 border-slate-200" : TAG_TINT[t.kind]
                      }`}
                    >
                      {t.label}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {lesson.ctas.map((cta, i) => (
                  locked ? (
                    <div key={i} className="relative group">
                      <Button
                        size="sm"
                        disabled
                        className="bg-slate-300 text-slate-500 cursor-not-allowed opacity-60"
                      >
                        <Lock className="w-3.5 h-3.5 mr-1.5" />
                        {cta.label}
                      </Button>
                      {tooltipText && (
                        <div className="absolute bottom-full left-0 mb-2 w-56 rounded-md bg-slate-900 px-3 py-2 text-xs text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-10">
                          {tooltipText}
                          <div className="absolute top-full left-4 border-4 border-transparent border-t-slate-900" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <Button
                      key={i}
                      asChild
                      size="sm"
                      className={`text-white ${cta.secondary ? "bg-slate-600 hover:bg-slate-700" : tint.btn}`}
                      onClick={onView}
                    >
                      <Link href={`/blitz/guide/${lesson.id}${i > 0 ? `#${cta.section}` : ""}`}>
                        {cta.label}
                        <ArrowUpRight className="w-4 h-4 ml-1.5" />
                      </Link>
                    </Button>
                  )
                ))}
                <div className="relative group">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={locked ? undefined : onToggle}
                    disabled={busy || locked}
                    className={
                      locked
                        ? "border-slate-200 text-slate-400 cursor-not-allowed"
                        : completed
                        ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        : ""
                    }
                  >
                    {locked ? (
                      <Lock className="w-4 h-4 mr-1.5" />
                    ) : (
                      <Check className="w-4 h-4 mr-1.5" />
                    )}
                    {locked ? "Locked" : completed ? "Completed" : "Mark as Complete"}
                  </Button>
                  {locked && tooltipText && (
                    <div className="absolute bottom-full left-0 mb-2 w-56 rounded-md bg-slate-900 px-3 py-2 text-xs text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-10">
                      {tooltipText}
                      <div className="absolute top-full left-4 border-4 border-transparent border-t-slate-900" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </div>
      </Card>
    </div>
  );
}
