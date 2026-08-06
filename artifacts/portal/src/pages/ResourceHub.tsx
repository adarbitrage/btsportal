import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  BookOpen,
  ChevronDown,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Library,
  Loader2,
  PenLine,
} from "lucide-react";
import { fetchResourceHub, type HubItem } from "@/lib/resource-hub-api";

/**
 * Resource Hub (Task #2028, layout reworked in Task #2039) — the single
 * curated member resources page, rendered entirely from the admin-managed
 * curation model. Every content card is a full-width collapsible stacked
 * vertically, matching the member-page conventions used elsewhere.
 *
 * VIEW-ONLY (LaunchPad+ gating task): file items link to their own in-portal
 * reading page (/resource-hub/view/:slug) — there are deliberately NO
 * download, save-as, or open-raw-PDF-in-new-tab actions anywhere on this
 * page. External items (Google-Docs copies etc.) still open in a new tab.
 */

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-4" data-testid={`divider-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <h2 className="text-lg font-bold text-foreground tracking-tight">{label}</h2>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

/** Read (file → in-portal reading page) or Open (external) action for a row. */
function RowActions({ item }: { item: HubItem }) {
  if (item.kind === "external" && item.externalUrl) {
    return (
      <Button asChild variant="outline" size="sm" className="h-8" data-testid={`button-open-${item.id}`}>
        <a href={item.externalUrl} target="_blank" rel="noopener noreferrer">
          Open
          <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
        </a>
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm" className="h-8" data-testid={`link-read-${item.id}`}>
      <Link href={`/resource-hub/view/${item.slug}`}>
        Read
        <BookOpen className="w-3.5 h-3.5 ml-1.5" />
      </Link>
    </Button>
  );
}

/** Shared collapsible card header (chevron toggle), used by every hub card. */
function CollapsibleHeader({
  icon: Icon,
  title,
  blurb,
  open,
  onToggle,
  testId,
}: {
  icon: typeof BookOpen;
  title: string;
  blurb: string;
  open: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button type="button" className="w-full flex items-start gap-3 text-left" onClick={onToggle} data-testid={testId}>
      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold text-foreground leading-snug">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mt-1">{blurb}</p>
      </div>
      <ChevronDown className={`w-5 h-5 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

/** Full-width collapsible card for a Foundations series (numbered parts). */
function SeriesCard({ group, icon }: { group: HubItem; icon: typeof BookOpen }) {
  const [open, setOpen] = useState(false);
  const parts = group.children ?? [];
  return (
    <Card className="border-border/60 shadow-sm" data-testid={`card-series-${group.id}`}>
      <CardContent className="p-5">
        <CollapsibleHeader
          icon={icon}
          title={group.displayTitle}
          blurb={group.blurb}
          open={open}
          onToggle={() => setOpen((v) => !v)}
          testId={`button-toggle-series-${group.id}`}
        />
        {open && (
          <div className="mt-4 pt-1 border-t border-border">
            <div className="divide-y divide-border">
              {parts.map((part, i) => (
                <div key={part.id} className="flex items-center gap-3 py-3" data-testid={`row-series-part-${part.id}`}>
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-sm font-semibold flex items-center justify-center shrink-0">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground leading-snug">{part.displayTitle}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{part.blurb}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <RowActions item={part} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Full-width standalone item card (files or external links at section root). */
function ItemCard({ item }: { item: HubItem }) {
  return (
    <Card className="border-border/60 shadow-sm" data-testid={`card-hub-item-${item.id}`}>
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-foreground leading-snug">{item.displayTitle}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mt-1">{item.blurb}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <RowActions item={item} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Full-width collapsible group card (Headline Library, Campaign Toolkit, …). */
function GroupCard({ group }: { group: HubItem }) {
  const [open, setOpen] = useState(false);
  const children = group.children ?? [];

  // Children arrive ordered by sub-group label then sort order; group them.
  const subGroups: Array<{ label: string; items: HubItem[] }> = [];
  for (const child of children) {
    const label = child.subGroupLabel ?? "";
    const last = subGroups[subGroups.length - 1];
    if (last && last.label === label) last.items.push(child);
    else subGroups.push({ label, items: [child] });
  }

  return (
    <Card className="border-border/60 shadow-sm" data-testid={`card-hub-group-${group.id}`}>
      <CardContent className="p-5">
        <CollapsibleHeader
          icon={Library}
          title={group.displayTitle}
          blurb={group.blurb}
          open={open}
          onToggle={() => setOpen((v) => !v)}
          testId={`button-toggle-group-${group.id}`}
        />

        {open && (
          <div className="mt-4 pt-4 border-t border-border">
            {group.noteLine && (
              <p className="text-xs text-muted-foreground italic mb-4">{group.noteLine}</p>
            )}
            <div className="space-y-5">
              {subGroups.map((sg) => (
                <div key={sg.label || "items"}>
                  {sg.label && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{sg.label}</p>
                  )}
                  <div className="divide-y divide-border">
                    {sg.items.map((child) => (
                      <div key={child.id} className="flex items-center gap-3 py-2.5" data-testid={`row-group-item-${child.id}`}>
                        {child.kind === "external" ? (
                          <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground leading-snug">{child.displayTitle}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{child.blurb}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <RowActions item={child} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResourceHub() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["resource-hub"],
    queryFn: fetchResourceHub,
  });

  const foundations = data?.sections.foundations ?? [];
  const workingDocs = data?.sections.working_documents ?? [];
  const templates = data?.sections.templates_assets ?? [];
  const glossary = data?.glossary ?? [];

  // Alphabetical letter groups for the glossary accordion.
  const letterGroups: Array<{ letter: string; terms: typeof glossary }> = [];
  for (const t of glossary) {
    const letter = /^[a-z]/i.test(t.term) ? t.term[0].toUpperCase() : "#";
    const last = letterGroups[letterGroups.length - 1];
    if (last && last.letter === letter) last.terms.push(t);
    else letterGroups.push({ letter, terms: [t] });
  }

  const seriesIcons = [PenLine, ImageIcon] as const;

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Library className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold" data-testid="text-page-title">
              Resource Hub
            </h1>
          </div>
          <p className="text-muted-foreground">
            Everything you work from in one place — the Foundations series, working documents, templates, and the glossary.
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        )}
        {isError && (
          <p className="text-sm text-destructive py-8">Couldn't load the Resource Hub. Please refresh the page.</p>
        )}

        {!isLoading && !isError && (
          <>
            {foundations.length > 0 && (
              <section>
                <SectionDivider label="Foundations" />
                <div className="space-y-4">
                  {foundations.map((group, i) => (
                    <SeriesCard key={group.id} group={group} icon={seriesIcons[i % seriesIcons.length]} />
                  ))}
                </div>
              </section>
            )}

            {workingDocs.length > 0 && (
              <section>
                <SectionDivider label="Working Documents" />
                <div className="space-y-4">
                  {workingDocs.map((item) =>
                    item.kind === "group" ? <GroupCard key={item.id} group={item} /> : <ItemCard key={item.id} item={item} />,
                  )}
                </div>
              </section>
            )}

            {templates.length > 0 && (
              <section>
                <SectionDivider label="Templates & Assets" />
                <div className="space-y-4">
                  {templates.map((item) =>
                    item.kind === "group" ? <GroupCard key={item.id} group={item} /> : <ItemCard key={item.id} item={item} />,
                  )}
                </div>
              </section>
            )}

            {glossary.length > 0 && (
              <section>
                <SectionDivider label="Glossary" />
                <Card className="border-border/60 shadow-sm" data-testid="card-glossary">
                  <CardHeader className="pb-2">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <BookOpen className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">Working Vocabulary</CardTitle>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          The terms you'll hear in training, coaching calls, and the community.
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Accordion type="multiple" className="w-full">
                      {letterGroups.map((g) => (
                        <AccordionItem key={g.letter} value={g.letter}>
                          <AccordionTrigger className="text-sm font-semibold">{g.letter}</AccordionTrigger>
                          <AccordionContent>
                            <dl className="space-y-3">
                              {g.terms.map((t) => (
                                <div key={t.term} data-testid={`glossary-term-${t.term.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                                  <dt className="text-sm font-medium text-foreground">{t.term}</dt>
                                  <dd className="text-sm text-muted-foreground leading-relaxed">{t.definition}</dd>
                                </div>
                              ))}
                            </dl>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </CardContent>
                </Card>
              </section>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
