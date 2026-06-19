import { useState, useEffect, useCallback, useRef } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth";
import {
  CheckCircle,
  XCircle,
  Edit3,
  Merge,
  Eye,
  Play,
  Loader2,
  FileText,
  Upload,
  Search,
  ChevronLeft,
  ChevronRight,
  Bot,
  Sparkles,
  Settings2,
  RotateCcw,
  ListFilter,
  Layers,
  ArrowRight,
} from "lucide-react";

interface StagingDoc {
  id: number;
  title: string;
  category: string;
  content: string;
  tags: string;
  sourceVideoTitle: string | null;
  sourceVideoId: string | null;
  status: string;
  adminNotes: string | null;
  editedContent: string | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  mergedIntoId: number | null;
  createdAt: string;
  source: string | null;
  phase: string | null;
  module: string | null;
  lessonId: string | null;
  lessonType: string | null;
  networkPath: string | null;
  publisherPath: string | null;
  blitzOrder: number | null;
  aiConfidenceScore: number | null;
  aiRecommendedAction: string | null;
  aiSuggestedCategory: string | null;
  aiCleanedTitle: string | null;
  aiSummary: string | null;
  autoAction: string | null;
  autoActionAt: string | null;
  autoActionConfidence: number | null;
}

interface StatusCounts {
  [key: string]: number;
}

interface SourceCounts {
  blitz: number;
  coaching_call: number;
  unlabeled: number;
}

interface TriageSettings {
  autoApproveThreshold: number;
  autoRejectThreshold: number;
}

interface TriageStatus {
  running: boolean;
  triaged: number;
  pendingTriage: number;
  needsReview: number;
  autoActions: Record<string, number>;
}

const STATUS_COLORS: Record<string, string> = {
  pending_review: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  needs_edit: "bg-orange-100 text-orange-800",
  needs_review: "bg-amber-100 text-amber-800",
  rejected: "bg-red-100 text-red-800",
  merged: "bg-purple-100 text-purple-800",
  pushed: "bg-blue-100 text-blue-800",
};

const RECOMMENDATION_COLORS: Record<string, string> = {
  approve: "bg-green-50 text-green-700 border-green-200",
  reject: "bg-red-50 text-red-700 border-red-200",
  needs_review: "bg-amber-50 text-amber-700 border-amber-200",
};

const CATEGORIES = [
  { value: "curriculum", label: "Curriculum" },
  { value: "strategy", label: "Strategy" },
  { value: "sop", label: "SOP" },
  { value: "faq", label: "FAQ" },
  { value: "platform_guide", label: "Platform Guide" },
];

function ConfidenceBadge({ score, recommendation }: { score: number | null; recommendation: string | null }) {
  if (score === null || !recommendation) return null;
  const pct = Math.round(score * 100);
  const colorClass = RECOMMENDATION_COLORS[recommendation] ?? "bg-gray-50 text-gray-600";
  const label = recommendation === "approve" ? "✓ Approve" : recommendation === "reject" ? "✗ Reject" : "? Review";
  return (
    <Badge variant="outline" className={`text-[10px] ${colorClass}`}>
      <Bot className="w-2.5 h-2.5 mr-1" />
      {label} {pct}%
    </Badge>
  );
}

export default function KnowledgeBaseReview() {
  const [docs, setDocs] = useState<StagingDoc[]>([]);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({});
  const [sourceCounts, setSourceCounts] = useState<SourceCounts>({ blitz: 0, coaching_call: 0, unlabeled: 0 });
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const [statusFilter, setStatusFilter] = useState("pending_review");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<StagingDoc | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editTags, setEditTags] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [mergeIds, setMergeIds] = useState<Set<number>>(new Set());
  const [merging, setMerging] = useState(false);
  const [guidedMode, setGuidedMode] = useState(false);
  const [guidedIndex, setGuidedIndex] = useState(0);
  const [guidedDocs, setGuidedDocs] = useState<StagingDoc[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [triageSettings, setTriageSettings] = useState<TriageSettings>({ autoApproveThreshold: 0.85, autoRejectThreshold: 0.20 });
  const [triageStatus, setTriageStatus] = useState<TriageStatus | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [auditDocs, setAuditDocs] = useState<StagingDoc[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const { toast } = useToast();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (searchQuery) params.set("search", searchQuery);
      if (sourceFilter && sourceFilter !== "all") params.set("source", sourceFilter);
      params.set("page", page.toString());
      params.set("limit", "20");

      const res = await authFetch(`/admin/knowledgebase/staging?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setDocs(data.documents);
      setStatusCounts(data.statusCounts || {});
      setSourceCounts(data.sourceCounts || { blitz: 0, coaching_call: 0, unlabeled: 0 });
      setTotalPages(data.pagination?.totalPages || 1);
      setTotal(data.pagination?.total || 0);
    } catch {
      toast({ title: "Error loading documents", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter, searchQuery, page, toast]);

  const fetchTriageStatus = useCallback(async () => {
    try {
      const res = await authFetch("/admin/knowledgebase/staging/triage-status");
      if (res.ok) {
        const data = await res.json();
        setTriageStatus(data);
        if (data.running) {
          setTriaging(true);
        } else if (triaging) {
          setTriaging(false);
          fetchDocs();
          toast({ title: "AI triage complete!" });
        }
      }
    } catch {
      // ignore
    }
  }, [triaging, fetchDocs, toast]);

  const fetchTriageSettings = useCallback(async () => {
    try {
      const res = await authFetch("/admin/knowledgebase/staging/triage-settings");
      if (res.ok) setTriageSettings(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  useEffect(() => {
    fetchTriageSettings();
    fetchTriageStatus();
  }, [fetchTriageSettings, fetchTriageStatus]);

  useEffect(() => {
    if (triaging) {
      pollRef.current = setInterval(fetchTriageStatus, 4000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [triaging, fetchTriageStatus]);

  // Keyboard shortcuts for guided mode
  useEffect(() => {
    if (!guidedMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "a") handleGuidedApprove();
      if (e.key === "r") handleGuidedReject();
      if (e.key === "e") setEditMode(true);
      if (e.key === "ArrowRight" || e.key === "n") nextGuided();
      if (e.key === "ArrowLeft" || e.key === "p") prevGuided();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const loadGuidedQueue = async () => {
    try {
      const res = await authFetch("/admin/knowledgebase/staging?status=needs_review&limit=100");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setGuidedDocs(data.documents);
      setGuidedIndex(0);
      setGuidedMode(true);
    } catch {
      toast({ title: "Failed to load review queue", variant: "destructive" });
    }
  };

  const currentGuided = guidedDocs[guidedIndex] ?? null;

  const nextGuided = () => setGuidedIndex((i) => Math.min(i + 1, guidedDocs.length - 1));
  const prevGuided = () => setGuidedIndex((i) => Math.max(i - 1, 0));

  const handleGuidedApprove = async () => {
    if (!currentGuided) return;
    await updateDoc(currentGuided.id, { status: "approved" });
    setGuidedDocs((prev) => prev.filter((d) => d.id !== currentGuided.id));
    setGuidedIndex((i) => Math.min(i, guidedDocs.length - 2));
  };

  const handleGuidedReject = async () => {
    if (!currentGuided) return;
    await updateDoc(currentGuided.id, { status: "rejected" });
    setGuidedDocs((prev) => prev.filter((d) => d.id !== currentGuided.id));
    setGuidedIndex((i) => Math.min(i, guidedDocs.length - 2));
  };

  const runPipeline = async () => {
    setProcessing(true);
    try {
      const res = await authFetch("/admin/knowledgebase/pipeline/process-transcripts", { method: "POST" });
      const data = await res.json();
      toast({ title: data.message });
    } catch {
      toast({ title: "Failed to start pipeline", variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const runTriage = async (includeStatuses?: string[]) => {
    setTriaging(true);
    try {
      const body: Record<string, unknown> = {};
      if (includeStatuses) body.includeStatuses = includeStatuses;
      const res = await authFetch("/admin/knowledgebase/staging/run-triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      toast({ title: data.message });
    } catch {
      toast({ title: "Failed to start triage", variant: "destructive" });
      setTriaging(false);
    }
  };

  const saveTriageSettings = async () => {
    try {
      const res = await authFetch("/admin/knowledgebase/staging/triage-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(triageSettings),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Triage settings saved" });
      setShowSettings(false);
    } catch {
      toast({ title: "Failed to save settings", variant: "destructive" });
    }
  };

  const loadAudit = async () => {
    setAuditLoading(true);
    try {
      const res = await authFetch("/admin/knowledgebase/staging/auto-actions?limit=50");
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setAuditDocs(data.documents);
      setShowAudit(true);
    } catch {
      toast({ title: "Failed to load audit log", variant: "destructive" });
    } finally {
      setAuditLoading(false);
    }
  };

  const undoAutoAction = async (id: number) => {
    try {
      const res = await authFetch(`/admin/knowledgebase/staging/${id}/undo-auto-action`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Auto-action undone. Document moved to needs_review." });
      setAuditDocs((prev) => prev.filter((d) => d.id !== id));
      fetchDocs();
    } catch {
      toast({ title: "Failed to undo", variant: "destructive" });
    }
  };

  const updateDoc = async (id: number, updates: Record<string, unknown>) => {
    try {
      const res = await authFetch(`/admin/knowledgebase/staging/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Update failed");
      toast({ title: "Document updated" });
      fetchDocs();
      if (selectedDoc?.id === id) {
        const updated = await res.json();
        setSelectedDoc(updated);
      }
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  const bulkApprove = async () => {
    const pendingIds = docs.filter((d) => d.status === "pending_review").map((d) => d.id);
    if (pendingIds.length === 0) return;
    try {
      const res = await authFetch("/admin/knowledgebase/staging/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: pendingIds }),
      });
      const data = await res.json();
      toast({ title: `Approved ${data.approved} documents` });
      fetchDocs();
    } catch {
      toast({ title: "Bulk approve failed", variant: "destructive" });
    }
  };

  const mergeSelected = async () => {
    const ids = Array.from(mergeIds);
    if (ids.length < 2) {
      toast({ title: "Select at least 2 documents to merge", variant: "destructive" });
      return;
    }
    setMerging(true);
    try {
      const res = await authFetch("/admin/knowledgebase/staging/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Merge failed");
      const data = await res.json();
      toast({ title: `Merged ${ids.length} docs into: ${data.merged.title}` });
      setMergeIds(new Set());
      fetchDocs();
    } catch {
      toast({ title: "Merge failed", variant: "destructive" });
    } finally {
      setMerging(false);
    }
  };

  const pushApproved = async () => {
    setPushing(true);
    try {
      const res = await authFetch("/admin/knowledgebase/staging/push-approved", { method: "POST" });
      if (!res.ok) throw new Error("Push failed");
      const data = await res.json();
      toast({ title: data.message });
      fetchDocs();
    } catch {
      toast({ title: "Push failed", variant: "destructive" });
    } finally {
      setPushing(false);
    }
  };

  const openDoc = (doc: StagingDoc) => {
    setSelectedDoc(doc);
    setEditMode(false);
    setEditContent(doc.editedContent || doc.content);
    setEditTitle(doc.aiCleanedTitle || doc.title);
    setEditCategory(doc.aiSuggestedCategory || doc.category);
    setEditTags(doc.tags);
    setAdminNotes(doc.adminNotes || "");
  };

  const saveEdit = async () => {
    if (!selectedDoc) return;
    await updateDoc(selectedDoc.id, {
      title: editTitle,
      category: editCategory,
      tags: editTags,
      editedContent: editContent,
      adminNotes: adminNotes,
      status: "approved",
    });
    setEditMode(false);
  };

  const toggleMergeSelect = (id: number) => {
    setMergeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalCount = Object.values(statusCounts).reduce((s, c) => s + c, 0);

  // ── Guided review mode ──────────────────────────────────────────────────────
  if (guidedMode) {
    const doc = currentGuided;
    const reviewed = guidedDocs.length - (doc ? guidedDocs.filter((d) => d.id === doc.id || guidedDocs.indexOf(d) > guidedIndex).length : 0);
    const queueTotal = guidedDocs.length + (reviewed > 0 ? reviewed - 1 : 0);

    if (!doc) {
      return (
        <AdminLayout>
          <div className="max-w-2xl mx-auto py-20 text-center space-y-4">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
            <h2 className="text-2xl font-bold text-gray-900">Review Queue Complete!</h2>
            <p className="text-gray-500">All needs_review documents have been triaged.</p>
            <Button onClick={() => { setGuidedMode(false); fetchDocs(); }}>Back to Document List</Button>
          </div>
        </AdminLayout>
      );
    }

    const initialTotal = guidedDocs.length;
    const remaining = guidedDocs.length;
    const doneCount = initialTotal - remaining + guidedIndex;

    return (
      <AdminLayout>
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => { setGuidedMode(false); fetchDocs(); }}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Back to list
            </Button>
            <div className="text-sm text-gray-500">
              Reviewing {guidedIndex + 1} of {guidedDocs.length} · <span className="text-amber-600 font-medium">{guidedDocs.length - guidedIndex - 1} remaining</span>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={prevGuided} disabled={guidedIndex === 0}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={nextGuided} disabled={guidedIndex >= guidedDocs.length - 1}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className="bg-[#1a56db] h-1.5 rounded-full transition-all"
              style={{ width: `${((guidedIndex) / Math.max(guidedDocs.length - 1, 1)) * 100}%` }}
            />
          </div>

          <Card className="border-2">
            <CardContent className="p-6 space-y-4">
              {/* AI triage badge */}
              {doc.aiRecommendedAction && (
                <div className={`p-3 rounded-lg border flex items-start gap-3 ${RECOMMENDATION_COLORS[doc.aiRecommendedAction] ?? "bg-gray-50 border-gray-200"}`}>
                  <Bot className="w-5 h-5 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">
                        AI recommends: {doc.aiRecommendedAction.replace("_", " ")}
                      </span>
                      <span className="text-sm opacity-75">
                        ({Math.round((doc.aiConfidenceScore ?? 0) * 100)}% confidence)
                      </span>
                    </div>
                    {doc.aiSummary && (
                      <p className="text-sm mt-1 opacity-90">{doc.aiSummary}</p>
                    )}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h2 className="text-xl font-bold text-gray-900">
                    {doc.aiCleanedTitle || doc.title}
                  </h2>
                  {doc.aiCleanedTitle && doc.aiCleanedTitle !== doc.title && (
                    <span className="text-xs text-gray-400">(original: {doc.title})</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-xs">{doc.aiSuggestedCategory || doc.category}</Badge>
                  {doc.source === "blitz" && (
                    <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">Blitz</Badge>
                  )}
                  {doc.source === "coaching_call" && (
                    <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">Coaching Call</Badge>
                  )}
                  {doc.phase && (
                    <Badge variant="outline" className={`text-[10px] ${
                      doc.phase === "build" ? "bg-amber-50 text-amber-700 border-amber-200" :
                      doc.phase === "test" ? "bg-cyan-50 text-cyan-700 border-cyan-200" :
                      "bg-emerald-50 text-emerald-700 border-emerald-200"
                    }`}>
                      {doc.phase.toUpperCase()}
                    </Badge>
                  )}
                  {doc.sourceVideoTitle && (
                    <span className="text-xs text-gray-400 truncate max-w-[300px]">
                      Source: {doc.sourceVideoTitle}
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg border p-4 max-h-80 overflow-y-auto">
                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
                  {doc.editedContent || doc.content}
                </pre>
              </div>

              {/* Action bar */}
              <div className="flex items-center gap-3 pt-2">
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  onClick={handleGuidedApprove}
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Approve <span className="ml-2 opacity-60 text-xs">[A]</span>
                </Button>
                <Button
                  className="flex-1"
                  variant="destructive"
                  onClick={handleGuidedReject}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Reject <span className="ml-2 opacity-60 text-xs">[R]</span>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => openDoc(doc)}
                >
                  <Edit3 className="w-4 h-4 mr-2" />
                  Edit <span className="ml-2 opacity-60 text-xs">[E]</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={nextGuided} disabled={guidedIndex >= guidedDocs.length - 1}>
                  Skip <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Edit dialog */}
        <Dialog open={!!selectedDoc} onOpenChange={(open) => { if (!open) setSelectedDoc(null); }}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            {selectedDoc && (
              <>
                <DialogHeader>
                  <DialogTitle>Edit Document</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <div>
                    <Label>Title</Label>
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <Label>Category</Label>
                      <Select value={editCategory} onValueChange={setEditCategory}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <Label>Tags</Label>
                      <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label>Content</Label>
                    <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={16} className="font-mono text-sm" />
                  </div>
                  <div>
                    <Label>Admin Notes</Label>
                    <Textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} rows={2} />
                  </div>
                </div>
                <DialogFooter className="mt-4">
                  <Button variant="outline" onClick={() => setSelectedDoc(null)}>Cancel</Button>
                  <Button onClick={saveEdit} className="bg-green-600 hover:bg-green-700">
                    <CheckCircle className="w-4 h-4 mr-2" />Save & Approve
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </AdminLayout>
    );
  }

  // ── Main list view ──────────────────────────────────────────────────────────
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Knowledge Base Document Review</h1>
            <p className="text-gray-600 mt-1">
              AI auto-triages new docs · human reviews the uncertain ones
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(statusCounts.approved || 0) > 0 && (
              <Button onClick={pushApproved} disabled={pushing} className="bg-[#1a56db] hover:bg-[#1a56db]/90">
                {pushing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                Push {statusCounts.approved} to KB
              </Button>
            )}
            {(statusCounts.needs_review || 0) > 0 && (
              <Button onClick={loadGuidedQueue} variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50">
                <Layers className="w-4 h-4 mr-2" />
                Review Queue ({statusCounts.needs_review})
              </Button>
            )}
            <Button
              onClick={() => runTriage(["pending_review"])}
              disabled={triaging}
              className="bg-violet-600 hover:bg-violet-700"
            >
              {triaging ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {triaging ? "AI Triaging…" : "Run AI Triage"}
            </Button>
            <Button onClick={runPipeline} disabled={processing} variant="outline">
              {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              Run Pipeline
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>
              <Settings2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Triage status banner */}
        {triageStatus && (triageStatus.running || triageStatus.autoActions.auto_approved > 0 || triageStatus.autoActions.auto_rejected > 0) && (
          <Card className="bg-violet-50 border-violet-200">
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 text-sm">
                  <Bot className="w-4 h-4 text-violet-600" />
                  <span className="text-violet-800 font-medium">
                    {triageStatus.running ? "AI triage running…" : "AI triage results:"}
                  </span>
                  {triageStatus.autoActions.auto_approved != null && (
                    <span className="text-green-700">✓ {triageStatus.autoActions.auto_approved ?? 0} auto-approved</span>
                  )}
                  {triageStatus.autoActions.auto_rejected != null && (
                    <span className="text-red-700">✗ {triageStatus.autoActions.auto_rejected ?? 0} auto-rejected</span>
                  )}
                  {triageStatus.needsReview > 0 && (
                    <span className="text-amber-700">? {triageStatus.needsReview} need your review</span>
                  )}
                </div>
                <Button variant="ghost" size="sm" className="text-violet-700" onClick={loadAudit} disabled={auditLoading}>
                  <ListFilter className="w-3.5 h-3.5 mr-1" />
                  View Audit Log
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status filter tabs */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setStatusFilter("all"); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${statusFilter === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            All ({totalCount})
          </button>
          {[
            ["pending_review", "Pending"],
            ["needs_review", "Needs Review"],
            ["approved", "Approved"],
            ["needs_edit", "Needs Edit"],
            ["rejected", "Rejected"],
            ["merged", "Merged"],
            ["pushed", "Pushed"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setStatusFilter(key); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${statusFilter === key ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            >
              {label} ({statusCounts[key] || 0})
            </button>
          ))}
        </div>

        {/* Source filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500">Source:</span>
          {[
            ["all", "All"],
            ["blitz", `Blitz (${sourceCounts.blitz})`],
            ["coaching_call", `Coaching Call (${sourceCounts.coaching_call})`],
            ["unlabeled", `Unlabeled (${sourceCounts.unlabeled})`],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setSourceFilter(key); setPage(1); }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${sourceFilter === key ? "bg-[#1a56db] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="pl-10"
            />
          </div>
          {mergeIds.size >= 2 && (
            <Button onClick={mergeSelected} disabled={merging} variant="outline" className="border-purple-300 text-purple-700">
              {merging ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Merge className="w-4 h-4 mr-2" />}
              Merge {mergeIds.size} Selected
            </Button>
          )}
          {statusFilter === "pending_review" && docs.length > 0 && (
            <Button onClick={bulkApprove} variant="outline" className="border-green-300 text-green-700">
              <CheckCircle className="w-4 h-4 mr-2" />
              Approve All on Page
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[#1a56db]" />
          </div>
        ) : docs.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">No documents found</p>
              <p className="text-gray-400 mt-1">
                {totalCount === 0 ? "Run the pipeline to process video transcripts" : "Try a different filter or search"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {docs.map((doc) => (
              <Card
                key={doc.id}
                className={`transition-colors hover:border-[#1a56db]/30 cursor-pointer ${mergeIds.has(doc.id) ? "ring-2 ring-purple-400 border-purple-300" : ""}`}
              >
                <CardContent className="py-4 px-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={mergeIds.has(doc.id)}
                        onChange={() => toggleMergeSelect(doc.id)}
                        className="mt-1.5 rounded border-gray-300"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0" onClick={() => openDoc(doc)}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900 truncate">
                            {doc.aiCleanedTitle || doc.title}
                          </h3>
                          <Badge variant="outline" className={STATUS_COLORS[doc.status] || ""}>
                            {doc.status.replace(/_/g, " ")}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {doc.aiSuggestedCategory || doc.category}
                          </Badge>
                          <ConfidenceBadge score={doc.aiConfidenceScore} recommendation={doc.aiRecommendedAction} />
                          {doc.autoAction && (
                            <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">
                              <Bot className="w-2.5 h-2.5 mr-1" />
                              {doc.autoAction === "auto_approved" ? "Auto-approved" : "Auto-rejected"}
                            </Badge>
                          )}
                        </div>
                        {doc.source === "blitz" && (
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">Blitz</Badge>
                            {doc.phase && (
                              <Badge variant="outline" className={`text-[10px] ${
                                doc.phase === "build" ? "bg-amber-50 text-amber-700 border-amber-200" :
                                doc.phase === "test" ? "bg-cyan-50 text-cyan-700 border-cyan-200" :
                                "bg-emerald-50 text-emerald-700 border-emerald-200"
                              }`}>
                                {doc.phase.toUpperCase()}
                              </Badge>
                            )}
                            {doc.lessonId && <span className="text-[10px] text-gray-500">Lesson {doc.lessonId}</span>}
                            {doc.module && <span className="text-[10px] text-gray-400">· {doc.module}</span>}
                          </div>
                        )}
                        {doc.source === "coaching_call" && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">Coaching Call</Badge>
                            {doc.module && (
                              <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-600 border-gray-200">
                                Coach: {doc.module}
                              </Badge>
                            )}
                          </div>
                        )}
                        {doc.aiSummary ? (
                          <p className="text-sm text-gray-600 mt-1 italic">{doc.aiSummary}</p>
                        ) : (
                          <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                            {(doc.editedContent || doc.content).replace(/^#.*\n/gm, "").replace(/\*\*.*?\*\*/g, "").trim().substring(0, 200)}
                          </p>
                        )}
                        {doc.tags && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {doc.tags.split(",").slice(0, 5).map((tag) => (
                              <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                                {tag.trim()}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(doc.status === "pending_review" || doc.status === "needs_review") && (
                        <>
                          <Button size="sm" variant="ghost" className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={(e) => { e.stopPropagation(); updateDoc(doc.id, { status: "approved" }); }}>
                            <CheckCircle className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={(e) => { e.stopPropagation(); updateDoc(doc.id, { status: "rejected" }); }}>
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {doc.autoAction && (
                        <Button size="sm" variant="ghost" className="text-gray-400 hover:text-gray-600"
                          onClick={(e) => { e.stopPropagation(); undoAutoAction(doc.id); }}
                          title="Undo auto-action">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openDoc(doc); }}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-gray-500">
                Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Document Detail Dialog */}
      <Dialog open={!!selectedDoc} onOpenChange={(open) => { if (!open) { setSelectedDoc(null); setEditMode(false); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {selectedDoc && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 flex-wrap">
                  <DialogTitle className="text-lg">
                    {editMode ? "Edit Document" : (selectedDoc.aiCleanedTitle || selectedDoc.title)}
                  </DialogTitle>
                  <Badge variant="outline" className={STATUS_COLORS[selectedDoc.status] || ""}>
                    {selectedDoc.status.replace(/_/g, " ")}
                  </Badge>
                </div>
                {selectedDoc.source === "blitz" && (
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">Blitz</Badge>
                    {selectedDoc.phase && (
                      <Badge variant="outline" className={`text-xs ${
                        selectedDoc.phase === "build" ? "bg-amber-50 text-amber-700 border-amber-200" :
                        selectedDoc.phase === "test" ? "bg-cyan-50 text-cyan-700 border-cyan-200" :
                        "bg-emerald-50 text-emerald-700 border-emerald-200"
                      }`}>
                        {selectedDoc.phase.toUpperCase()}
                      </Badge>
                    )}
                    {selectedDoc.lessonId && <span className="text-xs text-gray-500">Lesson {selectedDoc.lessonId}</span>}
                  </div>
                )}
                {selectedDoc.sourceVideoTitle && (
                  <p className="text-xs text-gray-400">Source: {selectedDoc.sourceVideoTitle}</p>
                )}
              </DialogHeader>

              {/* AI triage info */}
              {selectedDoc.aiRecommendedAction && !editMode && (
                <div className={`p-3 rounded-lg border flex items-start gap-3 mt-2 ${RECOMMENDATION_COLORS[selectedDoc.aiRecommendedAction] ?? "bg-gray-50 border-gray-200"}`}>
                  <Bot className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium text-sm">AI: {selectedDoc.aiRecommendedAction.replace("_", " ")} ({Math.round((selectedDoc.aiConfidenceScore ?? 0) * 100)}%)</span>
                    {selectedDoc.aiSummary && <p className="text-sm mt-0.5 opacity-90">{selectedDoc.aiSummary}</p>}
                  </div>
                </div>
              )}

              {editMode ? (
                <div className="space-y-4 mt-4">
                  <div>
                    <Label>Title</Label>
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <Label>Category</Label>
                      <Select value={editCategory} onValueChange={setEditCategory}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <Label>Tags</Label>
                      <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label>Content (Markdown)</Label>
                    <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={20} className="font-mono text-sm" />
                  </div>
                  <div>
                    <Label>Admin Notes</Label>
                    <Textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} rows={3} />
                  </div>
                </div>
              ) : (
                <div className="mt-4">
                  <div className="flex gap-2 mb-4 flex-wrap">
                    <Badge variant="secondary">{selectedDoc.aiSuggestedCategory || selectedDoc.category}</Badge>
                    {selectedDoc.tags && selectedDoc.tags.split(",").map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">{tag.trim()}</Badge>
                    ))}
                  </div>
                  <div className="prose prose-sm max-w-none bg-gray-50 p-4 rounded-lg border">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
                      {selectedDoc.editedContent || selectedDoc.content}
                    </pre>
                  </div>
                  {selectedDoc.adminNotes && (
                    <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-sm font-medium text-yellow-800">Admin Notes</p>
                      <p className="text-sm text-yellow-700 mt-1">{selectedDoc.adminNotes}</p>
                    </div>
                  )}
                </div>
              )}

              <DialogFooter className="mt-6">
                {editMode ? (
                  <>
                    <Button variant="outline" onClick={() => setEditMode(false)}>Cancel</Button>
                    <Button onClick={saveEdit} className="bg-green-600 hover:bg-green-700">
                      <CheckCircle className="w-4 h-4 mr-2" />Save & Approve
                    </Button>
                  </>
                ) : (
                  <>
                    {selectedDoc.autoAction && (
                      <Button variant="outline" className="text-gray-500 mr-auto" onClick={() => undoAutoAction(selectedDoc.id)}>
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />Undo Auto-action
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => setEditMode(true)}>
                      <Edit3 className="w-4 h-4 mr-2" />Edit
                    </Button>
                    {(selectedDoc.status === "pending_review" || selectedDoc.status === "needs_review") && (
                      <>
                        <Button onClick={() => { updateDoc(selectedDoc.id, { status: "approved" }); setSelectedDoc(null); }}
                          className="bg-green-600 hover:bg-green-700">
                          <CheckCircle className="w-4 h-4 mr-2" />Approve
                        </Button>
                        <Button onClick={() => { updateDoc(selectedDoc.id, { status: "rejected" }); setSelectedDoc(null); }}
                          variant="destructive">
                          <XCircle className="w-4 h-4 mr-2" />Reject
                        </Button>
                      </>
                    )}
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Triage Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5" />AI Triage Settings
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-3">
              <Label>
                Auto-approve threshold: <span className="font-bold text-green-700">{Math.round(triageSettings.autoApproveThreshold * 100)}%</span>
              </Label>
              <p className="text-xs text-gray-500">
                Docs with AI confidence ≥ this AND recommended "approve" are automatically pushed live.
              </p>
              <Slider
                min={50} max={99} step={1}
                value={[Math.round(triageSettings.autoApproveThreshold * 100)]}
                onValueChange={([v]) => setTriageSettings((s) => ({ ...s, autoApproveThreshold: v / 100 }))}
              />
            </div>
            <div className="space-y-3">
              <Label>
                Auto-reject threshold: <span className="font-bold text-red-700">{Math.round(triageSettings.autoRejectThreshold * 100)}%</span>
              </Label>
              <p className="text-xs text-gray-500">
                Docs with AI confidence ≤ this AND recommended "reject" are automatically rejected.
              </p>
              <Slider
                min={1} max={50} step={1}
                value={[Math.round(triageSettings.autoRejectThreshold * 100)]}
                onValueChange={([v]) => setTriageSettings((s) => ({ ...s, autoRejectThreshold: v / 100 }))}
              />
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1">
              <p>• <strong>Green zone</strong> ≥{Math.round(triageSettings.autoApproveThreshold * 100)}%: Auto-approve + push live</p>
              <p>• <strong>Red zone</strong> ≤{Math.round(triageSettings.autoRejectThreshold * 100)}%: Auto-reject</p>
              <p>• <strong>Middle</strong>: Flagged for human review</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettings(false)}>Cancel</Button>
            <Button onClick={saveTriageSettings} className="bg-violet-600 hover:bg-violet-700">Save Settings</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Auto-action Audit Dialog */}
      <Dialog open={showAudit} onOpenChange={setShowAudit}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5" />AI Auto-action Audit Log
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-4">
            {auditDocs.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No auto-actions yet</p>
            ) : auditDocs.map((doc) => (
              <div key={doc.id} className="flex items-start justify-between gap-4 p-3 bg-gray-50 rounded-lg border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{doc.aiCleanedTitle || doc.title}</span>
                    <Badge variant="outline" className={doc.autoAction === "auto_approved" ? "bg-green-50 text-green-700 border-green-200 text-[10px]" : "bg-red-50 text-red-700 border-red-200 text-[10px]"}>
                      {doc.autoAction === "auto_approved" ? "Auto-approved" : "Auto-rejected"}
                    </Badge>
                    <span className="text-[10px] text-gray-400">{Math.round((doc.autoActionConfidence ?? 0) * 100)}% confidence</span>
                  </div>
                  {doc.aiSummary && <p className="text-xs text-gray-500 mt-0.5">{doc.aiSummary}</p>}
                  {doc.autoActionAt && (
                    <p className="text-[10px] text-gray-400 mt-1">{new Date(doc.autoActionAt).toLocaleString()}</p>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => undoAutoAction(doc.id)}
                  className="shrink-0 text-xs">
                  <RotateCcw className="w-3 h-3 mr-1" />Undo
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
