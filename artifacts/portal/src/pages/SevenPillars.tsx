import { AppLayout } from "@/components/layout/AppLayout";
import { VidalyticsEmbed } from "@/components/VidalyticsEmbed";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Layers, Briefcase, ShoppingBag, Users2, Mail,
  Target, Zap, Heart, ChevronUp, ArrowRight, CheckCircle2, Rocket,
} from "lucide-react";
import { useRef, type ComponentType, type SVGProps, type RefObject } from "react";
import { useCurriculumContent } from "@/hooks/use-curriculum-content";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

type PillarTint = {
  iconBg: string;
  iconBorder: string;
  iconText: string;
};

interface SevenPillarsContent {
  heroIntro: string;
  heroNoteHtml: string;
  video: { embedId: string; loaderUrl: string };
  pillarTitles: string[];
  welcome: { heading: string; paragraphsHtml: string[] };
  sections: Array<{
    paragraphsHtml: string[];
    highlight?: { title: string; items: string[] };
    duo?: Array<{ title: string; text: string }>;
    closingParagraphsHtml?: string[];
    closingEmphasis?: string;
    tools?: { title: string; items: Array<{ name: string; desc: string }> };
  }>;
  conclusion: { heading: string; paragraphsHtml: string[] };
}

// Visual styling (not course copy) stays client-side, keyed by pillar index.
const PILLAR_VISUALS: Array<{ icon: IconType; tint: PillarTint }> = [
  { icon: Briefcase, tint: { iconBg: "bg-blue-50", iconBorder: "border-blue-200", iconText: "text-blue-700" } },
  { icon: ShoppingBag, tint: { iconBg: "bg-emerald-50", iconBorder: "border-emerald-200", iconText: "text-emerald-700" } },
  { icon: Users2, tint: { iconBg: "bg-violet-50", iconBorder: "border-violet-200", iconText: "text-violet-700" } },
  { icon: Mail, tint: { iconBg: "bg-amber-50", iconBorder: "border-amber-200", iconText: "text-amber-700" } },
  { icon: Target, tint: { iconBg: "bg-rose-50", iconBorder: "border-rose-200", iconText: "text-rose-700" } },
  { icon: Zap, tint: { iconBg: "bg-cyan-50", iconBorder: "border-cyan-200", iconText: "text-cyan-700" } },
  { icon: Heart, tint: { iconBg: "bg-orange-50", iconBorder: "border-orange-200", iconText: "text-orange-700" } },
];

function PillarQuickNav({ titles }: { titles: string[] }) {
  const scrollToPillar = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav aria-label="Jump to a pillar" className="!mt-3">
      <div className="overflow-x-auto pb-1">
        <div className="grid grid-cols-8 gap-1.5 sm:gap-2 min-w-[680px]">
          {titles.map((title, i) => {
            const { icon: Icon, tint } = PILLAR_VISUALS[i];
            return (
              <button
                key={i}
                type="button"
                onClick={() => scrollToPillar(`pillar${i + 1}`)}
                className="group flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-card px-1 py-2.5 text-center transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border ${tint.iconBg} ${tint.iconBorder} shrink-0`}
                >
                  <Icon className={`h-4 w-4 ${tint.iconText}`} />
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
                  Pillar #{i + 1}
                </span>
                <span className="text-[11px] font-semibold leading-tight text-foreground">
                  {title}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => scrollToPillar("conclusion")}
            className="group flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-card px-1 py-2.5 text-center transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border bg-primary/10 border-primary/30 shrink-0">
              <Rocket className="h-4 w-4 text-primary" />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
              Up Next
            </span>
            <span className="text-[11px] font-semibold leading-tight text-foreground">
              Next Steps
            </span>
          </button>
        </div>
      </div>
    </nav>
  );
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

function PillarHeader({ num, title }: { num: number; title: string }) {
  const { icon: Icon, tint } = PILLAR_VISUALS[num - 1];
  return (
    <div className="flex items-start gap-4 p-6 border-b border-border/60 bg-muted/30">
      <div
        className={`w-12 h-12 rounded-xl border ${tint.iconBg} ${tint.iconBorder} flex items-center justify-center shrink-0`}
      >
        <Icon className={`w-6 h-6 ${tint.iconText}`} />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Pillar #{num}
        </p>
        <h2 className="text-2xl font-bold text-foreground">{title}</h2>
      </div>
    </div>
  );
}

function HighlightBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/40 p-6 space-y-3">
      <h3 className="font-bold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm text-foreground/85">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function SevenPillars() {
  const topRef = useRef<HTMLDivElement>(null);
  const { content, isLoading, isError } = useCurriculumContent<SevenPillarsContent>("seven-pillars");

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl" ref={topRef}>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">The 7 Pillars™</h1>
          </div>
          {content && (
            <>
              <p className="text-muted-foreground">{content.heroIntro}</p>
              <div className="mt-4 rounded-xl border border-border/60 bg-card p-4">
                <p
                  className="text-sm text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: content.heroNoteHtml }}
                />
              </div>
              <div className="mt-6 overflow-hidden rounded-xl border border-border/60 shadow-sm">
                <VidalyticsEmbed
                  embedId={content.video.embedId}
                  loaderUrl={content.video.loaderUrl}
                />
              </div>
            </>
          )}
        </div>

        {isLoading && (
          <div className="space-y-4" data-testid="seven-pillars-loading">
            <Skeleton className="h-8 w-2/3 rounded-lg" />
            <Skeleton className="h-64 w-full rounded-xl" />
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
            <PillarQuickNav titles={content.pillarTitles} />

            <section id="welcome" className="!mt-3">
              <Card className="border-border/60 shadow-sm">
                <CardContent className="p-8 md:p-10 space-y-5">
                  <h2 className="text-2xl font-bold text-foreground">{content.welcome.heading}</h2>
                  {content.welcome.paragraphsHtml.map((html, i) => (
                    <p
                      key={i}
                      className="text-muted-foreground leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  ))}
                  <BackToTop topRef={topRef} />
                </CardContent>
              </Card>
            </section>

            {content.sections.map((section, idx) => (
              <section id={`pillar${idx + 1}`} key={idx}>
                <Card className="border-border/60 shadow-sm overflow-hidden">
                  <PillarHeader num={idx + 1} title={content.pillarTitles[idx]} />
                  <CardContent className="p-8 md:p-10 space-y-5">
                    {section.paragraphsHtml.map((html, i) => (
                      <p
                        key={i}
                        className="text-muted-foreground leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: html }}
                      />
                    ))}

                    {section.duo && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {section.duo.map((box) => (
                          <div key={box.title} className="rounded-xl border border-border/60 bg-muted/40 p-6">
                            <h3 className="font-bold text-foreground mb-2">{box.title}</h3>
                            <p className="text-sm text-muted-foreground">{box.text}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {section.highlight && (
                      <HighlightBox title={section.highlight.title}>
                        <CheckList items={section.highlight.items} />
                      </HighlightBox>
                    )}

                    {section.tools && (
                      <HighlightBox title={section.tools.title}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                          {section.tools.items.map((tool) => (
                            <div key={tool.name} className="flex items-start gap-2 text-muted-foreground">
                              <span className="font-bold shrink-0 text-foreground">{tool.name}</span>
                              <span>— {tool.desc}</span>
                            </div>
                          ))}
                        </div>
                      </HighlightBox>
                    )}

                    {section.closingParagraphsHtml?.map((html, i) => (
                      <p
                        key={`closing-${i}`}
                        className="text-muted-foreground leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: html }}
                      />
                    ))}

                    {section.closingEmphasis && (
                      <p className="font-medium text-foreground leading-relaxed">
                        {section.closingEmphasis}
                      </p>
                    )}

                    <BackToTop topRef={topRef} />
                  </CardContent>
                </Card>
              </section>
            ))}

            <section id="conclusion">
              <Card className="border-border/60 shadow-sm">
                <CardContent className="p-8 md:p-10 space-y-5">
                  <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                    <Rocket className="w-6 h-6 text-primary" />
                    {content.conclusion.heading}
                  </h2>
                  {content.conclusion.paragraphsHtml.map((html, i) => (
                    <p
                      key={i}
                      className="text-muted-foreground leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  ))}
                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <Button asChild className="gap-2">
                      <Link href="/core-training/pillars-to-blitz">
                        Next: Before You Start The Blitz™
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                    </Button>
                    <Button asChild variant="outline" className="gap-2">
                      <Link href="/">Back to Welcome</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}
