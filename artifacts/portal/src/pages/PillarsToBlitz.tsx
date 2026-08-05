import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Briefcase, ShoppingBag, Users2, Mail, Target, Zap, Heart,
  Route, ArrowRight, ArrowLeft, Sparkles, ChevronUp, Rocket,
} from "lucide-react";
import { useRef, type ComponentType, type SVGProps, type RefObject } from "react";
import { useCurriculumContent, useSpaHtmlClick } from "@/hooks/use-curriculum-content";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

type Tint = { iconBg: string; iconBorder: string; iconText: string };

interface BridgeContent {
  num: number;
  title: string;
  quote: string;
  body: string[];
}

interface PillarsToBlitzContent {
  heroTitle: string;
  heroSubtitle: string;
  introParagraphsHtml: string[];
  bridges: BridgeContent[];
  nextSteps: { heading: string; paragraphsHtml: string[] };
}

// Visual styling (not course copy) stays client-side, keyed by pillar number.
const BRIDGE_VISUALS: Array<{ icon: IconType; tint: Tint }> = [
  { icon: Briefcase, tint: { iconBg: "bg-blue-50", iconBorder: "border-blue-200", iconText: "text-blue-700" } },
  { icon: ShoppingBag, tint: { iconBg: "bg-emerald-50", iconBorder: "border-emerald-200", iconText: "text-emerald-700" } },
  { icon: Users2, tint: { iconBg: "bg-violet-50", iconBorder: "border-violet-200", iconText: "text-violet-700" } },
  { icon: Mail, tint: { iconBg: "bg-amber-50", iconBorder: "border-amber-200", iconText: "text-amber-700" } },
  { icon: Target, tint: { iconBg: "bg-rose-50", iconBorder: "border-rose-200", iconText: "text-rose-700" } },
  { icon: Zap, tint: { iconBg: "bg-cyan-50", iconBorder: "border-cyan-200", iconText: "text-cyan-700" } },
  { icon: Heart, tint: { iconBg: "bg-orange-50", iconBorder: "border-orange-200", iconText: "text-orange-700" } },
];

function visualFor(num: number): { icon: IconType; tint: Tint } {
  return BRIDGE_VISUALS[(num - 1) % BRIDGE_VISUALS.length];
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

function PillarQuickNav({ bridges }: { bridges: BridgeContent[] }) {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav aria-label="Jump to a pillar" className="!mt-3">
      <div className="overflow-x-auto pb-1">
        <div className="grid grid-cols-8 gap-1.5 sm:gap-2 min-w-[680px]">
          {bridges.map((bridge) => {
            const { icon: Icon, tint } = visualFor(bridge.num);
            return (
              <button
                key={bridge.num}
                type="button"
                onClick={() => scrollTo(`bridge${bridge.num}`)}
                className="group flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-card px-1 py-2.5 text-center transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border ${tint.iconBg} ${tint.iconBorder} shrink-0`}
                >
                  <Icon className={`h-4 w-4 ${tint.iconText}`} />
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
                  Pillar #{bridge.num}
                </span>
                <span className="text-[11px] font-semibold leading-tight text-foreground">
                  {bridge.title.split(" — ")[0]}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => scrollTo("next-steps")}
            className="group flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-card px-1 py-2.5 text-center transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border bg-primary/10 border-primary/30 shrink-0">
              <Rocket className="h-4 w-4 text-primary" />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
              Up Next
            </span>
            <span className="text-[11px] font-semibold leading-tight text-foreground">
              Start The Blitz™
            </span>
          </button>
        </div>
      </div>
    </nav>
  );
}

function BridgeCard({ bridge, topRef }: { bridge: BridgeContent; topRef: RefObject<HTMLDivElement | null> }) {
  const { icon: Icon, tint } = visualFor(bridge.num);
  return (
    <Card id={`bridge${bridge.num}`} className="border-border/60 shadow-sm overflow-hidden scroll-mt-6">
      <div className="flex items-start gap-4 p-6 border-b border-border/60 bg-muted/30">
        <div
          className={`w-12 h-12 rounded-xl border ${tint.iconBg} ${tint.iconBorder} flex items-center justify-center shrink-0`}
        >
          <Icon className={`w-6 h-6 ${tint.iconText}`} />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Pillar #{bridge.num}
          </p>
          <h2 className="text-2xl font-bold text-foreground">{bridge.title}</h2>
        </div>
      </div>
      <CardContent className="p-8 md:p-10 space-y-6">
        <blockquote className={`rounded-xl border-l-4 ${tint.iconBorder} ${tint.iconBg} px-5 py-4`}>
          <p className="text-foreground/90 italic leading-relaxed">“{bridge.quote}”</p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            From the 7 Pillars™
          </p>
        </blockquote>

        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ArrowRight className={`w-4 h-4 ${tint.iconText}`} />
          What this becomes in The Blitz™
        </div>

        <div className="space-y-4">
          {bridge.body.map((para, i) => (
            <p key={i} className="text-muted-foreground leading-relaxed">
              {para}
            </p>
          ))}
        </div>

        <BackToTop topRef={topRef} />
      </CardContent>
    </Card>
  );
}

export default function PillarsToBlitz() {
  const topRef = useRef<HTMLDivElement>(null);
  const { content, isLoading, isError } = useCurriculumContent<PillarsToBlitzContent>("pillars-to-blitz");
  const onHtmlClick = useSpaHtmlClick();

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl" ref={topRef}>
        {isLoading && (
          <div className="space-y-4" data-testid="pillars-to-blitz-loading">
            <Skeleton className="h-10 w-2/3 rounded-lg" />
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        )}

        {isError && !isLoading && (
          <Card className="border-border/60">
            <CardContent className="p-6 text-sm text-muted-foreground">
              This content couldn't be loaded. Please refresh the page or try again later.
            </CardContent>
          </Card>
        )}

        {content && (
          <>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Route className="w-6 h-6 text-primary" />
                <h1 className="text-3xl font-bold">{content.heroTitle}</h1>
              </div>
              <p className="text-muted-foreground">{content.heroSubtitle}</p>

              <Card className="mt-4 border-border/60 shadow-sm">
                <CardContent className="px-8 md:px-10 py-4 md:py-5 space-y-5" onClick={onHtmlClick}>
                  {content.introParagraphsHtml.map((html, i) => (
                    <p
                      key={i}
                      className="text-muted-foreground leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="flex items-center gap-2 px-1">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Each pillar → what it becomes in The Blitz™
              </span>
            </div>

            <PillarQuickNav bridges={content.bridges} />

            {content.bridges.map((bridge) => (
              <BridgeCard key={bridge.num} bridge={bridge} topRef={topRef} />
            ))}

            <Card id="next-steps" className="border-primary/30 bg-primary/5 shadow-sm scroll-mt-6">
              <CardContent className="p-8 md:p-10 space-y-5">
                <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                  <Sparkles className="w-6 h-6 text-primary" />
                  {content.nextSteps.heading}
                </h2>
                <p
                  className="text-foreground/90 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: content.nextSteps.paragraphsHtml[0] }}
                />
                <p className="text-foreground/90 leading-relaxed font-medium">
                  {content.nextSteps.paragraphsHtml[1]}
                </p>
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <Button asChild className="gap-2">
                    <Link href="/blitz">
                      Open The Blitz™
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="gap-2">
                    <Link href="/core-training/7-pillars">
                      <ArrowLeft className="w-4 h-4" />
                      Back to the 7 Pillars™
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
