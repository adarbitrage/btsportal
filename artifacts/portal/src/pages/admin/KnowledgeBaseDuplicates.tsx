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
  const [openCluster, setOpenCluster] = useState<number | null>(null);
  const [canonicalId, setCanonicalId] = useState<number | null>(null);
  const [canonicalTitle, setCanonicalTitle] = useState("");
  const [canonicalContent, setCanonicalContent] = useState<string | null>(null);
  // Non-canonical draft ids the reviewer has chosen to fold into the canonical.
  // Defaults to ALL non-canonical drafts (preserves the original whole-group
  // behavior); the reviewer unchecks the ones to keep separate.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [proposing, setProposing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [viewLiveDocId, setViewLiveDocId] = useState<number | null>(null);
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

  const cluster = openCluster != null ? clusters.find((_, i) => i === openCluster) ?? null : null;
  // Selected ids that are actually still in this cluster and not the canonical.
  const effectiveSelectedIds =
    cluster != null
      ? cluster.docs.filter((d) => d.id !== canonicalId && selectedIds.has(d.id)).map((d) => d.id)
      : [];

  function openClusterAt(i: number) {
    const c = clusters[i];
    setOpenCluster(i);
    const canon = c.docs[0];
    setCanonicalId(canon.id);
    setCanonicalTitle(canon.title);
    setCanonicalContent(null);
    // Default: every non-canonical draft selected for merge.
    setSelectedIds(new Set(c.docs.filter((d) => d.id !== canon.id).map((d) => d.id)));
  }

  function pickCanonical(doc: DupDoc) {
    if (!cluster) return;
    setCanonicalId(doc.id);
    setCanonicalTitle(doc.title);
    // Re-default selection to all OTHER drafts when the canonical changes (the
    // old canonical becomes selectable; the new one is always excluded).
    setSelectedIds(new Set(cluster.docs.filter((d) => d.id !== doc.id).map((d) => d.id)));
    // A previously accepted AI proposal stays (it merged ALL variants); only a
    // never-proposed content resets to the new canonical's own text.
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function proposeMerge() {
    if (!cluster || canonicalId == null) return;
    if (effectiveSelectedIds.length === 0) {
      toast({ title: "Select at least one draft", description: "Pick the drafts to fold into the canonical first.", variant: "destructive" });
      return;
    }
    setProposing(true);
    try {
      // Only the canonical + currently-selected drafts feed the proposal.
      const res = await authFetch("/admin/knowledgebase/staging/duplicates/propose-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [canonicalId, ...effectiveSelectedIds] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI merge proposal failed");
      setCanonicalTitle(data.proposedTitle || canonicalTitle);
      setCanonicalContent(data.proposedContent);
      toast({ title: "AI merge draft ready", description: "Review and edit the merged draft below — nothing is saved until you resolve." });
    } catch (err) {
      toast({ title: "AI merge proposal failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setProposing(false);
    }
  }

  async function resolveCluster() {
    if (!cluster || canonicalId == null) return;
    const mergedIds = effectiveSelectedIds;
    if (mergedIds.length === 0) {
      toast({ title: "Select at least one draft", description: "Choose which drafts to mark merged, or go back.", variant: "destructive" });
      return;
    }
    setResolving(true);
    try {
      const res = await authFetch("/admin/knowledgebase/staging/duplicates/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalId,
          mergedIds,
          title: canonicalTitle.trim() || undefined,
          content: canonicalContent ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resolve duplicates");
      toast({
        title: `Kept 1, marked ${data.merged} merged`,
        description: "The kept draft stays in Needs Review for normal approval. Excluded drafts were left untouched.",
      });
      setOpenCluster(null);
      setCanonicalContent(null);
      fetchClusters();
    } catch (err) {
      toast({ title: "Resolve failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setResolving(false);
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

  // ── Cluster detail (side-by-side compare) ──────────────────────────────────
  if (cluster) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setOpenCluster(null); setCanonicalContent(null); }}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Back to duplicate groups
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={proposeMerge} disabled={proposing || resolving || effectiveSelectedIds.length === 0}
              className="border-violet-300 text-violet-700 hover:bg-violet-50">
              {proposing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {proposing ? "Drafting…" : "AI merge draft"}
            </Button>
            <Button onClick={resolveCluster} disabled={resolving || canonicalId == null || effectiveSelectedIds.length === 0}
              className="bg-purple-600 hover:bg-purple-700" data-testid="button-resolve-cluster">
              {resolving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Merge className="w-4 h-4 mr-2" />}
              Keep 1, mark {effectiveSelectedIds.length} merged
            </Button>
          </div>
        </div>

        <Card className="border-purple-200 bg-purple-50/50">
          <CardContent className="py-3 px-4 space-y-3">
            <div className="text-sm text-purple-900 font-medium flex items-center gap-2">
              <GitCompare className="w-4 h-4" />
              {cluster.docs.length} drafts about “{cluster.key}” — pick the one to keep. The others are marked merged (nothing is auto-approved).
            </div>
            <div>
              <Label className="text-xs">Canonical title (editable — this becomes the kept draft's title)</Label>
              <Input value={canonicalTitle} onChange={(e) => setCanonicalTitle(e.target.value)} className="bg-white" />
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

        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(cluster.docs.length, 3)}, minmax(0, 1fr))` }}>
          {cluster.docs.map((doc) => {
            const isCanon = doc.id === canonicalId;
            const isSelected = selectedIds.has(doc.id);
            const isExcluded = !isCanon && !isSelected;
            return (
              <Card
                key={doc.id}
                className={`flex flex-col ${
                  isCanon
                    ? "ring-2 ring-purple-500 border-purple-300"
                    : isExcluded
                      ? "opacity-60 border-dashed"
                      : "opacity-90"
                }`}
              >
                <CardContent className="p-4 space-y-2 flex flex-col flex-1 min-h-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-sm text-gray-900">{doc.title}</h3>
                    {isCanon ? (
                      <Badge className="bg-purple-600 shrink-0">Keeping</Badge>
                    ) : (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] shrink-0" onClick={() => pickCanonical(doc)} data-testid={`button-keep-${doc.id}`}>
                        Keep this one
                      </Button>
                    )}
                  </div>
                  {!isCanon && (
                    <label
                      className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer select-none"
                      data-testid={`toggle-merge-${doc.id}`}
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-purple-600"
                        checked={isSelected}
                        onChange={() => toggleSelected(doc.id)}
                        data-testid={`checkbox-merge-${doc.id}`}
                      />
                      {isSelected ? (
                        <span className="text-purple-700 font-medium">Merge into canonical</span>
                      ) : (
                        <span className="italic">Kept separate (untouched)</span>
                      )}
                    </label>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
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

        <LiveDocDialog liveDocId={viewLiveDocId} onClose={() => setViewLiveDocId(null)} />
      </div>
    );
  }

  // ── Cluster list ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
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
            Needs-review drafts grouped by concept (title variants + similar content). Keep one per group; the rest are marked merged — the kept draft still goes through normal review.
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
            <Card key={c.key} className="hover:border-purple-300 cursor-pointer transition-colors" onClick={() => openClusterAt(i)} data-testid={`card-dup-cluster-${i}`}>
              <CardContent className="py-4 px-5">
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
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {c.docs.map((d) => `“${d.title}”${d.node ? ` (${d.node})` : ""}`).join(" · ")}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0 border-purple-300 text-purple-700">
                    <Merge className="w-4 h-4 mr-1.5" />Review group
                  </Button>
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
    </div>
  );
}
