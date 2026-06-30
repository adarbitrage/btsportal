import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Wand2,
  Upload,
  Plus,
  Sparkles,
  FileText,
  AlertTriangle,
  Trash2,
  Send,
  FolderInput,
  Loader2,
  Download,
} from "lucide-react";
import {
  listTranscriptCleanerDocuments,
  getTranscriptCleanerDocument,
  createTranscriptCleanerDocument,
  createTranscriptCleanerDocumentsBatch,
  updateTranscriptCleanerDocument,
  deleteTranscriptCleanerDocument,
  cleanTranscriptCleanerDocument,
  cleanTranscriptCleanerBatch,
  refineTranscriptCleanerDocument,
  fileTranscriptCleanerDocument,
  fileTranscriptCleanerBatch,
  previewTranscriptImport,
  runTranscriptImport,
  type TranscriptCleanerDocument,
  type TranscriptImportPlan,
} from "@/lib/admin-api";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

// Mirrors SOURCE_FOLDERS in the api-server kb-taxonomy registry (single source
// of truth). The cleaner is tool-agnostic: these are destination *types*, not
// transcription products.
const TRANSCRIPT_TYPES = [
  { slug: "group_coaching", label: "Group Coaching" },
  { slug: "private_coaching", label: "Private Coaching" },
  { slug: "one_on_one_va", label: "1-on-1 VA" },
  { slug: "blitz_video", label: "Blitz Video" },
  { slug: "other_video", label: "Other Video" },
  { slug: "reference_docs", label: "Reference Docs" },
  { slug: "other_docs", label: "Other Docs" },
];

const AUTHORITY_ROLES = [
  { value: "strategic_coach", label: "Strategic Coach" },
  { value: "va", label: "VA" },
  { value: "curriculum", label: "Curriculum" },
  { value: "internal", label: "Internal" },
];

const typeLabel = (slug: string | null) =>
  slug ? TRANSCRIPT_TYPES.find((t) => t.slug === slug)?.label ?? slug : "Untagged";
const roleLabel = (role: string | null) =>
  role ? AUTHORITY_ROLES.find((r) => r.value === role)?.label ?? role : "—";

type Tab = "intake" | "holding" | "filed";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  uploaded: { label: "Uploaded", variant: "outline" },
  cleaning: { label: "Cleaning…", variant: "secondary" },
  cleaned: { label: "Cleaned", variant: "default" },
  filed: { label: "Filed", variant: "secondary" },
  error: { label: "Error", variant: "destructive" },
};

export default function TranscriptCleaner() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>("intake");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [showImport, setShowImport] = useState(false);

  // Paste-intake form.
  const [showPaste, setShowPaste] = useState(false);
  const [pasteContent, setPasteContent] = useState("");
  const [pasteType, setPasteType] = useState<string>("");
  const [pasteSourceName, setPasteSourceName] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["transcript-cleaner-docs"],
    queryFn: () => listTranscriptCleanerDocuments(),
    refetchInterval: (q) => {
      const docs = (q.state.data?.documents ?? []) as TranscriptCleanerDocument[];
      return docs.some((d) => d.status === "cleaning") ? 2500 : false;
    },
  });

  const allDocs = data?.documents ?? [];
  const intakeDocs = allDocs.filter((d) => d.status === "uploaded" || d.status === "cleaning" || d.status === "error");
  const holdingDocs = allDocs.filter((d) => d.status === "cleaned");
  const filedDocs = allDocs.filter((d) => d.status === "filed");

  const visibleDocs = tab === "intake" ? intakeDocs : tab === "holding" ? holdingDocs : filedDocs;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["transcript-cleaner-docs"] });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const pasteMutation = useMutation({
    mutationFn: createTranscriptCleanerDocument,
    onSuccess: () => {
      invalidate();
      setShowPaste(false);
      setPasteContent("");
      setPasteSourceName("");
      setPasteType("");
      toast({ title: "Transcript added to intake" });
    },
    onError: (e: Error) => toast({ title: "Failed to add", description: e.message, variant: "destructive" }),
  });

  const batchCreateMutation = useMutation({
    mutationFn: createTranscriptCleanerDocumentsBatch,
    onSuccess: (res) => {
      invalidate();
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.length - ok;
      toast({
        title: `Uploaded ${ok} transcript${ok === 1 ? "" : "s"}`,
        description: failed > 0 ? `${failed} could not be read.` : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const cleanMutation = useMutation({
    mutationFn: cleanTranscriptCleanerDocument,
    onSuccess: () => { invalidate(); toast({ title: "Transcript cleaned" }); },
    onError: (e: Error) => toast({ title: "Cleaning failed", description: e.message, variant: "destructive" }),
  });

  const cleanBatchMutation = useMutation({
    mutationFn: cleanTranscriptCleanerBatch,
    onSuccess: (res) => {
      invalidate();
      setSelected(new Set());
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.length - ok;
      toast({ title: `Cleaned ${ok}`, description: failed > 0 ? `${failed} failed — see Intake.` : undefined });
    },
    onError: (e: Error) => toast({ title: "Batch clean failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTranscriptCleanerDocument,
    onSuccess: () => { invalidate(); toast({ title: "Discarded" }); },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const fileBatchMutation = useMutation({
    mutationFn: fileTranscriptCleanerBatch,
    onSuccess: (res) => {
      invalidate();
      setSelected(new Set());
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.length - ok;
      toast({
        title: `Filed ${ok} to Source Knowledge`,
        description: failed > 0 ? `${failed} could not be filed (check title/type).` : undefined,
        variant: failed > 0 ? "destructive" : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Batch filing failed", description: e.message, variant: "destructive" }),
  });

  // ── Upload (client-side text read, tool-agnostic) ───────────────────────────
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const items: { content: string; sourceName: string }[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        if (text.trim()) items.push({ content: text, sourceName: file.name });
      } catch {
        /* skip unreadable file */
      }
    }
    if (items.length === 0) {
      toast({ title: "No readable text found in those files", variant: "destructive" });
      return;
    }
    batchCreateMutation.mutate(items);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedIds = useMemo(
    () => visibleDocs.filter((d) => selected.has(d.id)).map((d) => d.id),
    [visibleDocs, selected],
  );

  const switchTab = (t: Tab) => { setTab(t); setSelected(new Set()); };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Wand2 className="w-6 h-6 text-primary" />
              Transcript Cleaner
            </h1>
            <p className="text-muted-foreground mt-1 max-w-2xl">
              Load raw call/video transcripts from any tool. The AI re-attributes speakers, labels the
              source of authority, fixes terminology, strips cruft, and proposes a title. Review and refine,
              then file the finished transcript into AI Source Knowledge.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.vtt,.srt,.md,.csv,.json,text/plain"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button variant="outline" onClick={() => setShowImport(true)}>
              <Download className="w-4 h-4 mr-1" /> Import triaged transcripts
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={batchCreateMutation.isPending}>
              <Upload className="w-4 h-4 mr-1" /> Upload files
            </Button>
            <Button onClick={() => setShowPaste(true)}>
              <Plus className="w-4 h-4 mr-1" /> Paste transcript
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b">
          {([
            ["intake", `Intake (${intakeDocs.length})`],
            ["holding", `Holding (${holdingDocs.length})`],
            ["filed", `Filed (${filedDocs.length})`],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => switchTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Batch action bar */}
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-4 py-2">
            <span className="text-sm font-medium">{selectedIds.length} selected</span>
            {tab === "intake" && (
              <Button size="sm" onClick={() => cleanBatchMutation.mutate(selectedIds)} disabled={cleanBatchMutation.isPending}>
                {cleanBatchMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                Clean selected
              </Button>
            )}
            {tab === "holding" && (
              <Button size="sm" onClick={() => fileBatchMutation.mutate(selectedIds)} disabled={fileBatchMutation.isPending}>
                {fileBatchMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FolderInput className="w-4 h-4 mr-1" />}
                File selected to Source Knowledge
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : visibleDocs.length === 0 ? (
              <div className="p-12 text-center">
                <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-sm font-medium">
                  {tab === "intake" ? "No transcripts loaded yet" : tab === "holding" ? "Nothing in the holding area" : "Nothing filed yet"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {tab === "intake"
                    ? "Upload files or paste a transcript to get started. Imported transcripts also appear here."
                    : tab === "holding"
                    ? "Cleaned transcripts awaiting review/filing show up here."
                    : "Filed transcripts land in AI Source Knowledge."}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {tab !== "filed" && <TableHead className="w-8"></TableHead>}
                    <TableHead>Title / Source</TableHead>
                    <TableHead>Type</TableHead>
                    {tab !== "intake" && <TableHead>Authority</TableHead>}
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleDocs.map((doc) => {
                    const flagCount = doc.flags?.length ?? 0;
                    const badge = STATUS_BADGE[doc.status] ?? { label: doc.status, variant: "outline" as const };
                    return (
                      <TableRow key={doc.id}>
                        {tab !== "filed" && (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={selected.has(doc.id)} onCheckedChange={() => toggleSelect(doc.id)} />
                          </TableCell>
                        )}
                        <TableCell className="max-w-xs">
                          <div className="font-medium truncate">{doc.title || doc.suggestedTitle || doc.sourceName || `Transcript #${doc.id}`}</div>
                          {doc.sourceName && (doc.title || doc.suggestedTitle) && (
                            <div className="text-xs text-muted-foreground truncate">{doc.sourceName}</div>
                          )}
                          {doc.titleNeedsInput && (
                            <span className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                              <AlertTriangle className="w-3 h-3" /> Title needs a date
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{typeLabel(doc.transcriptType)}</Badge>
                        </TableCell>
                        {tab !== "intake" && (
                          <TableCell>
                            {doc.authorityRole ? (
                              <span className="flex items-center gap-1">
                                <Badge variant="secondary">{roleLabel(doc.authorityRole)}</Badge>
                                {doc.authorityConfidence === "low" && (
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                                )}
                              </span>
                            ) : "—"}
                          </TableCell>
                        )}
                        <TableCell>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                          {flagCount > 0 && doc.status !== "filed" && (
                            <Badge variant="outline" className="ml-1 text-amber-600 border-amber-300">{flagCount} flag{flagCount === 1 ? "" : "s"}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {doc.updatedAt ? format(new Date(doc.updatedAt), "MMM d, HH:mm") : "—"}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {doc.status === "uploaded" || doc.status === "error" ? (
                            <Button size="sm" variant="outline" onClick={() => cleanMutation.mutate(doc.id)} disabled={cleanMutation.isPending}>
                              <Sparkles className="w-3.5 h-3.5 mr-1" /> Clean
                            </Button>
                          ) : doc.status === "cleaning" ? (
                            <span className="text-xs text-muted-foreground flex items-center justify-end gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cleaning</span>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setReviewId(doc.id)}>
                              Review
                            </Button>
                          )}
                          {(doc.status === "uploaded" || doc.status === "error" || doc.status === "cleaned") && (
                            <Button size="sm" variant="ghost" className="ml-1 text-destructive" onClick={() => deleteMutation.mutate(doc.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Paste intake dialog */}
      <Dialog open={showPaste} onOpenChange={(o) => { if (!o) setShowPaste(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Paste a transcript</DialogTitle>
            <DialogDescription>
              Paste raw transcript text from any transcription tool. You can tag the type now or later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium mb-1 block">Transcript type</Label>
                <Select value={pasteType} onValueChange={setPasteType}>
                  <SelectTrigger><SelectValue placeholder="Choose type (optional)" /></SelectTrigger>
                  <SelectContent>
                    {TRANSCRIPT_TYPES.map((t) => (
                      <SelectItem key={t.slug} value={t.slug}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium mb-1 block">Source name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input value={pasteSourceName} onChange={(e) => setPasteSourceName(e.target.value)} placeholder="e.g. original file / recording name" />
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium mb-1 block">Transcript</Label>
              <Textarea value={pasteContent} onChange={(e) => setPasteContent(e.target.value)} placeholder="Paste the raw transcript…" className="min-h-[260px] font-mono text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaste(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!pasteContent.trim()) { toast({ title: "Transcript content is required", variant: "destructive" }); return; }
                pasteMutation.mutate({
                  content: pasteContent,
                  transcriptType: pasteType || undefined,
                  sourceName: pasteSourceName || undefined,
                });
              }}
              disabled={pasteMutation.isPending}
            >
              Add to intake
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review dialog */}
      {reviewId !== null && (
        <ReviewDialog docId={reviewId} onClose={() => setReviewId(null)} onChanged={invalidate} />
      )}

      {/* Triaged-import dialog */}
      {showImport && (
        <ImportDialog onClose={() => setShowImport(false)} onImported={invalidate} />
      )}
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gated import of triaged transcripts (Task #1484): preview the approved triage
// manifest, then confirm to load the keepers into intake.
// ─────────────────────────────────────────────────────────────────────────────

const IMPORT_ACTION_LABEL: Record<string, string> = {
  import: "Will import",
  skip_excluded: "Skipped — excluded",
  skip_already_imported: "Skipped — already imported",
  skip_unknown_folder: "Skipped — unknown folder",
  skip_missing_sources: "Skipped — missing source",
  skip_empty_content: "Skipped — empty content",
};

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { toast } = useToast();
  const [result, setResult] = useState<TranscriptImportPlan | null>(null);
  const [imported, setImported] = useState(false);

  const { data: plan, isLoading, error } = useQuery({
    queryKey: ["transcript-import-preview"],
    queryFn: previewTranscriptImport,
    refetchOnWindowFocus: false,
  });

  const runMutation = useMutation({
    mutationFn: runTranscriptImport,
    onSuccess: (res) => {
      setResult(res);
      setImported(true);
      onImported();
      toast({ title: `Imported ${res.summary.imported} transcript${res.summary.imported === 1 ? "" : "s"}` });
    },
    onError: (e: Error) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const view = result ?? plan ?? null;
  const summary = view?.summary;
  const skipped = view?.entries.filter((e) => e.action !== "import") ?? [];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import triaged transcripts</DialogTitle>
          <DialogDescription>
            Loads the approved keepers from the triage manifest into Intake — multi-part recordings are
            stitched into one transcript and titled from the approved name. Nothing is cleaned or filed.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Reading manifest…
          </div>
        ) : error ? (
          <div className="p-6 text-center text-sm text-destructive">
            {(error as Error).message || "Could not read the triage manifest."}
          </div>
        ) : summary ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label={imported ? "Imported" : "To import"} value={imported ? summary.imported : summary.toImport} highlight />
              <Stat label="Stitched (multi-part)" value={summary.stitched} />
              <Stat label="Renamed" value={summary.renamed} />
              <Stat label="Duplicate parts dropped" value={summary.duplicatePartsDropped} />
              <Stat label="Already imported" value={summary.alreadyImported} />
              <Stat label="Excluded" value={summary.excluded} />
              <Stat label="Missing sources" value={summary.missingSources} />
              <Stat label="Unknown folder / empty" value={summary.unknownFolder + summary.emptyContent} />
            </div>

            {Object.keys(summary.byFolder).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(summary.byFolder).map(([slug, n]) => (
                  <Badge key={slug} variant="outline">{typeLabel(slug)}: {n}</Badge>
                ))}
              </div>
            )}

            {skipped.length > 0 && (
              <div className="border rounded-md max-h-56 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Group</TableHead>
                      <TableHead>Disposition</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skipped.map((e) => (
                      <TableRow key={e.groupId}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {e.groupId}
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]">{e.originalTitle}</div>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{IMPORT_ACTION_LABEL[e.action] ?? e.action}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          {imported ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending || isLoading || !!error || !summary || summary.toImport === 0}
              >
                {runMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                Import {summary?.toImport ?? 0} transcript{(summary?.toImport ?? 0) === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? "border-primary/40 bg-primary/5" : ""}`}>
      <div className={`text-2xl font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Review dialog: side-by-side original vs cleaned, flags, authority, title edit,
// refinement chat, and per-item filing.
// ─────────────────────────────────────────────────────────────────────────────

function ReviewDialog({ docId, onClose, onChanged }: { docId: number; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [instruction, setInstruction] = useState("");

  const { data: doc, isLoading } = useQuery({
    queryKey: ["transcript-cleaner-doc", docId],
    queryFn: () => getTranscriptCleanerDocument(docId),
  });

  const [title, setTitle] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  const titleValue = title ?? doc?.title ?? "";
  const typeValue = type ?? doc?.transcriptType ?? "";
  const roleValue = role ?? doc?.authorityRole ?? "";

  // ── Inline flag highlighting ──────────────────────────────────────────────
  // Each review flag can carry a `text` snippet; anchor it inside the panes so
  // the admin can jump straight to the uncertain spot instead of eyeballing it.
  const [activeFlag, setActiveFlag] = useState<number | null>(null);
  const markRefs = useRef<Map<string, HTMLElement>>(new Map());
  const activeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanedText = doc?.cleanedContent ?? "";
  const originalText = doc?.originalContent ?? "";

  const flagsWithText = useMemo(
    () =>
      (doc?.flags ?? [])
        .map((f, index) => ({ index, text: (f.text ?? "").trim() }))
        .filter((f) => f.text.length > 0),
    [doc?.flags],
  );

  // Which flags can actually be anchored to a spot in either pane. Flags whose
  // snippet matches nothing stay in the list but are not clickable.
  const locatableSet = useMemo(() => {
    const s = new Set<number>();
    const lowerCleaned = cleanedText.toLowerCase();
    const lowerOriginal = originalText.toLowerCase();
    for (const f of flagsWithText) {
      const needle = f.text.toLowerCase();
      if (lowerCleaned.includes(needle) || lowerOriginal.includes(needle)) s.add(f.index);
    }
    return s;
  }, [flagsWithText, cleanedText, originalText]);

  const registerMark = (key: string, el: HTMLElement | null) => {
    if (el) markRefs.current.set(key, el);
    else markRefs.current.delete(key);
  };

  const handleFlagClick = (index: number) => {
    if (!locatableSet.has(index)) return;
    const el = markRefs.current.get(`cleaned-${index}`) ?? markRefs.current.get(`original-${index}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setActiveFlag(index);
    if (activeTimer.current) clearTimeout(activeTimer.current);
    activeTimer.current = setTimeout(() => setActiveFlag(null), 2500);
  };

  useEffect(() => () => { if (activeTimer.current) clearTimeout(activeTimer.current); }, []);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["transcript-cleaner-doc", docId] });
    onChanged();
  };

  const saveMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateTranscriptCleanerDocument>[1]) => updateTranscriptCleanerDocument(docId, patch),
    onSuccess: () => { refresh(); toast({ title: "Saved" }); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const refineMutation = useMutation({
    mutationFn: (text: string) => refineTranscriptCleanerDocument(docId, text),
    onSuccess: () => { refresh(); setInstruction(""); toast({ title: "Transcript updated" }); },
    onError: (e: Error) => toast({ title: "Refinement failed", description: e.message, variant: "destructive" }),
  });

  const fileMutation = useMutation({
    mutationFn: () => fileTranscriptCleanerDocument(docId),
    onSuccess: () => { refresh(); toast({ title: "Filed to Source Knowledge" }); onClose(); },
    onError: (e: Error) => toast({ title: "Filing failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review &amp; refine transcript</DialogTitle>
          <DialogDescription>
            Edit the title, confirm the type and authority, refine via chat, then file to Source Knowledge.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !doc ? (
          <div className="p-8 text-center text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-5">
            {/* Title + type + authority controls */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-6">
                <Label className="text-sm font-medium mb-1 block">Title</Label>
                <Input value={titleValue} onChange={(e) => setTitle(e.target.value)} placeholder="Title used when filed" />
                {doc.suggestedTitle && (
                  <button
                    className="text-xs text-primary mt-1 hover:underline"
                    onClick={() => setTitle(doc.suggestedTitle!)}
                  >
                    Use suggestion: {doc.suggestedTitle}
                  </button>
                )}
                {doc.proposedTitle && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Imported title:{" "}
                    <button className="text-primary hover:underline" onClick={() => setTitle(doc.proposedTitle!)}>
                      {doc.proposedTitle}
                    </button>
                  </div>
                )}
                {doc.titleNeedsInput && (
                  <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
                    <AlertTriangle className="w-3 h-3" /> Date couldn't be determined — add it to the title.
                  </p>
                )}
              </div>
              <div className="md:col-span-3">
                <Label className="text-sm font-medium mb-1 block">Type / folder</Label>
                <Select value={typeValue} onValueChange={setType}>
                  <SelectTrigger><SelectValue placeholder="Choose type" /></SelectTrigger>
                  <SelectContent>
                    {TRANSCRIPT_TYPES.map((t) => (
                      <SelectItem key={t.slug} value={t.slug}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-3">
                <Label className="text-sm font-medium mb-1 block">Authority role</Label>
                <Select value={roleValue} onValueChange={setRole}>
                  <SelectTrigger><SelectValue placeholder="Authority" /></SelectTrigger>
                  <SelectContent>
                    {AUTHORITY_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {doc.authorityConfidence && (
                  <p className={`text-xs mt-1 ${doc.authorityConfidence === "low" ? "text-amber-600" : "text-muted-foreground"}`}>
                    {doc.authorityConfidence === "low" ? "Low confidence — confirm" : "High confidence"}
                  </p>
                )}
              </div>
            </div>

            {doc.authorityEvidence && (
              <p className="text-xs text-muted-foreground -mt-2">
                <span className="font-medium">Authority evidence:</span> {doc.authorityEvidence}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  saveMutation.mutate({
                    title: titleValue,
                    transcriptType: typeValue || undefined,
                    authorityRole: roleValue || undefined,
                  })
                }
                disabled={saveMutation.isPending}
              >
                Save changes
              </Button>
            </div>

            {/* Flags */}
            {doc.flags && doc.flags.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-1.5">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> {doc.flags.length} item{doc.flags.length === 1 ? "" : "s"} flagged for review
                </p>
                <ul className="space-y-1">
                  {doc.flags.map((f, i) => {
                    const locatable = locatableSet.has(i);
                    const body = (
                      <>
                        <span className="font-medium">{f.type.replace(/_/g, " ")}:</span> {f.reason}
                        {f.text && <span className="block text-amber-700/80 italic truncate">“{f.text}”</span>}
                      </>
                    );
                    return (
                      <li key={i} className="text-xs text-amber-800 dark:text-amber-300">
                        {locatable ? (
                          <button
                            type="button"
                            onClick={() => handleFlagClick(i)}
                            className={`w-full text-left rounded-sm px-1 -mx-1 hover:bg-amber-100/80 dark:hover:bg-amber-900/30 transition-colors ${
                              activeFlag === i ? "bg-amber-100 dark:bg-amber-900/40 ring-1 ring-amber-400" : ""
                            }`}
                            title="Jump to this spot in the transcript"
                          >
                            {body}
                          </button>
                        ) : (
                          <div>{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Side-by-side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Original (preserved)</p>
                <pre className="whitespace-pre-wrap break-words text-xs font-mono bg-muted/40 rounded-md p-3 h-[340px] overflow-y-auto">
                  <HighlightedText
                    text={originalText}
                    flags={flagsWithText}
                    pane="original"
                    activeFlag={activeFlag}
                    registerMark={registerMark}
                  />
                </pre>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Cleaned</p>
                <pre className="whitespace-pre-wrap break-words text-xs font-mono bg-muted/20 border rounded-md p-3 h-[340px] overflow-y-auto">
                  {cleanedText ? (
                    <HighlightedText
                      text={cleanedText}
                      flags={flagsWithText}
                      pane="cleaned"
                      activeFlag={activeFlag}
                      registerMark={registerMark}
                    />
                  ) : (
                    "(not cleaned yet)"
                  )}
                </pre>
              </div>
            </div>

            {/* Refinement chat */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Refinement chat</p>
              {doc.chatHistory && doc.chatHistory.length > 0 && (
                <div className="space-y-1.5 mb-2 max-h-[160px] overflow-y-auto">
                  {doc.chatHistory.map((m, i) => (
                    <div key={i} className={`text-xs rounded-md px-2.5 py-1.5 ${m.role === "user" ? "bg-primary/10 text-foreground" : "bg-muted text-muted-foreground"}`}>
                      <span className="font-medium">{m.role === "user" ? "You" : "Cleaner"}:</span> {m.content}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && instruction.trim()) refineMutation.mutate(instruction.trim()); }}
                  placeholder='e.g. "Speaker 2 is the coach" or "merge the two member labels"'
                />
                <Button
                  onClick={() => { if (instruction.trim()) refineMutation.mutate(instruction.trim()); }}
                  disabled={refineMutation.isPending || !instruction.trim()}
                >
                  {refineMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            onClick={() => {
              if (!titleValue.trim() || !typeValue) {
                toast({ title: "A title and type are required to file", variant: "destructive" });
                return;
              }
              // Persist edits first, then file.
              saveMutation.mutate(
                { title: titleValue, transcriptType: typeValue, authorityRole: roleValue || undefined },
                { onSuccess: () => fileMutation.mutate() },
              );
            }}
            disabled={fileMutation.isPending || saveMutation.isPending}
          >
            <FolderInput className="w-4 h-4 mr-1" /> File to Source Knowledge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline highlight rendering for the review panes.
// ─────────────────────────────────────────────────────────────────────────────

type HighlightSegment = { text: string; flagIndex: number | null };

/**
 * Split `text` into plain + flagged segments by case-insensitively matching each
 * flag's snippet (first occurrence). Overlapping matches are dropped so the
 * earliest-anchored flag wins, and unmatched flags simply produce no segment —
 * the review list keeps showing them, nothing breaks.
 */
function computeHighlightSegments(
  text: string,
  flags: { index: number; text: string }[],
): HighlightSegment[] {
  if (!text || flags.length === 0) return [{ text, flagIndex: null }];
  const lower = text.toLowerCase();
  const matches: { start: number; end: number; flagIndex: number }[] = [];
  for (const f of flags) {
    const needle = f.text.toLowerCase();
    if (!needle) continue;
    const at = lower.indexOf(needle);
    if (at === -1) continue;
    matches.push({ start: at, end: at + f.text.length, flagIndex: f.index });
  }
  if (matches.length === 0) return [{ text, flagIndex: null }];
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof matches = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      kept.push(m);
      lastEnd = m.end;
    }
  }
  const segs: HighlightSegment[] = [];
  let cursor = 0;
  for (const m of kept) {
    if (m.start > cursor) segs.push({ text: text.slice(cursor, m.start), flagIndex: null });
    segs.push({ text: text.slice(m.start, m.end), flagIndex: m.flagIndex });
    cursor = m.end;
  }
  if (cursor < text.length) segs.push({ text: text.slice(cursor), flagIndex: null });
  return segs;
}

function HighlightedText({
  text,
  flags,
  pane,
  activeFlag,
  registerMark,
}: {
  text: string;
  flags: { index: number; text: string }[];
  pane: "original" | "cleaned";
  activeFlag: number | null;
  registerMark: (key: string, el: HTMLElement | null) => void;
}) {
  const segments = useMemo(() => computeHighlightSegments(text, flags), [text, flags]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.flagIndex === null ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <mark
            key={i}
            ref={(el) => registerMark(`${pane}-${seg.flagIndex}`, el)}
            className={`rounded-sm px-0.5 text-foreground ${
              activeFlag === seg.flagIndex
                ? "bg-amber-400/80 ring-2 ring-amber-500"
                : "bg-amber-200/70 dark:bg-amber-500/30"
            }`}
          >
            {seg.text}
          </mark>
        ),
      )}
    </>
  );
}
