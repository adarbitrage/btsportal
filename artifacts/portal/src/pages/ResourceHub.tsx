import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen,
  ChevronDown,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Image as ImageIcon,
  Library,
  Loader2,
  PenLine,
} from "lucide-react";
import { fetchResourceHub, type HubItem } from "@/lib/resource-hub-api";
import { downloadDriveFile, fetchDriveFileBlob } from "@/lib/creative-drive-api";

/**
 * Resource Hub (Task #2028) — the single curated member resources page.
 * Replaces the old Resource Library, Creative Drive, and Knowledge Base pages.
 * Rendered entirely from the admin-managed curation model.
 */

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-4" data-testid={`divider-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <div className="inline-flex items-center rounded-full border border-border bg-card px-3.5 py-1.5">
        <span className="text-sm font-semibold tracking-wide uppercase text-foreground">{label}</span>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function useFileActions() {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const view = async (item: HubItem) => {
    if (!item.fileId) return;
    setBusyId(`view-${item.id}`);
    try {
      const blob = await fetchDriveFileBlob(item.fileId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast({
        title: "Couldn't open the file",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const download = async (item: HubItem) => {
    if (!item.fileId) return;
    setBusyId(`download-${item.id}`);
    try {
      await downloadDriveFile({ id: item.fileId, name: item.fileName ?? `${item.displayTitle}.pdf` });
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  return { view, download, busyId };
}

function SeriesCard({
  group,
  icon: Icon,
}: {
  group: HubItem;
  icon: typeof BookOpen;
}) {
  const { view, download, busyId } = useFileActions();
  const parts = group.children ?? [];
  return (
    <Card className="border-border/60 shadow-sm" data-testid={`card-series-${group.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">{group.displayTitle}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{group.blurb}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => view(part)}
                  disabled={busyId === `view-${part.id}`}
                  data-testid={`button-view-${part.id}`}
                >
                  {busyId === `view-${part.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                  <span className="sr-only">View</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => download(part)}
                  disabled={busyId === `download-${part.id}`}
                  data-testid={`button-download-${part.id}`}
                >
                  {busyId === `download-${part.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span className="sr-only">Download</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ItemCard({ item }: { item: HubItem }) {
  const { view, download, busyId } = useFileActions();
  const external = item.kind === "external";
  return (
    <Card className="border-border/60 shadow-sm flex flex-col" data-testid={`card-hub-item-${item.id}`}>
      <CardContent className="p-5 flex flex-col flex-1">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground leading-snug">{item.displayTitle}</h3>
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed flex-1">{item.blurb}</p>
        <div className="mt-4 flex items-center gap-2">
          {external && item.externalUrl ? (
            <Button asChild size="sm" variant="outline" data-testid={`button-open-${item.id}`}>
              <a href={item.externalUrl} target="_blank" rel="noopener noreferrer">
                Open
                <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
              </a>
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => view(item)}
                disabled={busyId === `view-${item.id}`}
                data-testid={`button-view-${item.id}`}
              >
                {busyId === `view-${item.id}` ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Eye className="w-3.5 h-3.5 mr-1.5" />}
                View
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => download(item)}
                disabled={busyId === `download-${item.id}`}
                data-testid={`button-download-${item.id}`}
              >
                {busyId === `download-${item.id}` ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
                Download
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function GroupCard({ group }: { group: HubItem }) {
  const { view, download, busyId } = useFileActions();
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
    <Card className="border-border/60 shadow-sm sm:col-span-2 lg:col-span-3" data-testid={`card-hub-group-${group.id}`}>
      <CardContent className="p-5">
        <button
          type="button"
          className="w-full flex items-start gap-3 text-left"
          onClick={() => setOpen((v) => !v)}
          data-testid={`button-toggle-group-${group.id}`}
        >
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Library className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground leading-snug">{group.displayTitle}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mt-1">{group.blurb}</p>
          </div>
          <ChevronDown className={`w-5 h-5 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

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
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground leading-snug">{child.displayTitle}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{child.blurb}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2"
                            onClick={() => view(child)}
                            disabled={busyId === `view-${child.id}`}
                            data-testid={`button-view-${child.id}`}
                          >
                            {busyId === `view-${child.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                            <span className="sr-only">View</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2"
                            onClick={() => download(child)}
                            disabled={busyId === `download-${child.id}`}
                            data-testid={`button-download-${child.id}`}
                          >
                            {busyId === `download-${child.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            <span className="sr-only">Download</span>
                          </Button>
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
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">
        <div>
          <div className="flex items-center gap-3">
            <Library className="w-7 h-7 text-primary" />
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">Resource Hub</h1>
          </div>
          <p className="text-muted-foreground mt-1">
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
                <div className="grid gap-5 md:grid-cols-2">
                  {foundations.map((group, i) => (
                    <SeriesCard key={group.id} group={group} icon={seriesIcons[i % seriesIcons.length]} />
                  ))}
                </div>
              </section>
            )}

            {workingDocs.length > 0 && (
              <section>
                <SectionDivider label="Working Documents" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {workingDocs.map((item) =>
                    item.kind === "group" ? <GroupCard key={item.id} group={item} /> : <ItemCard key={item.id} item={item} />,
                  )}
                </div>
              </section>
            )}

            {templates.length > 0 && (
              <section>
                <SectionDivider label="Templates & Assets" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
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
