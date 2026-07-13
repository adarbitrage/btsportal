import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Search, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth";

// Corpus Sweep (Task #1903): cross-document correction proposals.
//
// Phrase mode — instant preview of every staging draft / live doc containing
// the given phrase(s); confirming appends a proposed-terminology-change NOTE to
// each selected doc. Concept mode — a background LLM job (durable run state on
// the server, survives connection timeouts) that judges candidate docs for a
// flawed concept; confirming appends a proposed-correction NOTE. Notes only:
// staging → admin notes, live → reviewer notes. A sweep NEVER edits a document
// body — the reviewer applies changes doc-by-doc via the normal editor/refine.

interface PhraseMatch {
  kind: "staging" | "live";
  id: number;
  title: string;
  status: string | null;
  snippets: string[];
  matchCount: number;
}

interface ConceptResult {
  kind: "staging" | "live";
  id: number;
  title: string;
  verdict: "yes" | "no" | "error";
  evidence?: string;
  proposedCorrection?: string;
  error?: string;
  noted?: boolean;
}

interface ConceptRun {
  id: number;
  status: "running" | "ready" | "confirmed" | "failed";
  incorrectConcept: string;
  correctConcept: string;
  total: number;
  processed: number;
  results: ConceptResult[];
  error: string | null;
  startedAt: string;
}

const BASE = "/admin/knowledgebase/staging/sweep";

export default function CorpusSweepDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();

  // ── Phrase mode state ──────────────────────────────────────────────────────
  const [phrasesText, setPhrasesText] = useState("");
  const [replacement, setReplacement] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [matches, setMatches] = useState<PhraseMatch[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [phraseDone, setPhraseDone] = useState<number | null>(null);

  // ── Concept mode state ─────────────────────────────────────────────────────
  const [incorrectConcept, setIncorrectConcept] = useState("");
  const [correctConcept, setCorrectConcept] = useState("");
  const [starting, setStarting] = useState(false);
  const [run, setRun] = useState<ConceptRun | null>(null);
  const [conceptSelected, setConceptSelected] = useState<Set<string>>(new Set());
  const [conceptConfirming, setConceptConfirming] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const key = (m: { kind: string; id: number }) => `${m.kind}:${m.id}`;

  // Load the most recent concept run when the dialog opens (a run started in a
  // previous session — or one that outlived a closed dialog — is never lost).
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await authFetch(`${BASE}/concept/runs`);
        if (!res.ok) return;
        const data = await res.json();
        const latest: ConceptRun | undefined = (data.runs || [])[0];
        if (latest) {
          setRun(latest);
          if (latest.status === "ready") {
            setConceptSelected(
              new Set(latest.results.filter((r) => r.verdict === "yes" && !r.noted).map(key)),
            );
          }
        }
      } catch {
        /* best-effort restore */
      }
    })();
  }, [open]);

  // Poll a running concept run every 4s until it finishes.
  const refreshRun = useCallback(async (runId: number) => {
    try {
      const res = await authFetch(`${BASE}/concept/runs/${runId}`);
      if (!res.ok) return;
      const data = await res.json();
      const fresh: ConceptRun = data.run;
      setRun(fresh);
      if (fresh.status === "ready") {
        setConceptSelected(new Set(fresh.results.filter((r) => r.verdict === "yes" && !r.noted).map(key)));
      }
    } catch {
      /* transient poll failure */
    }
  }, []);

  useEffect(() => {
    if (!open || !run || run.status !== "running") {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(() => refreshRun(run.id), 4000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open, run?.id, run?.status, refreshRun]);

  // ── Phrase mode actions ────────────────────────────────────────────────────
  const parsedPhrases = phrasesText
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 1);

  const runPreview = async () => {
    if (parsedPhrases.length === 0) return;
    setPreviewLoading(true);
    setPhraseDone(null);
    try {
      const res = await authFetch(`${BASE}/phrase/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrases: parsedPhrases }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Preview failed");
      const found: PhraseMatch[] = data.matches || [];
      setMatches(found);
      setSelected(new Set(found.map(key)));
    } catch (err) {
      toast({
        title: "Sweep preview failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmPhrase = async () => {
    if (!matches || selected.size === 0 || !replacement.trim()) return;
    setConfirming(true);
    try {
      const targets = matches.filter((m) => selected.has(key(m))).map((m) => ({ kind: m.kind, id: m.id }));
      const res = await authFetch(`${BASE}/phrase/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrases: parsedPhrases, replacement: replacement.trim(), targets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Confirm failed");
      setPhraseDone(data.written ?? 0);
      toast({ title: `Notes written on ${data.written} document${data.written === 1 ? "" : "s"}` });
      const failed = (data.results || []).filter((r: { ok: boolean }) => !r.ok);
      if (failed.length > 0) {
        toast({
          title: `${failed.length} note${failed.length === 1 ? "" : "s"} could not be written`,
          description: failed.map((f: { kind: string; id: number; error?: string }) => `${f.kind} #${f.id}: ${f.error || "unknown"}`).join("; "),
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Couldn't write the notes",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setConfirming(false);
    }
  };

  // ── Concept mode actions ───────────────────────────────────────────────────
  const startConcept = async () => {
    if (incorrectConcept.trim().length < 10 || correctConcept.trim().length < 10) return;
    setStarting(true);
    try {
      const res = await authFetch(`${BASE}/concept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incorrectConcept: incorrectConcept.trim(),
          correctConcept: correctConcept.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Couldn't start the sweep");
      setConceptSelected(new Set());
      await refreshRun(data.runId);
    } catch (err) {
      toast({
        title: "Couldn't start the concept sweep",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setStarting(false);
    }
  };

  const confirmConcept = async () => {
    if (!run || conceptSelected.size === 0) return;
    setConceptConfirming(true);
    try {
      const targets = run.results
        .filter((r) => conceptSelected.has(key(r)))
        .map((r) => ({ kind: r.kind, id: r.id }));
      const res = await authFetch(`${BASE}/concept/runs/${run.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Confirm failed");
      toast({ title: `Notes written on ${data.written} document${data.written === 1 ? "" : "s"}` });
      await refreshRun(run.id);
    } catch (err) {
      toast({
        title: "Couldn't write the notes",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setConceptConfirming(false);
    }
  };

  const toggle = (set: Set<string>, k: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setter(next);
  };

  const kindBadge = (m: { kind: "staging" | "live" }) => (
    <Badge variant="outline" className={m.kind === "live" ? "border-emerald-300 text-emerald-700" : "border-violet-300 text-violet-700"}>
      {m.kind === "live" ? "live doc" : "draft"}
    </Badge>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px] w-[92vw] sm:max-w-[900px] max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Corpus Sweep</DialogTitle>
          <DialogDescription>
            Find every draft and live doc affected by a wording or concept problem, then leave a
            proposed-correction note on each. Notes only — no document body is ever changed by a
            sweep; apply edits doc-by-doc through the editor or Refine.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="phrase" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="shrink-0 self-start">
            <TabsTrigger value="phrase" data-testid="tab-sweep-phrase">Phrase / terminology</TabsTrigger>
            <TabsTrigger value="concept" data-testid="tab-sweep-concept">Concept (AI)</TabsTrigger>
          </TabsList>

          {/* ── Phrase mode ─────────────────────────────────────────────── */}
          <TabsContent value="phrase" className="flex-1 min-h-0 overflow-y-auto space-y-3 pt-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sweep-phrases">Phrase variants to find (one per line)</Label>
                <Textarea
                  id="sweep-phrases"
                  data-testid="input-sweep-phrases"
                  rows={3}
                  placeholder={"cost per offer click\ncost per offer-page click"}
                  value={phrasesText}
                  onChange={(e) => setPhrasesText(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sweep-replacement">Correct terminology</Label>
                <Input
                  id="sweep-replacement"
                  data-testid="input-sweep-replacement"
                  placeholder="LP Event CPC"
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Case-insensitive search across all in-pipeline drafts and live docs.
                </p>
              </div>
            </div>
            <Button
              onClick={runPreview}
              disabled={previewLoading || parsedPhrases.length === 0}
              data-testid="button-sweep-preview"
            >
              {previewLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Preview matches
            </Button>

            {matches !== null && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {matches.length === 0
                    ? "No documents contain these phrases."
                    : `${matches.length} document${matches.length === 1 ? "" : "s"} matched — untick any where the wording is fine (definitional mentions, etc.).`}
                </p>
                {matches.map((m) => (
                  <div key={key(m)} className="border rounded-md p-2.5 flex gap-2.5" data-testid={`sweep-match-${m.kind}-${m.id}`}>
                    <Checkbox
                      className="mt-0.5"
                      checked={selected.has(key(m))}
                      onCheckedChange={() => toggle(selected, key(m), setSelected)}
                      data-testid={`checkbox-sweep-${m.kind}-${m.id}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{m.title}</span>
                        {kindBadge(m)}
                        <span className="text-xs text-gray-500">
                          {m.matchCount} match{m.matchCount === 1 ? "" : "es"}
                        </span>
                      </div>
                      {m.snippets.slice(0, 3).map((s, i) => (
                        <p key={i} className="text-xs text-gray-600 mt-1 break-words">• {s}</p>
                      ))}
                    </div>
                  </div>
                ))}
                {matches.length > 0 && (
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={confirmPhrase}
                      disabled={confirming || selected.size === 0 || !replacement.trim()}
                      data-testid="button-sweep-phrase-confirm"
                    >
                      {confirming && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Leave notes on {selected.size} selected
                    </Button>
                    {phraseDone !== null && (
                      <span className="text-sm text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> Done — {phraseDone} note{phraseDone === 1 ? "" : "s"} written
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── Concept mode ────────────────────────────────────────────── */}
          <TabsContent value="concept" className="flex-1 min-h-0 overflow-y-auto space-y-3 pt-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sweep-incorrect">Flawed concept (what docs should NOT teach)</Label>
                <Textarea
                  id="sweep-incorrect"
                  data-testid="input-sweep-incorrect"
                  rows={3}
                  value={incorrectConcept}
                  onChange={(e) => setIncorrectConcept(e.target.value)}
                  placeholder="e.g. ads should be judged against each individual landing page's stats"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sweep-correct">Correct framing</Label>
                <Textarea
                  id="sweep-correct"
                  data-testid="input-sweep-correct"
                  rows={3}
                  value={correctConcept}
                  onChange={(e) => setCorrectConcept(e.target.value)}
                  placeholder="e.g. judge ads against aggregate landing-page stats initially"
                />
              </div>
            </div>
            <Button
              onClick={startConcept}
              disabled={starting || run?.status === "running" || incorrectConcept.trim().length < 10 || correctConcept.trim().length < 10}
              data-testid="button-sweep-concept-start"
            >
              {starting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Start AI sweep
            </Button>
            <p className="text-xs text-gray-500">
              Runs in the background on the server — you can close this dialog; the result is saved
              and will be here when you come back.
            </p>

            {run && (
              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <span className="font-medium">Latest run #{run.id}</span>
                  {run.status === "running" && (
                    <span className="flex items-center gap-1.5 text-blue-700 text-xs">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Checking {run.processed}/{run.total || "…"} candidate docs…
                    </span>
                  )}
                  {run.status === "failed" && (
                    <span className="flex items-center gap-1.5 text-red-700 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5" /> {run.error || "Run failed"}
                    </span>
                  )}
                  {run.status === "confirmed" && (
                    <span className="flex items-center gap-1.5 text-emerald-700 text-xs">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Notes written
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 break-words">
                  Flagged: “{run.incorrectConcept}” → “{run.correctConcept}”
                </p>

                {(run.status === "ready" || run.status === "confirmed") && (
                  <div className="space-y-2">
                    {run.results.length === 0 && (
                      <p className="text-sm text-gray-600">No candidate documents were found for this concept.</p>
                    )}
                    {run.results.map((r) => (
                      <div key={key(r)} className="border rounded-md p-2.5 flex gap-2.5" data-testid={`sweep-concept-${r.kind}-${r.id}`}>
                        {run.status === "ready" && r.verdict === "yes" && !r.noted ? (
                          <Checkbox
                            className="mt-0.5"
                            checked={conceptSelected.has(key(r))}
                            onCheckedChange={() => toggle(conceptSelected, key(r), setConceptSelected)}
                            data-testid={`checkbox-sweep-concept-${r.kind}-${r.id}`}
                          />
                        ) : (
                          <span className="w-4" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">{r.title}</span>
                            {kindBadge(r)}
                            {r.verdict === "yes" && <Badge className="bg-amber-100 text-amber-800 border-amber-200">contains flaw</Badge>}
                            {r.verdict === "no" && <Badge variant="outline" className="text-gray-500">clean</Badge>}
                            {r.verdict === "error" && (
                              <Badge variant="outline" className="border-red-300 text-red-700">check failed</Badge>
                            )}
                            {r.noted && <span className="text-[11px] text-emerald-600 font-medium">✓ Note left</span>}
                          </div>
                          {r.evidence && <p className="text-xs text-gray-600 mt-1 break-words">Evidence: “{r.evidence}”</p>}
                          {r.proposedCorrection && (
                            <p className="text-xs text-gray-600 mt-1 break-words">Proposed: {r.proposedCorrection}</p>
                          )}
                          {r.verdict === "error" && (
                            <p className="text-xs text-red-700 mt-1 break-words">
                              The AI check failed for this doc ({r.error || "unknown error"}) — review it manually.
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                    {run.status === "ready" && run.results.some((r) => r.verdict === "yes" && !r.noted) && (
                      <Button
                        onClick={confirmConcept}
                        disabled={conceptConfirming || conceptSelected.size === 0}
                        data-testid="button-sweep-concept-confirm"
                      >
                        {conceptConfirming && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Leave notes on {conceptSelected.size} selected
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
