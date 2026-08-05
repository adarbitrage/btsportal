import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useBrand } from "@/hooks/use-brand";
import {
  Rocket, Hammer, TestTubes, TrendingUp, Headphones,
  ArrowRight, ChevronUp, Search, BarChart3, Palette,
  LayoutGrid, MonitorPlay, Split, LineChart, Megaphone,
  Mail, Users, MessageSquare, Target, CheckCircle2
} from "lucide-react";
import { useRef } from "react";
import { useCurriculumContent, useSpaHtmlClick } from "@/hooks/use-curriculum-content";

interface QuickStartContent {
  heroSubtitle: string;
  introParagraphsHtml: string[];
  toc: Array<{ href: string; label: string; items: string[] }>;
  framework: {
    heading: string;
    intro: string;
    phases: Array<{ title: string; desc: string }>;
    note: string;
  };
  build: {
    heading: string;
    offer: { title: string; paragraphsHtml: string[] };
    research: { title: string; intro: string; items: string[] };
    workflow: { title: string; text: string };
    tools: { title: string; intro: string; items: Array<{ name: string; desc: string }>; note: string };
  };
  test: {
    heading: string;
    rolodex: { title: string; textHtml: string };
    split: { title: string; items: string[] };
    tracker: { title: string; textHtml: string };
    refine: { title: string; intro: string; items: string[] };
  };
  scale: {
    heading: string;
    spend: { title: string; textHtml: string };
    placements: { title: string; textHtml: string };
    dedicated: { title: string; textHtml: string };
  };
  support: {
    heading: string;
    cards: Array<{ title: string; desc: string; href: string | null }>;
  };
  finalSteps: {
    heading: string;
    introHtml: string;
    steps: Array<{ text: string; href: string | null }>;
    closing: string;
  };
}

// Visual styling (icons/colors — not course copy) stays client-side.
const PHASE_ICONS = [Hammer, TestTubes, TrendingUp];
const SUPPORT_ICONS = [Palette, MessageSquare, Users];

function BackToTop({ topRef }: { topRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <button
      onClick={() => topRef.current?.scrollIntoView({ behavior: "smooth" })}
      className="flex items-center gap-1 text-sm text-[#1a56db] hover:underline font-medium mt-4"
    >
      <ChevronUp className="w-4 h-4" />
      Back to Top
    </button>
  );
}

function SectionHeading({ icon: Icon, title }: { icon: typeof Rocket; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center">
        <Icon className="w-5 h-5 text-[#1a56db]" />
      </div>
      <h2 className="text-2xl font-bold text-foreground">{title}</h2>
    </div>
  );
}

function SubHeading({ icon: Icon, title }: { icon: typeof Rocket; title: string }) {
  return (
    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
      <Icon className="w-4 h-4 text-[#1a56db]" />
      {title}
    </h3>
  );
}

function CheckItems({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-muted-foreground">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function QuickStartGuide() {
  const topRef = useRef<HTMLDivElement>(null);
  const brand = useBrand();
  const { content, isLoading, isError } = useCurriculumContent<QuickStartContent>("quick-start");
  const onHtmlClick = useSpaHtmlClick();

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8" ref={topRef}>

        <div className="bg-[#1a56db] rounded-2xl p-8 md:p-10 text-white shadow-lg">
          <h1 className="text-3xl md:text-4xl font-bold font-['Roboto'] tracking-tight mb-2">
            The {brand.short} Quick-Start Guide
          </h1>
          {content && <p className="text-lg md:text-xl opacity-90">{content.heroSubtitle}</p>}
        </div>

        {isLoading && (
          <div className="space-y-4" data-testid="quick-start-loading">
            <Skeleton className="h-48 w-full rounded-xl" />
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
            <Card className="border-border/60 shadow-sm">
              <CardContent className="p-8 md:p-10 space-y-5" onClick={onHtmlClick}>
                {content.introParagraphsHtml.map((html, i) => (
                  <p
                    key={i}
                    className="text-muted-foreground leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/60 shadow-sm">
              <CardContent className="p-8 md:p-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center">
                    <Rocket className="w-5 h-5 text-[#1a56db]" />
                  </div>
                  <h2 className="text-xl font-bold text-foreground">Quick-Start Guide Table of Contents</h2>
                </div>
                <div className="space-y-4">
                  {content.toc.map((entry) => (
                    <div key={entry.href}>
                      <a href={entry.href} className="text-[#1a56db] font-semibold hover:underline">{entry.label}</a>
                      {entry.items.length > 0 && (
                        <ul className="mt-2 ml-5 space-y-1 text-sm text-muted-foreground list-disc">
                          {entry.items.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div id="framework" className="scroll-mt-6">
              <Card className="border-border/60 shadow-sm">
                <CardContent className="p-8 md:p-10 space-y-5">
                  <h2 className="text-2xl font-bold text-foreground">{content.framework.heading}</h2>
                  <p className="text-muted-foreground leading-relaxed">{content.framework.intro}</p>
                  <div className="grid md:grid-cols-3 gap-4">
                    {content.framework.phases.map((phase, i) => {
                      const PhaseIcon = PHASE_ICONS[i] ?? Hammer;
                      return (
                        <div key={phase.title} className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-5 space-y-2">
                          <div className="flex items-center gap-2">
                            <PhaseIcon className="w-5 h-5 text-[#1a56db]" />
                            <h3 className="font-bold text-foreground">{phase.title}</h3>
                          </div>
                          <p className="text-sm text-muted-foreground">{phase.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="bg-[#1a56db]/5 border border-[#1a56db]/20 rounded-xl p-4">
                    <p className="text-sm text-foreground font-medium">{content.framework.note}</p>
                  </div>
                  <BackToTop topRef={topRef} />
                </CardContent>
              </Card>
            </div>

            <div id="step-build" className="scroll-mt-6">
              <Card className="border-border/60 shadow-sm">
                <CardContent className="p-8 md:p-10 space-y-6" onClick={onHtmlClick}>
                  <SectionHeading icon={Hammer} title={content.build.heading} />

                  <div className="space-y-2">
                    <SubHeading icon={Target} title={content.build.offer.title} />
                    {content.build.offer.paragraphsHtml.map((html, i) => (
                      <p
                        key={i}
                        className="text-muted-foreground leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: html }}
                      />
                    ))}
                  </div>

                  <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                    <SubHeading icon={Search} title={content.build.research.title} />
                    <p className="text-muted-foreground leading-relaxed">{content.build.research.intro}</p>
                    <CheckItems items={content.build.research.items} />
                  </div>

                  <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                    <SubHeading icon={LayoutGrid} title={content.build.workflow.title} />
                    <p className="text-muted-foreground leading-relaxed">{content.build.workflow.text}</p>
                  </div>

                  <div className="border-t border-[#e8e4dc] pt-5 space-y-3">
                    <SubHeading icon={Palette} title={content.build.tools.title} />
                    <p className="text-muted-foreground leading-relaxed">{content.build.tools.intro}</p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {content.build.tools.items.map((tool) => (
                        <div key={tool.name} className="bg-[#faf9f7] border border-[#e8e4dc] rounded-lg p-3">
                          <p className="font-semibold text-sm text-foreground">{tool.name}</p>
                          <p className="text-xs text-muted-foreground">{tool.desc}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground italic">{content.build.tools.note}</p>
                  </div>
                  <BackToTop topRef={topRef} />
                </CardContent>
              </Card>
            </div>

            <div id="step-test" className="scroll-mt-6">
              <Card className="border-border/60 shadow-sm">
                <CardContent className="p-8 md:p-10 space-y-6">
                  <SectionHeading icon={TestTubes} title={content.test.heading} />

                  <div className="space-y-2">
                    <SubHeading icon={MonitorPlay} title={content.test.rolodex.title} />
                    <p
                      className="text-muted-foreground leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: content.test.rolodex.textHtml }}
                    />
                  </div>

                  <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                    <SubHeading icon={Split} title={content.test.split.title} />
                    <CheckItems items={content.test.split.items} />
                  </div>

                  <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                    <SubHeading icon={LineChart} title={content.test.tracker.title} />
                    <p
                      className="text-muted-foreground leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: content.test.tracker.textHtml }}
                    />
                  </div>

                  <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                    <SubHeading icon={BarChart3} title={content.test.refine.title} />
                    <p className="text-muted-foreground leading-relaxed">{content.test.refine.intro}</p>
                    <CheckItems items={content.test.refine.items} />
                  </div>
                  <BackToTop topRef={topRef} />
                </CardContent>
              </Card>
            </div>

            <div id="step-scale" className="scroll-mt-6">
              <Card className="border-border/60 shadow-sm">
                <CardContent className="p-8 md:p-10 space-y-6">
                  <SectionHeading icon={TrendingUp} title={content.scale.heading} />

                  <div className="space-y-2">
                    <SubHeading icon={Megaphone} title={content.scale.spend.title} />
                    <p
                      className="text-muted-foreground leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: content.scale.spend.textHtml }}
                    />
                  </div>

                  <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                    <SubHeading icon={MonitorPlay} title={content.scale.placements.title} />
                    <p
                      className="text-muted-foreground leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: content.scale.placements.textHtml }}
                    />
                  </div>

                  <div className="border-t border-[#e8e4dc] pt-5 space-y-2">
                    <SubHeading icon={Mail} title={content.scale.dedicated.title} />
                    <p
                      className="text-muted-foreground leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: content.scale.dedicated.textHtml }}
                    />
                  </div>
                  <BackToTop topRef={topRef} />
                </CardContent>
              </Card>
            </div>

            <div id="support" className="scroll-mt-6">
              <Card className="border-border/60 shadow-sm">
                <CardContent className="p-8 md:p-10 space-y-6">
                  <SectionHeading icon={Headphones} title={content.support.heading} />

                  <div className="grid md:grid-cols-3 gap-4">
                    {content.support.cards.map((card, i) => {
                      const CardIcon = SUPPORT_ICONS[i] ?? Palette;
                      const inner = (
                        <div
                          className={`bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-5 space-y-3 ${
                            card.href ? "hover:border-[#1a56db]/30 transition-colors cursor-pointer h-full" : ""
                          }`}
                        >
                          <CardIcon className="w-8 h-8 text-[#1a56db]" />
                          <h3 className="font-bold text-foreground">{card.title}</h3>
                          <p className="text-sm text-muted-foreground">{card.desc}</p>
                        </div>
                      );
                      return card.href ? (
                        <Link key={card.title} href={card.href}>
                          {inner}
                        </Link>
                      ) : (
                        <div key={card.title}>{inner}</div>
                      );
                    })}
                  </div>
                  <BackToTop topRef={topRef} />
                </CardContent>
              </Card>
            </div>

            <div id="final-steps" className="scroll-mt-6">
              <Card className="border-[#1a56db]/20 shadow-sm bg-[#1a56db]/5">
                <CardContent className="p-8 md:p-10 space-y-6">
                  <h2 className="text-2xl font-bold text-foreground text-center">{content.finalSteps.heading}</h2>
                  <p
                    className="text-muted-foreground text-center leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: content.finalSteps.introHtml }}
                  />
                  <div className="space-y-3 max-w-lg mx-auto">
                    {content.finalSteps.steps.map((step, i) => (
                      <div key={i} className="flex items-center gap-3 bg-white rounded-xl border border-[#e8e4dc] p-4">
                        <div className="w-8 h-8 rounded-full bg-[#1a56db] text-white flex items-center justify-center font-bold text-sm shrink-0">
                          {i + 1}
                        </div>
                        {step.href ? (
                          <Link href={step.href} className="text-sm text-foreground font-medium hover:text-[#1a56db]">
                            {step.text}
                          </Link>
                        ) : (
                          <p className="text-sm text-foreground font-medium">{step.text}</p>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-center text-lg font-bold text-foreground pt-2">
                    {content.finalSteps.closing}
                  </p>
                  <div className="flex justify-center gap-3 flex-wrap">
                    <Link href="/training">
                      <Button className="bg-[#2d8a4e] hover:bg-[#24713f] text-white font-semibold px-6">
                        <ArrowRight className="w-4 h-4 mr-2" />
                        Start Training
                      </Button>
                    </Link>
                    <Link href="/coaching">
                      <Button variant="outline" className="border-[#1a56db] text-[#1a56db] hover:bg-[#1a56db]/5 font-semibold px-6">
                        <Headphones className="w-4 h-4 mr-2" />
                        Join a Coaching Call
                      </Button>
                    </Link>
                  </div>
                  <BackToTop topRef={topRef} />
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
