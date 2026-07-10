import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth";
import {
  ChevronLeft,
  CheckCircle,
  Loader2,
  Merge,
  Eye,
  Sparkles,
  FolderTree,
  GitCompare,
  FileText,
  AlertTriangle,
  Undo2,
  Trash2,
  X,
  CheckSquare,
} from "lucide-react";

// ── Types (duplicates endpoint payload) ───────────────────────────────────────

export interface LiveSimilarMatch {
  liveDocId: number;
  liveTitle: string;
  reason: "title" | "content";
  similarity: number;
}

interface DupDoc {
  id: number;
  title: string;
  content: string;
  editedContent: string | null;
  status: string;
  homeRoot: string | null;
  node: string | null;
  docClassTarget: string | null;
  updateKind: string | null;
  targetLiveDocId: number | null;
  createdAt: string;
  liveSimilar: LiveSimilarMatch | null;
}

interface DupCluster {
  key: string;
  docs: DupDoc[];
}

interface MergedDoc {
  id: number;
  title: string;
  homeRoot: string | null;
  node: string | null;
  createdAt: string;
}

interface MergedGroup {
  canonicalId: number;
  canonicalTitle: string | null;
  canonicalStatus: string | null;
  docs: MergedDoc[];
}

interface LiveDocDetail {
  id: number;
  title: string;
  content: string;
  docClass: string | null;
  homeRoot: string | null;
  node: string | null;
  lastVerified: string | null;
}

// Shared live-doc viewer dialog — also used by the main review page for the
// "similar live doc" indicator in the normal flow.
export function LiveDocDialog({
  liveDocId,
  onClose,
}: {
  liveDocId: number | null;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<LiveDocDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (liveDocId == null) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    authFetch(`/admin/knowledgebase/staging/live-doc/${liveDocId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed to load live document");
        return res.json();
      })
      .then((d) => { if (!cancelled) setDoc(d); })
      .catch((err) => toast({ title: "Error loading live document", description: err instanceof Error ? err.message : undefined, variant: "destructive" }))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [liveDocId, toast]);

  return (
    <Dialog open={liveDocId != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FileText className="w-5 h-5 text-blue-600" />
            {loading ? "Loading live document…" : doc?.title ?? "Live document"}
          </DialogTitle>
        </DialogHeader>
        {doc && (
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Published live doc #{doc.id}</Badge>
            {doc.docClass && <Badge variant="outline">{doc.docClass}</Badge>}
            {doc.homeRoot && (
              <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">
                <FolderTree className="w-2.5 h-2.5 mr-1" />{doc.homeRoot}{doc.node ? ` / ${doc.node}` : ""}
              </Badge>
            )}
            {doc.lastVerified && (
              <span className="text-gray-400">verified {new Date(doc.lastVerified).toLocaleDateString()}</span>
            )}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 rounded-lg border p-4 mt-2">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">{doc?.content}</pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Possible-duplicates review view ───────────────────────────────────────────

export default function KnowledgeBaseDuplicates({ onBack }: { onBack: () => void }) {
  const [clusters, setClusters] = useState<DupCluster[]>([]);
  const [mergedGroups, setMergedGroups] = useState<MergedGroup[]>([]);
  const [loading, setLoading] = useState(true);
  // ── Free-form merge selection (Task #1890) ──────────────────────────────────
  // A GLOBAL set of draft ids the reviewer has chosen to merge — not confined to
  // a single auto-detected cluster. Clusters are only starting-point
  // suggestions; the reviewer can pick any drafts across any groups/files.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // The single draft the reviewer explicitly chose to KEEP. No default — the
  // reviewer must pick before resolving.
  const [keptId, setKeptId] = useState<number | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [canonicalTitle, setCanonicalTitle] = useState("");
  const [canonicalContent, setCanonicalContent] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [viewLiveDocId, setViewLiveDocId] = useState<number | null>(null);
  // Two-step delete: `deleteTarget` opens the confirm dialog (step 1), and
  // `deleteArmed` gates the final permanent-delete button (step 2).
  const [deleteTarget, setDeleteTarget] = useState<DupDoc | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const fetchClusters = useCallback(async () => {
    setLoading(true);
    try {
      const [dupRes, mergedRes] = await Promise.all([
        authFetch("/admin/knowledgebase/staging/duplicates"),
        authFetch("/admin/knowledgebase/staging/duplicates/merged"),
      ]);
      if (!dupRes.ok) throw new Error((await dupRes.json()).error || "Failed to load duplicates");
      const data = await dupRes.json();
      setClusters(data.clusters ?? []);
      if (mergedRes.ok) {
        const mergedData = await mergedRes.json();
        setMergedGroups(mergedData.groups ?? []);
      } else {
        setMergedGroups([]);
      }
    } catch (err) {
      toast({ title: "Error loading duplicates", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchClusters(); }, [fetchClusters]);

  // Every draft currently surfaced, keyed by id (drafts never repeat across
  // clusters — union-find groups are disjoint).
  const docById = new Map<number, DupDoc>();
  for (const c of clusters) for (const d of c.docs) docById.set(d.id, d);

  // Prune stale selections/kept when the cluster set changes (a draft that was
  // merged or deleted elsewhere leaves the needs-review pool).
  useEffect(() => {
    const present = new Set<number>();
    for (const c of clusters) for (const d of c.docs) present.add(d.id);
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => present.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [clusters]);

  // Selected drafts that still exist, in selection order.
  const selectedDocs = [...selectedIds]
    .map((id) => docById.get(id))
    .filter((d): d is DupDoc => Boolean(d));
  const validKeptId = keptId != null && selectedDocs.some((d) => d.id === keptId) ? keptId : null;
  const mergeTargetIds = selectedDocs.filter((d) => d.id !== validKeptId).map((d) => d.id);

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Reset any AI draft — the merge inputs changed.
    setCanonicalContent(null);
  }

  function selectGroup(c: DupCluster) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const d of c.docs) next.add(d.id);
      return next;
    });
    setCanonicalContent(null);
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setKeptId(null);
    setCanonicalContent(null);
    setCanonicalTitle("");
    setWorkspaceOpen(false);
  }

  function pickKept(doc: DupDoc) {
    setKeptId(doc.id);
    // Only default the title to the kept draft's own title when no AI merge
    // draft is in play (the AI draft carries its own canonical title).
    if (canonicalContent == null) setCanonicalTitle(doc.title);
  }

  async function proposeMerge() {
    if (selectedDocs.length < 2) {
      toast({ title: "Select at least two drafts", description: "Pick the drafts you want to merge first.", variant: "destructive" });
      return;
    }
    setProposing(true);
    try {
      const res = await authFetch("/admin/knowledgebase/staging/duplicates/propose-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedDocs.map((d) => d.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI merge proposal failed");
      const keptDoc = selectedDocs.find((d) => d.id === validKeptId);
      setCanonicalTitle(data.proposedTitle || canonicalTitle || keptDoc?.title || "");
      setCanonicalContent(data.proposedContent);
      toast({ title: "AI merge draft ready", description: "Review and edit the merged draft below — nothing is saved until you resolve." });
    } catch (err) {
      toast({ title: "AI merge proposal failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setProposing(false);
    }
  }

  async function resolveMerge() {
    if (validKeptId == null) {
      toast({ title: "Choose a draft to keep", description: "Pick which selected draft to keep before merging.", variant: "destructive" });
      return;
    }
    if (mergeTargetIds.length === 0) {
      toast({ title: "Select at least one draft to merge", description: "Add another draft to fold into the kept one.", variant: "destructive" });
      return;
    }
    setResolving(true);
    try {
      const res = await authFetch("/admin/knowledgebase/staging/duplicates/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalId: validKeptId,
          mergedIds: mergeTargetIds,
          title: canonicalTitle.trim() || undefined,
          content: canonicalContent ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resolve duplicates");
      toast({
        title: `Kept 1, marked ${data.merged} merged`,
        description: "The kept draft stays in Needs Review for normal approval. Unselected drafts were left untouched.",
      });
      clearSelection();
      fetchClusters();
    } catch (err) {
      toast({ title: "Resolve failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setResolving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleting(true);
    try {
      const res = await authFetch(`/admin/knowledgebase/staging/duplicates/${id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete draft");
      toast({ title: "Draft deleted", description: "The duplicate draft was permanently removed." });
      // Drop it from any pending selection so counts stay honest.
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (keptId === id) setKeptId(null);
      setDeleteTarget(null);
      setDeleteArmed(false);
      fetchClusters();
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  async function restoreMerged(id: number) {
    setRestoringId(id);
    try {
      const res = await authFetch("/admin/knowledgebase/staging/duplicates/unmerge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 409 = already restored elsewhere; treat as a soft success + refresh.
        if (res.status === 409) {
          toast({ title: "Already restored", description: "This draft was no longer merged — refreshing." });
          fetchClusters();
          return;
        }
        throw new Error(data.error || "Failed to restore draft");
      }
      toast({ title: "Draft restored", description: "It's back in Needs Review for normal approval." });
      fetchClusters();
    } catch (err) {
      toast({ title: "Restore failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setRestoringId(null);
    }
  }

  // Reusable draft badges (id / taxonomy / similar-live-doc indicator).
  function DraftBadges({ doc }: { doc: DupDoc }) {
    return (
      <>
        <Badge variant="outline" className="text-[10px]">#{doc.id}</Badge>
        {doc.homeRoot && (
          <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700 border-sky-200">
            <FolderTree className="w-2.5 h-2.5 mr-1" />{doc.homeRoot}{doc.node ? ` / ${doc.node}` : ""}
          </Badge>
        )}
        {doc.docClassTarget && <Badge variant="outline" className="text-[10px]">{doc.docClassTarget}</Badge>}
        {doc.liveSimilar && (
          <Badge
            variant="outline"
            className="text-[10px] bg-blue-50 text-blue-700 border-blue-300 cursor-pointer hover:bg-blue-100"
            onClick={() => setViewLiveDocId(doc.liveSimilar!.liveDocId)}
            title={`A published live doc looks similar (${doc.liveSimilar.reason === "title" ? "same concept title" : `content ${Math.round(doc.liveSimilar.similarity * 100)}% similar`}). Click to read it. Informational only.`}
          >
            <Eye className="w-2.5 h-2.5 mr-1" />Similar live doc: {doc.liveSimilar.liveTitle}
          </Badge>
        )}
      </>
    );
  }

  // Two-step delete confirmation dialog (shared across views). Step 1 = "Delete
  // draft" arms it; step 2 = "Yes, permanently delete" executes — a single
  // click can never delete.
  const deleteDialog = (
    <Dialog
      open={deleteTarget != null}
      onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteArmed(false); } }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg text-red-700">
            <AlertTriangle className="w-5 h-5" /> Delete this duplicate draft?
          </DialogTitle>
        </DialogHeader>
        {deleteTarget && (
          <div className="space-y-3 text-sm">
            <p className="text-gray-700">
              You're about to permanently delete{" "}
              <span className="font-medium">“{deleteTarget.title}”</span>{" "}
              <span className="text-gray-400">(#{deleteTarget.id})</span>. This can't be undone and it won't reappear in the review queue.
            </p>
            {!deleteArmed ? (
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => { setDeleteTarget(null); setDeleteArmed(false); }} data-testid="button-delete-cancel">
                  Cancel
                </Button>
                <Button variant="outline" size="sm" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setDeleteArmed(true)} data-testid="button-delete-arm">
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete draft
                </Button>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-medium text-red-700">
                  Are you absolutely sure? Confirm once more to permanently delete it.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setDeleteTarget(null); setDeleteArmed(false); }} data-testid="button-delete-cancel-armed">
                    Cancel
                  </Button>
                  <Button size="sm" className="bg-red-600 hover:bg-red-700" onClick={confirmDelete} disabled={deleting} data-testid="button-delete-confirm">
                    {deleting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
                    Yes, permanently delete
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

  // ── Merge workspace (side-by-side compare of the free-form selection) ───────
  if (workspaceOpen) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => setWorkspaceOpen(false)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Back to duplicate list
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={proposeMerge} disabled={proposing || resolving || selectedDocs.length < 2}
              className="border-violet-300 text-violet-700 hover:bg-violet-50">
              {proposing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {proposing ? "Drafting…" : "AI merge draft"}
            </Button>
            <Button onClick={resolveMerge} disabled={resolving || validKeptId == null || mergeTargetIds.length === 0}
              className="bg-purple-600 hover:bg-purple-700" data-testid="button-resolve-cluster">
              {resolving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Merge className="w-4 h-4 mr-2" />}
              Keep 1, mark {mergeTargetIds.length} merged
            </Button>
          </div>
        </div>

        <Card className="border-purple-200 bg-purple-50/50">
          <CardContent className="py-3 px-4 space-y-3">
            <div className="text-sm text-purple-900 font-medium flex items-center gap-2">
              <GitCompare className="w-4 h-4" />
              {selectedDocs.length} drafts selected to merge{" "}
              {validKeptId == null ? "— choose which one to keep." : "— the others are marked merged (nothing is auto-approved)."}
            </div>
            <div>
              <Label className="text-xs">Canonical title (editable — this becomes the kept draft's title)</Label>
              <Input
                value={canonicalTitle}
                onChange={(e) => setCanonicalTitle(e.target.value)}
                className="bg-white"
                placeholder={validKeptId == null ? "Pick a draft to keep first" : undefined}
              />
            </div>
            {canonicalContent != null && (
              <div>
                <Label className="text-xs flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-violet-600" />
                  AI-merged draft (editable — applied to the kept draft on resolve; clear it to keep the original text)
                </Label>
                <Textarea value={canonicalContent} onChange={(e) => setCanonicalContent(e.target.value)} rows={10} className="font-mono text-xs bg-white" />
                <Button variant="ghost" size="sm" className="mt-1 h-6 px-2 text-[11px] text-gray-500" onClick={() => setCanonicalContent(null)}>
                  Discard AI draft — keep the selected draft's own content
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {selectedDocs.length < 2 ? (
          <Card>
            <CardContent className="py-10 text-center text-gray-500 text-sm">
              Select at least two drafts to merge. Go back to the list and pick more.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {selectedDocs.map((doc) => {
              const isKept = doc.id === validKeptId;
              return (
                <Card key={doc.id} className={`flex flex-col ${isKept ? "ring-2 ring-purple-500 border-purple-300" : "opacity-95"}`}>
                  <CardContent className="p-4 space-y-2 flex flex-col flex-1 min-h-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm text-gray-900">{doc.title}</h3>
                      {isKept ? (
                        <Badge className="bg-purple-600 shrink-0">Keeping</Badge>
                      ) : (
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] shrink-0" onClick={() => pickKept(doc)} data-testid={`button-keep-${doc.id}`}>
                          Keep this one
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px]">
                      <button
                        type="button"
                        className="text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"
                        onClick={() => toggleSelected(doc.id)}
                        data-testid={`button-remove-selected-${doc.id}`}
                      >
                        <X className="w-3 h-3" /> Remove from merge
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                      <DraftBadges doc={doc} />
                    </div>
                    <div className="bg-gray-50 rounded border p-2.5 overflow-y-auto max-h-96 flex-1">
                      <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 leading-relaxed">
                        {doc.editedContent || doc.content}
                      </pre>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <LiveDocDialog liveDocId={viewLiveDocId} onClose={() => setViewLiveDocId(null)} />
        {deleteDialog}
      </div>
    );
  }

  // ── Cluster list (free-form selection surface) ──────────────────────────────
  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Back to review list
            </Button>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mt-1 flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-purple-600" />Possible Duplicates
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Needs-review drafts grouped by concept as suggestions. Tick any drafts — across different groups and files — then merge them, keeping the one you choose. The kept draft still goes through normal review. You can also permanently delete a redundant draft.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>
      ) : clusters.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
            <p className="text-gray-600 text-lg">No likely duplicates found</p>
            <p className="text-gray-400 mt-1">All needs-review drafts look like distinct concepts.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {clusters.map((c, i) => (
            <Card key={c.key} data-testid={`card-dup-cluster-${i}`}>
              <CardContent className="py-4 px-5 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900 capitalize">{c.key}</h3>
                      <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">{c.docs.length} drafts</Badge>
                      {c.docs.some((d) => d.liveSimilar) && (
                        <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-300">
                          <AlertTriangle className="w-2.5 h-2.5 mr-1" />similar live doc exists
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">Suggested group — tick any drafts to merge, or select the whole group.</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-purple-300 text-purple-700"
                    onClick={() => selectGroup(c)}
                    data-testid={`button-select-group-${i}`}
                  >
                    <CheckSquare className="w-4 h-4 mr-1.5" />Select all
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {c.docs.map((doc) => {
                    const isSelected = selectedIds.has(doc.id);
                    return (
                      <div
                        key={doc.id}
                        className={`rounded border p-2.5 flex items-start gap-2.5 ${isSelected ? "border-purple-300 bg-purple-50/40" : "border-gray-200"}`}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 mt-0.5 accent-purple-600 shrink-0 cursor-pointer"
                          checked={isSelected}
                          onChange={() => toggleSelected(doc.id)}
                          data-testid={`checkbox-select-${doc.id}`}
                          aria-label={`Select draft ${doc.title}`}
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-medium text-gray-900">{doc.title}</span>
                            <DraftBadges doc={doc} />
                          </div>
                          <p className="text-xs text-gray-500 line-clamp-2">{doc.editedContent || doc.content}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 shrink-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
                          onClick={() => { setDeleteTarget(doc); setDeleteArmed(false); }}
                          data-testid={`button-delete-${doc.id}`}
                          title="Permanently delete this draft"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Previously-merged drafts — restore a wrong merge back to needs review. */}
      {!loading && mergedGroups.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2">
            <Undo2 className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-gray-800">Previously merged drafts</h3>
            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
              {mergedGroups.reduce((n, g) => n + g.docs.length, 0)} merged
            </Badge>
          </div>
          <p className="text-xs text-gray-500 -mt-1">
            Drafts folded into a canonical during a past merge. Restore any that were merged by mistake — they return to Needs Review.
          </p>
          {mergedGroups.map((g) => (
            <Card key={g.canonicalId} data-testid={`card-merged-group-${g.canonicalId}`}>
              <CardContent className="py-3 px-5 space-y-2">
                <div className="text-xs text-gray-500">
                  Merged into <span className="font-medium text-gray-700">“{g.canonicalTitle ?? `#${g.canonicalId}`}”</span>{" "}
                  <span className="text-gray-400">(#{g.canonicalId}{g.canonicalStatus ? `, ${g.canonicalStatus.replace(/_/g, " ")}` : ""})</span>
                </div>
                <div className="space-y-1.5">
                  {g.docs.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-3 border-t pt-1.5 first:border-t-0 first:pt-0">
                      <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">#{d.id}</Badge>
                        <span className="text-sm text-gray-800 truncate">{d.title}</span>
                        {d.homeRoot && (
                          <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700 border-sky-200">
                            <FolderTree className="w-2.5 h-2.5 mr-1" />{d.homeRoot}{d.node ? ` / ${d.node}` : ""}
                          </Badge>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px] shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50"
                        onClick={() => restoreMerged(d.id)}
                        disabled={restoringId === d.id}
                        data-testid={`button-restore-${d.id}`}
                      >
                        {restoringId === d.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Undo2 className="w-3 h-3 mr-1" />}
                        Restore
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Sticky selection bar — appears once any draft is ticked. */}
      {selectedDocs.length > 0 && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full bg-gray-900 text-white pl-5 pr-3 py-2 shadow-xl"
          data-testid="merge-selection-bar"
        >
          <span className="text-sm font-medium">
            {selectedDocs.length} selected
            {selectedDocs.length < 2 && <span className="text-gray-400 font-normal"> — pick one more to merge</span>}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-gray-300 hover:text-white hover:bg-white/10"
            onClick={clearSelection}
            data-testid="button-clear-selection"
          >
            Clear
          </Button>
          <Button
            size="sm"
            className="h-7 bg-purple-600 hover:bg-purple-700 text-xs"
            onClick={() => setWorkspaceOpen(true)}
            disabled={selectedDocs.length < 2}
            data-testid="button-merge-selected"
          >
            <Merge className="w-3.5 h-3.5 mr-1.5" /> Merge selected
          </Button>
        </div>
      )}

      <LiveDocDialog liveDocId={viewLiveDocId} onClose={() => setViewLiveDocId(null)} />
      {deleteDialog}
    </div>
  );
}
