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
import { Loader2, Play, ShieldCheck, Copy, CheckCircle2, XCircle, Flag, Filter } from "lucide-react";
import {
  listScreenerSources,
  getScreenerStatus,
  runScreener,
  getScreenerResults,
  overrideScreenedExchange,
  type ScreenerSourceSummary,
  type ScreenedExchange,
} from "@/lib/admin-api";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const dispositionBadge = (d: string) => {
  if (d === "keep") return <Badge className="bg-emerald-600 hover:bg-emerald-600">keep</Badge>;
  if (d === "drop") return <Badge variant="destructive">drop</Badge>;
  return <Badge className="bg-amber-500 hover:bg-amber-500">flag</Badge>;
};

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

  const sourcesQ = useQuery({ queryKey: ["screener-sources"], queryFn: listScreenerSources });
  const statusQ = useQuery({
    queryKey: ["screener-status"],
    queryFn: getScreenerStatus,
    refetchInterval: (q) => (q.state.data?.running ? 1500 : false),
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

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = sources.length > 0 && sources.every((s) => selected.has(s.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(sources.map((s) => s.id)));

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <ShieldCheck className="h-6 w-6 text-primary" /> Coaching Value Screener
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Screens cleared coaching-call transcripts for durable teaching value BEFORE the
              knowledge base indexes them — dedups near-identical calls, splits each call into
              member-question/coach-answer moments, and keeps, drops, or flags each one. Nothing is
              published; kept moments are what the topic index later reads, and the raw transcript is
              kept for audit.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 font-mono text-xs">
            calibration {sourcesQ.data?.calibrationVersion ?? "…"}
          </Badge>
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
                    {statusQ.data.flagged} flagged · {statusQ.data.duplicates} dups
                  </span>
                )}
                {statusQ.data.error && (
                  <span className="text-destructive">Error: {statusQ.data.error}</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Source list */}
        <Card>
          <CardContent className="p-0">
            {sourcesQ.isLoading ? (
              <div className="flex items-center justify-center p-10 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading sources…
              </div>
            ) : sources.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                No cleared coaching sources found. Clear coaching transcripts in the Transcript
                Cleaner first.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                    </TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Dedup</TableHead>
                    <TableHead className="text-right">Kept</TableHead>
                    <TableHead className="text-right">Dropped</TableHead>
                    <TableHead className="text-right">Flagged</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.map((s: ScreenerSourceSummary) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="truncate font-medium">{s.title}</div>
                        {s.sourceName && (
                          <div className="truncate text-xs text-muted-foreground">{s.sourceName}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.sourceType.replace(/_/g, " ")}
                      </TableCell>
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
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {s.screening?.stale && (
                            <Badge variant="outline" className="text-amber-600">
                              stale
                            </Badge>
                          )}
                          {s.screening && (
                            <Button size="sm" variant="ghost" onClick={() => setPreviewId(s.id)}>
                              Preview
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <PreviewDialog sourceDocId={previewId} onClose={() => setPreviewId(null)} />
    </AppLayout>
  );
}

function PreviewDialog({ sourceDocId, onClose }: { sourceDocId: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "keep" | "drop" | "flag">("all");

  const resultsQ = useQuery({
    queryKey: ["screener-results", sourceDocId],
    queryFn: () => getScreenerResults(sourceDocId as number),
    enabled: sourceDocId !== null,
  });

  const overrideM = useMutation({
    mutationFn: (v: { id: number; disposition: string; feed: boolean }) =>
      overrideScreenedExchange(v.id, v.disposition, v.feed),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["screener-results", sourceDocId] });
      qc.invalidateQueries({ queryKey: ["screener-sources"] });
      toast({ title: "Overruled", description: "The moment's verdict was updated." });
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
          <DialogTitle>{resultsQ.data?.source.title ?? "Screening preview"}</DialogTitle>
          <DialogDescription>
            Each moment below was kept, dropped, or flagged. Overrule the AI to correct it — optionally
            teaching the screener by adding your correction to the calibration set.
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
              {(["all", "keep", "drop", "flag"] as const).map((f) => (
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
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {resultsQ.data.screening.dedupStatus} · cal {resultsQ.data.screening.calibrationVersion}
                </span>
              )}
            </div>

            <div className="space-y-3 overflow-y-auto pr-1" style={{ maxHeight: "55vh" }}>
              {filtered.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No moments in this view.</div>
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
                        <Badge variant="outline" className="text-xs text-amber-600">situational numbers</Badge>
                      )}
                    </div>
                    {ex.memberPrompt && (
                      <p className="mb-1 text-sm">
                        <span className="font-medium text-muted-foreground">Q: </span>
                        {ex.memberPrompt}
                      </p>
                    )}
                    <p className="text-sm">
                      <span className="font-medium text-muted-foreground">A: </span>
                      {ex.coachResponse}
                    </p>
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
                        onClick={() => overrideM.mutate({ id: ex.id, disposition: "keep", feed: true })}
                      >
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Keep + teach
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={overrideM.isPending}
                        onClick={() => overrideM.mutate({ id: ex.id, disposition: "drop", feed: true })}
                      >
                        <XCircle className="mr-1 h-3.5 w-3.5" /> Drop + teach
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={overrideM.isPending}
                        onClick={() => overrideM.mutate({ id: ex.id, disposition: "flag", feed: false })}
                      >
                        <Flag className="mr-1 h-3.5 w-3.5" /> Flag
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `${ex.memberPrompt ? "Q: " + ex.memberPrompt + "\n" : ""}A: ${ex.coachResponse}`,
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
