import { useGetBlitzContinue, getGetBlitzContinueQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, PlayCircle, ArrowRight, RotateCcw } from "lucide-react";
import { Link } from "wouter";

const LESSON_TITLES: Record<number, { title: string; step: string }> = {
  1:  { step: "Introduction",              title: "What Is Affiliate Arbitrage?" },
  2:  { step: "Before You Start",          title: "Understand the System" },
  3:  { step: "Phase 1 Overview",          title: "How Phase 1 Works" },
  4:  { step: "Network Selection",         title: "Choose Your Affiliate Network" },
  5:  { step: "Product Selection",         title: "Select Your Offer" },
  6:  { step: "Creative Assets",           title: "Understanding Creative Assets" },
  7:  { step: "Creative Assets",           title: "Create Your Native Ad Assets" },
  8:  { step: "Creative Assets",           title: "Create Your LP Assets — Media Mavens" },
  9:  { step: "Creative Assets",           title: "Create Your LP Assets — ClickBank" },
  10: { step: "Compliance",               title: "Submit Assets for Compliance Review" },
  11: { step: "Flexy™ Setup",             title: "Setting Up Your Website in Flexy™" },
  12: { step: "MetricMover™",             title: "Using MetricMover™" },
  13: { step: "DIYTrax Setup",            title: "Set Up DIYTrax" },
  14: { step: "Go Live",                  title: "Configure Caterpillar and Go Live" },
  15: { step: "Phase 2 — Test",           title: "Find Your Winners Through Data" },
  16: { step: "Round 1 · Min. $500",      title: "Find Your Top Performing Headline" },
  17: { step: "Between Rounds 1 and 2",   title: "Prepare Additional Static Images" },
  18: { step: "Round 2 · Min. $500",      title: "Find Your Top Performing Visual Creative" },
  19: { step: "Between Rounds 2 and 3",   title: "Prepare Your Round 3 Assets" },
  20: { step: "Round 3 · Min. $1,000",    title: "Find Your Top Performing Placement Format" },
  21: { step: "Phase 3 — Scale Method 1", title: "Increase Budget on Top Performing Placement" },
  22: { step: "Phase 3 — Scale Method 2", title: "Test New Placements and Publishers" },
  23: { step: "Phase 3 — Scale Method 3", title: "Master Publisher" },
};

function buildResumeHref(sectionId: number | null, savedPositionSeconds: number | null): string {
  if (!sectionId) return "/blitz";
  const base = `/blitz/guide/${sectionId}`;
  if (savedPositionSeconds && savedPositionSeconds > 0) {
    return `${base}?t=${savedPositionSeconds}`;
  }
  return base;
}

export function BlitzContinueCard() {
  const { data, isLoading } = useGetBlitzContinue({
    query: { queryKey: getGetBlitzContinueQueryKey(), staleTime: 0 },
  });

  if (isLoading) {
    return (
      <div className="h-28 bg-card rounded-2xl border border-border animate-pulse" />
    );
  }

  if (!data) return null;

  if (data.status === "complete") {
    return (
      <Card className="border border-emerald-200 bg-emerald-50/40">
        <CardContent className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-200 shrink-0">
              <Zap className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-emerald-600 mb-0.5">The Blitz™ Complete</p>
              <p className="font-semibold text-foreground">You've finished all 23 sections — great work!</p>
            </div>
          </div>
          <Link href="/blitz">
            <Button variant="outline" size="sm" className="shrink-0 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
              <RotateCcw className="w-4 h-4 mr-2" />
              Revisit any section
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const lesson = data.sectionId ? LESSON_TITLES[data.sectionId] : null;
  const href = buildResumeHref(data.sectionId, data.savedPositionSeconds);

  const isNew = data.status === "new";
  const isInProgress = data.status === "in_progress";

  const eyebrow = isNew
    ? "Get Started"
    : isInProgress
    ? "Continue where you left off"
    : "Up next";

  const buttonLabel = isNew ? "Start the Blitz" : isInProgress ? "Resume" : "Continue";
  const ButtonIcon = isNew ? PlayCircle : isInProgress ? PlayCircle : ArrowRight;

  return (
    <Card className="border border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
      <CardContent className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 shrink-0">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-widest uppercase text-primary mb-0.5">{eyebrow}</p>
            {lesson ? (
              <>
                <p className="font-bold text-foreground truncate">{lesson.title}</p>
                <p className="text-sm text-muted-foreground truncate">{lesson.step}</p>
              </>
            ) : (
              <p className="font-bold text-foreground">The Blitz™</p>
            )}
          </div>
        </div>
        <Link href={href}>
          <Button size="sm" className="shrink-0 shadow-sm shadow-primary/20">
            <ButtonIcon className="w-4 h-4 mr-2" />
            {buttonLabel}
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
