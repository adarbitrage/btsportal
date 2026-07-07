import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Play, ShieldCheck, Copy, CheckCircle2, XCircle, Flag, Filter, AlertTriangle } from "lucide-react";
import {
  listScreenerSources,
  getScreenerStatus,
  runScreener,
  getScreenerResults,
  overrideScreenedExchange,
  type ScreenerSourceSummary,
  type ScreenedExchange,
} from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";

const dispositionBadge = (d: string) => {
  if (d === "keep") return <Badge className="bg-emerald-600 hover:bg-emerald-600">keep</Badge>;
  if (d === "drop") return <Badge variant="destructive">drop</Badge>;
  if (d === "error")
    return (
      <Badge className="bg-slate-500 hover:bg-slate-500">
        <AlertTriangle className="mr-1 h-3 w-3" /> error
      </Badge>
    );
  return <Badge className="bg-amber-500 hover:bg-amber-500">flag</Badge>;
};

const ANOMALY_LABELS: Record<string, string> = {
  oversized_segment: "oversized segment",
  low_segment_count: "too few segments",
  all_error: "all errored",
};

const anomalyBadges = (anomalies: string[]) =>
  anomalies.map((a) => (
    <Badge key={a} variant="destructive" className="text-xs">
      <AlertTriangle className="mr-1 h-3 w-3" /> {ANOMALY_LABELS[a] ?? a}
    </Badge>
  ));

const dedupBadge = (s: string) => {
  if (s === "exact_duplicate") return <Badge variant="destructive">exact dup</Badge>;
  if (s === "near_duplicate") return <Badge className="bg-amber-500 hover:bg-amber-500">near dup</Badge>;
  return <Badge variant="outline">unique</Badge>;
};

export default function KbValueScreener() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [force, setForce] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);

  const statusQ = useQuery({
    queryKey: ["screener-status"],
    queryFn: getScreenerStatus,
    refetchInterval: (q) => (q.state.data?.running ? 1500 : false),
  });
  // While a batch is running, keep the source rows live too so freshly-screened
  // calls move into the "Screened" section as they finish.
  const sourcesQ = useQuery({
    queryKey: ["screener-sources"],
    queryFn: listScreenerSources,
    refetchInterval: statusQ.data?.running ? 3000 : false,
  });

  // When a run finishes, refresh the source summaries.
  useEffect(() => {
    if (statusQ.data && !statusQ.data.running && statusQ.data.finishedAt) {
      qc.invalidateQueries({ queryKey: ["screener-sources"] });
    }
  }, [statusQ.data?.finishedAt, statusQ.data?.running, qc]);

  const runM = useMutation({
    mutationFn: () => runScreener([...selected], force),
    onSuccess: (r) => {
      toast({ title: "Screening started", description: `Screening ${r.total} source(s) in the background.` });
      setSelected(new Set());
      statusQ.refetch();
    },
    onError: (e: Error) => toast({ title: "Could not start", description: e.message, variant: "destructive" }),
  });

  const sources = sourcesQ.data?.sources ?? [];
  const running = statusQ.data?.running ?? false;
  const currentSourceId = running ? statusQ.data?.currentSourceId ?? null : null;

  const unscreened = useMemo(() => sources.filter((s) => !s.screening), [sources]);
  const screened = useMemo(
    () =>
      sources
        .filter((s) => s.screening)
        .slice()
        .sort(
          (a, b) =>
            new Date(b.screening!.screenedAt).getTime() - new Date(a.screening!.screenedAt).getTime(),
        ),
    [sources],
  );

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <ShieldCheck className="h-6 w-6 text-primary" /> Coaching Value Screener
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              A recall-biased de-noiser that runs over cleared coaching-call transcripts BEFORE the
              knowledge base indexes them. It drops near-identical whole calls, threads each call into
              topic segments, and keeps anything with teaching value — dropping only obvious noise and
              flagging the genuinely uncertain for a human. Nothing is published; kept segments are what
              the topic index later reads, and the raw transcript is kept for audit.
            </p>
          </div>
        </div>

        {/* Run controls */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 p-4">
            <div className="text-sm">
              <span className="font-medium">{selected.size}</span> selected
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={force} onCheckedChange={(v) => setForce(v === true)} />
              Re-screen even if unchanged
            </label>
            <Button
              onClick={() => runM.mutate()}
              disabled={selected.size === 0 || running || runM.isPending}
            >
              {running || runM.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Screen selected
            </Button>

            {statusQ.data && (running || statusQ.data.finishedAt) && (
              <div className="ml-auto flex items-center gap-3 text-sm">
                {running ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {statusQ.data.processed}/{statusQ.data.total}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Last run: {statusQ.data.kept} kept · {statusQ.data.dropped} dropped ·{" "}
                    {statusQ.data.flagged} flagged · {statusQ.data.errors} errors ·{" "}
                    {statusQ.data.duplicates} dups
                  </span>
                )}
                {statusQ.data.error && (
                  <span className="text-destructive">Error: {statusQ.data.error}</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Source lists */}
        {sourcesQ.isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center p-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading sources…
            </CardContent>
          </Card>
        ) : sources.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              No cleared coaching sources found. Clear coaching transcripts in the Transcript
              Cleaner first.
            </CardContent>
          </Card>
        ) : (
          <>
            <div>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                Not yet screened ({unscreened.length})
              </h2>
              <Card>
                <CardContent className="p-0">
                  {unscreened.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      Every cleared coaching call has been screened.
                    </div>
                  ) : (
                    <SourceTable
                      sources={unscreened}
                      selected={selected}
                      toggle={toggle}
                      allSelected={unscreened.every((s) => selected.has(s.id))}
                      toggleAll={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          const all = unscreened.every((s) => next.has(s.id));
                          for (const s of unscreened) {
                            if (all) next.delete(s.id);
                            else next.add(s.id);
                          }
                          return next;
                        })
                      }
                      currentSourceId={currentSourceId}
                      onAudit={setPreviewId}
                    />
                  )}
                </CardContent>
              </Card>
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                Screened ({screened.length})
              </h2>
              <Card>
                <CardContent className="p-0">
                  {screened.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      Nothing screened yet — select calls above and run the screener.
                    </div>
                  ) : (
                    <SourceTable
                      sources={screened}
                      selected={selected}
                      toggle={toggle}
                      allSelected={screened.every((s) => selected.has(s.id))}
                      toggleAll={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          const all = screened.every((s) => next.has(s.id));
                          for (const s of screened) {
                            if (all) next.delete(s.id);
                            else next.add(s.id);
                          }
                          return next;
                        })
                      }
                      currentSourceId={currentSourceId}
                      onAudit={setPreviewId}
                      showResults
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>

      <PreviewDialog sourceDocId={previewId} onClose={() => setPreviewId(null)} />
    </AppLayout>
  );
}

const fmtScreenedAt = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

function SourceTable({
  sources,
  selected,
  toggle,
  allSelected,
  toggleAll,
  currentSourceId,
  onAudit,
  showResults = false,
}: {
  sources: ScreenerSourceSummary[];
  selected: Set<number>;
  toggle: (id: number) => void;
  allSelected: boolean;
  toggleAll: () => void;
  currentSourceId: number | null;
  onAudit: (id: number) => void;
  showResults?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
          </TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Type</TableHead>
          {showResults && (
            <>
              <TableHead>Dedup</TableHead>
              <TableHead className="text-right">Kept</TableHead>
              <TableHead className="text-right">Dropped</TableHead>
              <TableHead className="text-right">Flagged</TableHead>
              <TableHead className="text-right">Errors</TableHead>
              <TableHead>Last screened</TableHead>
            </>
          )}
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sources.map((s) => (
          <TableRow key={s.id} data-screening={s.id === currentSourceId ? "true" : undefined}>
            <TableCell>
              <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
            </TableCell>
            <TableCell className="max-w-xs">
              <div className="flex items-center gap-2">
                <div className="truncate font-medium">{s.title}</div>
                {s.id === currentSourceId && (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Screening…
                  </span>
                )}
              </div>
              {s.sourceName && (
                <div className="truncate text-xs text-muted-foreground">{s.sourceName}</div>
              )}
              {s.screening && s.screening.anomalies.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">{anomalyBadges(s.screening.anomalies)}</div>
              )}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {s.sourceType.replace(/_/g, " ")}
            </TableCell>
            {showResults && (
              <>
                <TableCell>
                  {s.screening ? dedupBadge(s.screening.dedupStatus) : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.screening ? s.screening.keptCount : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {s.screening ? s.screening.droppedCount : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.screening ? s.screening.flaggedCount : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.screening ? (
                    s.screening.errorCount > 0 ? (
                      <span className="font-medium text-slate-500">{s.screening.errorCount}</span>
                    ) : (
                      0
                    )
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {s.screening ? fmtScreenedAt(s.screening.screenedAt) : "—"}
                </TableCell>
              </>
            )}
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-2">
                {s.screening && (
                  <Button size="sm" variant="ghost" onClick={() => onAudit(s.id)}>
                    Audit
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PreviewDialog({ sourceDocId, onClose }: { sourceDocId: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "keep" | "drop" | "flag" | "error">("all");

  const resultsQ = useQuery({
    queryKey: ["screener-results", sourceDocId],
    queryFn: () => getScreenerResults(sourceDocId as number),
    enabled: sourceDocId !== null,
  });

  const overrideM = useMutation({
    mutationFn: (v: { id: number; disposition: string }) =>
      overrideScreenedExchange(v.id, v.disposition),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["screener-results", sourceDocId] });
      qc.invalidateQueries({ queryKey: ["screener-sources"] });
      toast({ title: "Overruled", description: "The segment's verdict was updated." });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const exchanges = resultsQ.data?.exchanges ?? [];
  const filtered = useMemo(
    () => (filter === "all" ? exchanges : exchanges.filter((e) => e.effectiveDisposition === filter)),
    [exchanges, filter],
  );

  return (
    <Dialog open={sourceDocId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{resultsQ.data?.source.title ?? "Screening audit"}</DialogTitle>
          <DialogDescription>
            Each topic segment below was kept, dropped, flagged, or errored. Overrule the AI verdict to
            correct it — an errored segment (classification failed after retries) is safe to keep or drop
            by hand.
          </DialogDescription>
        </DialogHeader>

        {resultsQ.isLoading ? (
          <div className="flex items-center justify-center p-10 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b pb-3 text-sm">
              <Filter className="h-4 w-4 text-muted-foreground" />
              {(["all", "keep", "drop", "flag", "error"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? "default" : "outline"}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </Button>
              ))}
              {resultsQ.data?.screening && (
                <span className="ml-auto flex items-center gap-2">
                  {anomalyBadges(resultsQ.data.screening.anomalies ?? [])}
                  <span className="font-mono text-xs text-muted-foreground">
                    {resultsQ.data.screening.dedupStatus}
                  </span>
                </span>
              )}
            </div>

            <div className="space-y-3 overflow-y-auto pr-1" style={{ maxHeight: "55vh" }}>
              {filtered.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No segments in this view.</div>
              ) : (
                filtered.map((ex: ScreenedExchange) => (
                  <div key={ex.id} className="rounded-lg border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      {dispositionBadge(ex.effectiveDisposition)}
                      {ex.overrideDisposition && (
                        <Badge variant="outline" className="text-xs">overruled (AI said {ex.disposition})</Badge>
                      )}
                      <Badge variant="secondary" className="text-xs">{ex.valueType.replace(/_/g, " ")}</Badge>
                      {ex.situationalNumber && (
                        <Badge variant="outline" className="text-xs text-amber-600">situational / time-bound</Badge>
                      )}
                      {ex.contextBound && (
                        <Badge variant="outline" className="text-xs text-sky-600">screen-share walkthrough</Badge>
                      )}
                    </div>
                    {ex.anchorQuestion && (
                      <p className="mb-1 text-sm">
                        <span className="font-medium text-muted-foreground">Anchor question: </span>
                        {ex.anchorQuestion}
                      </p>
                    )}
                    <p className="whitespace-pre-line text-sm">{ex.passage}</p>
                    {(ex.rationale || ex.dropReason) && (
                      <p className="mt-2 text-xs italic text-muted-foreground">
                        {ex.dropReason ? `${ex.dropReason} — ` : ""}
                        {ex.rationale}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2">
                      <span className="text-xs text-muted-foreground">Overrule:</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={overrideM.isPending}
                        onClick={() => overrideM.mutate({ id: ex.id, disposition: "keep" })}
                      >
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Keep
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={overrideM.isPending}
                        onClick={() => overrideM.mutate({ id: ex.id, disposition: "drop" })}
                      >
                        <XCircle className="mr-1 h-3.5 w-3.5" /> Drop
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={overrideM.isPending}
                        onClick={() => overrideM.mutate({ id: ex.id, disposition: "flag" })}
                      >
                        <Flag className="mr-1 h-3.5 w-3.5" /> Flag
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `${ex.anchorQuestion ? "Anchor question: " + ex.anchorQuestion + "\n" : ""}${ex.passage}`,
                          );
                          toast({ title: "Copied" });
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
