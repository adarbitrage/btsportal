import { useState, useEffect, useCallback, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  Sparkles,
  ListFilter,
  Layers,
  ArrowRight,
  AlertTriangle,
  ShieldAlert,
  Wand2,
  Link2,
  FolderTree,
  ShieldCheck,
  GitCompare,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type FlagSeverity = "critical" | "high" | "medium" | "low";

interface RiskFlag {
  type: string;
  severity: FlagSeverity;
  message: string;
  detail?: string;
}

interface ConflictData {
  message: string;
  detail?: string;
}

interface SuggestedTaxonomy {
  homeRoot?: string | null;
  node?: string | null;
  tags?: string[] | null;
  docClass?: string | null;
  blitzSection?: number | null;
  ceiling?: string | null;
  handoff?: string | null;
}

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
  // Task #2 taxonomy + screening fields
  homeRoot: string | null;
  node: string | null;
  taxonomyTags: string[];
  docClassTarget: string | null;
  blitzSection: number | null;
  ceiling: string | null;
  handoff: string | null;
  docType: string;
  originType: string | null;
  authorityRole: string | null;
  sourceId: number | null;
  riskFlags: RiskFlag[] | null;
  corroborationCount: number;
  conflictData: ConflictData | null;
  staleReferences: string[] | null;
  aiSuggestedTaxonomy: SuggestedTaxonomy | null;
  needsExpert: boolean;
  aiCleanedTitle: string | null;
  aiSummary: string | null;
}

interface StatusCounts {
  [key: string]: number;
}

interface ShelfCount {
  homeRoot: string;
  count: number;
}

interface TagCount {
  tag: string;
  count: number;
}

interface RiskCounts {
  blocking: number;
  flagged: number;
  needs_expert: number;
  stale: number;
}

interface TriageStatus {
  running: boolean;
  triaged: number;
  pendingTriage: number;
  needsReview: number;
}

interface TranscriptSource {
  id: number;
  sourceName: string;
  sourceKind: string;
  disposition: string;
  authorityRole: string | null;
  notes: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending_review: "bg-slate-100 text-slate-700",
  needs_review: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  published: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
  merged: "bg-purple-100 text-purple-800",
};

const STATUS_LABEL: Record<string, string> = {
  pending_review: "new",
  needs_review: "needs review",
  approved: "ready to publish",
  published: "live",
  rejected: "rejected",
  merged: "merged",
};

const SEVERITY_STYLES: Record<FlagSeverity, { chip: string; banner: string; label: string }> = {
  critical: { chip: "bg-red-100 text-red-800 border-red-300", banner: "bg-red-50 border-red-300", label: "Critical" },
  high: { chip: "bg-orange-100 text-orange-800 border-orange-300", banner: "bg-orange-50 border-orange-300", label: "High" },
  medium: { chip: "bg-amber-100 text-amber-800 border-amber-300", banner: "bg-amber-50 border-amber-300", label: "Medium" },
  low: { chip: "bg-slate-100 text-slate-700 border-slate-300", banner: "bg-slate-50 border-slate-300", label: "Low" },
};

const SEVERITY_RANK: Record<FlagSeverity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

const CATEGORIES = [
  { value: "curriculum", label: "Curriculum" },
  { value: "strategy", label: "Strategy" },
  { value: "sop", label: "SOP" },
  { value: "faq", label: "FAQ" },
  { value: "platform_guide", label: "Platform Guide" },
];

// Canonical doc classes (mirror api-server kb-taxonomy.ts DOC_CLASSES /
// CITABLE_DOC_CLASSES). "reference" was UI-only drift and has been removed.
const DOC_CLASS_OPTIONS = [
  { value: "curated", label: "Curated (citable)" },
  { value: "overview", label: "Overview (citable)" },
  { value: "transcript", label: "Transcript (training-only, non-citable)" },
];

// Canonical home roots ("shelves") — mirror kb-taxonomy.ts HOME_ROOTS. These are
// the only valid shelf values; the editor picks from them rather than free text.
const HOME_ROOTS = [
  { value: "process", label: "Process" },
  { value: "concepts", label: "Concepts & Skills" },
  { value: "operations", label: "Operations" },
];
const HOME_ROOT_LABEL: Record<string, string> = Object.fromEntries(
  HOME_ROOTS.map((r) => [r.value, r.label]),
);
const shelfLabel = (v: string | null | undefined) =>
  v ? HOME_ROOT_LABEL[v] ?? v : "";

// Origin facet — keyed off the clean origin_type column (6 canonical values).
const ORIGIN_OPTIONS = [
  { value: "strategy_coaching_call", label: "Strategy Call" },
  { value: "va_call", label: "VA Call" },
  { value: "training_video", label: "Training Video" },
  { value: "curated_upload", label: "Curated Upload" },
  { value: "ai_synthesized", label: "AI Synthesized" },
  { value: "manual_entry", label: "Manual Entry" },
];
const ORIGIN_LABEL: Record<string, string> = {
  ...Object.fromEntries(ORIGIN_OPTIONS.map((o) => [o.value, o.label])),
  unlabeled: "Unlabeled",
};

const AUTHORITY_LABEL: Record<string, string> = {
  strategic_coach: "Strategic Coach",
  va: "VA",
  curriculum: "Curriculum",
  internal: "Internal",
};

// docType → plain-language label. study_material is reserved but never written;
// surfaced only if data ever carries it.
const DOC_TYPE_LABEL: Record<string, string> = {
  truth_draft: "New Drafts (mined)",
  existing_doc: "Re-verify (existing)",
  study_material: "Study Material",
};

// Primary status tabs. "merged" is demoted to the All view only.
const STATUS_TABS: [string, string][] = [
  ["pending_review", "New / Untriaged"],
  ["needs_review", "Needs Review"],
  ["approved", "Ready to Publish"],
  ["published", "Live"],
  ["rejected", "Rejected"],
];

function maxSeverity(flags: RiskFlag[] | null): FlagSeverity | null {
  if (!flags || flags.length === 0) return null;
  return flags.reduce<FlagSeverity>((acc, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[acc] ? f.severity : acc), "low");
}

function isBlocking(doc: StagingDoc): boolean {
  if (doc.needsExpert) return true;
  const sev = maxSeverity(doc.riskFlags);
  return sev === "critical" || sev === "high";
}

// ── Risk-flag chips ─────────────────────────────────────────────────────────────

function RiskChips({ flags, needsExpert }: { flags: RiskFlag[] | null; needsExpert: boolean }) {
  const list = flags ?? [];
  if (list.length === 0 && !needsExpert) return null;
  return (
    <div className="flex gap-1 flex-wrap">
      {needsExpert && (
        <Badge variant="outline" className="text-[10px] bg-red-100 text-red-800 border-red-300">
          <ShieldAlert className="w-2.5 h-2.5 mr-1" />
          Needs expert
        </Badge>
      )}
      {list.map((f, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <Badge variant="outline" className={`text-[10px] ${SEVERITY_STYLES[f.severity].chip}`}>
              <AlertTriangle className="w-2.5 h-2.5 mr-1" />
              {f.message}
            </Badge>
          </TooltipTrigger>
          {f.detail && <TooltipContent className="max-w-xs">{f.detail}</TooltipContent>}
        </Tooltip>
      ))}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────

export default function KnowledgeBaseReview() {
  const [docs, setDocs] = useState<StagingDoc[]>([]);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({});
  const [originCounts, setOriginCounts] = useState<StatusCounts>({});
  const [docTypeCounts, setDocTypeCounts] = useState<StatusCounts>({});
  const [docClassCounts, setDocClassCounts] = useState<StatusCounts>({});
  const [riskCounts, setRiskCounts] = useState<RiskCounts>({ blocking: 0, flagged: 0, needs_expert: 0, stale: 0 });
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [shelfCounts, setShelfCounts] = useState<ShelfCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [statusFilter, setStatusFilter] = useState("needs_review");
  const [originFilter, setOriginFilter] = useState("all");
  const [docTypeFilter, setDocTypeFilter] = useState("all");
  const [shelfFilter, setShelfFilter] = useState("all");
  const [docClassFilter, setDocClassFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all"); // all | flagged | blocking | needs_expert
  const [staleOnly, setStaleOnly] = useState(false);
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
  const [editHomeRoot, setEditHomeRoot] = useState("");
  const [editNode, setEditNode] = useState("");
  const [editDocClass, setEditDocClass] = useState("");
  const [editCeiling, setEditCeiling] = useState("");
  const [editHandoff, setEditHandoff] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [instruction, setInstruction] = useState("");
  const [redrafting, setRedrafting] = useState(false);
  const [mergeIds, setMergeIds] = useState<Set<number>>(new Set());
  const [merging, setMerging] = useState(false);
  const [guidedMode, setGuidedMode] = useState(false);
  const [guidedIndex, setGuidedIndex] = useState(0);
  const [guidedDocs, setGuidedDocs] = useState<StagingDoc[]>([]);
  const [triageStatus, setTriageStatus] = useState<TriageStatus | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [sources, setSources] = useState<TranscriptSource[]>([]);
  const [sourceCountsByDisp, setSourceCountsByDisp] = useState<Record<string, number>>({});
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const { toast } = useToast();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (searchQuery) params.set("search", searchQuery);
      if (originFilter && originFilter !== "all") params.set("originType", originFilter);
      if (docTypeFilter && docTypeFilter !== "all") params.set("docType", docTypeFilter);
      if (shelfFilter && shelfFilter !== "all") params.set("homeRoot", shelfFilter);
      if (docClassFilter && docClassFilter !== "all") params.set("docClass", docClassFilter);
      if (tagFilter && tagFilter !== "all") params.set("tag", tagFilter);
      if (riskFilter && riskFilter !== "all") params.set("risk", riskFilter);
      if (staleOnly) params.set("stale", "true");
      params.set("page", page.toString());
      params.set("limit", "20");

      const res = await authFetch(`/admin/knowledgebase/staging?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setDocs(data.documents);
      setStatusCounts(data.statusCounts || {});
      setOriginCounts(data.originCounts || {});
      setDocTypeCounts(data.docTypeCounts || {});
      setDocClassCounts(data.docClassCounts || {});
      setRiskCounts(data.riskCounts || { blocking: 0, flagged: 0, needs_expert: 0, stale: 0 });
      setTagCounts(data.tagCounts || []);
      setShelfCounts(data.shelfCounts || []);
      setTotalPages(data.pagination?.totalPages || 1);
      setTotal(data.pagination?.total || 0);
    } catch {
      toast({ title: "Error loading documents", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, originFilter, docTypeFilter, shelfFilter, docClassFilter, tagFilter, riskFilter, staleOnly, searchQuery, page, toast]);

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
          toast({ title: "AI analysis complete!" });
        }
      }
    } catch {
      // ignore
    }
  }, [triaging, fetchDocs, toast]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  useEffect(() => {
    fetchTriageStatus();
  }, [fetchTriageStatus]);

  useEffect(() => {
    if (triaging) {
      pollRef.current = setInterval(fetchTriageStatus, 4000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [triaging, fetchTriageStatus]);

  // Guided mode keyboard shortcuts (rapid confirm for existing-doc re-verify)
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

  // Guided/rapid mode is restricted to the existing-doc re-verify track.
  const loadGuidedQueue = async () => {
    try {
      const res = await authFetch("/admin/knowledgebase/staging?status=needs_review&docType=existing_doc&limit=100");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      if (!data.documents.length) {
        toast({ title: "No existing-doc drafts to re-verify", description: "Rapid confirm only runs on the curated re-verify track." });
        return;
      }
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

  const runTriage = async () => {
    setTriaging(true);
    try {
      const res = await authFetch("/admin/knowledgebase/staging/run-triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeStatuses: ["pending_review", "needs_review"] }),
      });
      const data = await res.json();
      toast({ title: data.message });
    } catch {
      toast({ title: "Failed to start analysis", variant: "destructive" });
      setTriaging(false);
    }
  };

  const importCurated = async () => {
    setImporting(true);
    try {
      const res = await authFetch("/admin/knowledgebase/staging/import-curated", { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      toast({ title: `Imported ${data.imported} curated docs for re-verification`, description: data.skipped ? `${data.skipped} already staged` : undefined });
      fetchDocs();
    } catch {
      toast({ title: "Failed to import curated docs", variant: "destructive" });
    } finally {
      setImporting(false);
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
    // Only confirm docs WITHOUT blocking flags client-side; server enforces too.
    const eligible = docs.filter((d) => d.status === "needs_review" && !isBlocking(d)).map((d) => d.id);
    if (eligible.length === 0) {
      toast({ title: "No eligible docs", description: "Conflict / high-stakes docs must be reviewed individually." });
      return;
    }
    try {
      const res = await authFetch("/admin/knowledgebase/staging/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: eligible }),
      });
      const data = await res.json();
      toast({
        title: `Approved ${data.approved} documents`,
        description: data.blocked ? `${data.blocked} held back (need individual review)` : undefined,
      });
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
    setInstruction("");
    setEditContent(doc.editedContent || doc.content);
    setEditTitle(doc.aiCleanedTitle || doc.title);
    setEditCategory(doc.category);
    setEditTags(doc.tags);
    setEditHomeRoot(doc.homeRoot ?? doc.aiSuggestedTaxonomy?.homeRoot ?? "");
    setEditNode(doc.node ?? doc.aiSuggestedTaxonomy?.node ?? "");
    setEditDocClass(doc.docClassTarget ?? doc.aiSuggestedTaxonomy?.docClass ?? "");
    setEditCeiling(doc.ceiling ?? doc.aiSuggestedTaxonomy?.ceiling ?? "");
    setEditHandoff(doc.handoff ?? doc.aiSuggestedTaxonomy?.handoff ?? "");
    setAdminNotes(doc.adminNotes || "");
  };

  const saveEdit = async (approve: boolean) => {
    if (!selectedDoc) return;
    await updateDoc(selectedDoc.id, {
      title: editTitle,
      category: editCategory,
      tags: editTags,
      editedContent: editContent,
      adminNotes,
      homeRoot: editHomeRoot || null,
      node: editNode || null,
      docClassTarget: editDocClass || null,
      ceiling: editCeiling || null,
      handoff: editHandoff || null,
      ...(approve ? { status: "approved" } : {}),
    });
    setEditMode(false);
  };

  const runRedraft = async () => {
    if (!selectedDoc || !instruction.trim()) return;
    setRedrafting(true);
    try {
      const res = await authFetch(`/admin/knowledgebase/staging/${selectedDoc.id}/redraft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: instruction.trim() }),
      });
      if (!res.ok) throw new Error("Redraft failed");
      const data = await res.json();
      setSelectedDoc(data.document);
      setEditContent(data.document.editedContent || data.document.content);
      setInstruction("");
      toast({ title: "AI redrafted the document", description: "Review the changes, then approve." });
      fetchDocs();
    } catch {
      toast({ title: "Redraft failed", variant: "destructive" });
    } finally {
      setRedrafting(false);
    }
  };

  const loadSources = async () => {
    setSourcesLoading(true);
    try {
      const res = await authFetch("/admin/knowledgebase/sources");
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setSources(data.sources || []);
      setSourceCountsByDisp(data.counts || {});
      setShowSources(true);
    } catch {
      toast({ title: "Failed to load sources", variant: "destructive" });
    } finally {
      setSourcesLoading(false);
    }
  };

  const setSourceDisposition = async (id: number, action: "quarantine" | "confirm-training") => {
    try {
      const res = await authFetch(`/admin/knowledgebase/sources/${id}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setSources((prev) => prev.map((s) => (s.id === id ? data.source : s)));
      toast({ title: action === "quarantine" ? "Source quarantined" : "Source confirmed member-facing" });
    } catch {
      toast({ title: "Failed to update source", variant: "destructive" });
    }
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
  const pageNeedsReview = docs.filter((d) => d.status === "needs_review");
  const pageSafeCount = pageNeedsReview.filter((d) => !isBlocking(d)).length;
  const pageBlockedCount = pageNeedsReview.length - pageSafeCount;

  // ── Guided / rapid re-verify mode ─────────────────────────────────────────────
  if (guidedMode) {
    const doc = currentGuided;
    if (!doc) {
      return (
        <AppLayout>
          <div className="max-w-2xl mx-auto py-20 text-center space-y-4">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
            <h2 className="text-2xl font-bold text-gray-900">Re-verify Queue Complete!</h2>
            <p className="text-gray-500">All existing-doc drafts have been confirmed.</p>
            <Button onClick={() => { setGuidedMode(false); fetchDocs(); }}>Back to Document List</Button>
          </div>
        </AppLayout>
      );
    }

    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => { setGuidedMode(false); fetchDocs(); }}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Back to list
            </Button>
            <div className="text-sm text-gray-500">
              Re-verifying {guidedIndex + 1} of {guidedDocs.length} ·{" "}
              <span className="text-amber-600 font-medium">{guidedDocs.length - guidedIndex - 1} remaining</span>
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

          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className="bg-[#1a56db] h-1.5 rounded-full transition-all"
              style={{ width: `${(guidedIndex / Math.max(guidedDocs.length - 1, 1)) * 100}%` }}
            />
          </div>

          <Card className="border-2">
            <CardContent className="p-6 space-y-4">
              {(doc.riskFlags?.length || doc.needsExpert) && (
                <div className={`p-3 rounded-lg border ${SEVERITY_STYLES[maxSeverity(doc.riskFlags) ?? "low"].banner}`}>
                  <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-gray-800">
                    <AlertTriangle className="w-4 h-4" /> Review flags
                  </div>
                  <RiskChips flags={doc.riskFlags} needsExpert={doc.needsExpert} />
                </div>
              )}

              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">{doc.aiCleanedTitle || doc.title}</h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-xs">{doc.category}</Badge>
                  <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200">Existing doc</Badge>
                  {doc.homeRoot && (
                    <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700 border-sky-200">
                      <FolderTree className="w-2.5 h-2.5 mr-1" />{doc.homeRoot}{doc.node ? ` / ${doc.node}` : ""}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg border p-4 max-h-80 overflow-y-auto">
                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
                  {doc.editedContent || doc.content}
                </pre>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={handleGuidedApprove}>
                  <CheckCircle className="w-4 h-4 mr-2" />Confirm <span className="ml-2 opacity-60 text-xs">[A]</span>
                </Button>
                <Button className="flex-1" variant="destructive" onClick={handleGuidedReject}>
                  <XCircle className="w-4 h-4 mr-2" />Reject <span className="ml-2 opacity-60 text-xs">[R]</span>
                </Button>
                <Button variant="outline" onClick={() => openDoc(doc)}>
                  <Edit3 className="w-4 h-4 mr-2" />Edit <span className="ml-2 opacity-60 text-xs">[E]</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={nextGuided} disabled={guidedIndex >= guidedDocs.length - 1}>
                  Skip <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {renderDetailDialog()}
      </AppLayout>
    );
  }

  // ── Detail / edit dialog (shared) ─────────────────────────────────────────────
  function renderDetailDialog() {
    return (
      <Dialog open={!!selectedDoc} onOpenChange={(open) => { if (!open) { setSelectedDoc(null); setEditMode(false); } }}>
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
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
                  <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-600 border-gray-200">
                    {selectedDoc.docType === "existing_doc" ? "Existing doc" : "Truth draft"}
                  </Badge>
                </div>
              </DialogHeader>

              {/* Needs-expert / conflict banner */}
              {!editMode && (selectedDoc.needsExpert || selectedDoc.conflictData) && (
                <div className={`p-3 rounded-lg border mt-2 ${SEVERITY_STYLES[maxSeverity(selectedDoc.riskFlags) ?? "high"].banner}`}>
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                    <ShieldAlert className="w-4 h-4" />
                    {selectedDoc.needsExpert ? "Expert sign-off required" : "Conflicting guidance detected"}
                  </div>
                  {selectedDoc.conflictData && (
                    <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                      <div className="bg-white rounded border p-2">
                        <div className="text-[10px] font-medium text-gray-400 mb-1 flex items-center gap-1">
                          <GitCompare className="w-3 h-3" />This draft
                        </div>
                        <p className="text-gray-700">{selectedDoc.conflictData.message}</p>
                      </div>
                      <div className="bg-white rounded border p-2">
                        <div className="text-[10px] font-medium text-gray-400 mb-1">Conflicts with</div>
                        <p className="text-gray-700">{selectedDoc.conflictData.detail || "See flagged corroborating source"}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Risk flags */}
              {!editMode && (selectedDoc.riskFlags?.length || selectedDoc.needsExpert) && (
                <div className="mt-3">
                  <RiskChips flags={selectedDoc.riskFlags} needsExpert={selectedDoc.needsExpert} />
                </div>
              )}

              {editMode ? (
                <div className="space-y-4 mt-4">
                  <div>
                    <Label>Title</Label>
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Category</Label>
                      <Select value={editCategory} onValueChange={setEditCategory}>
                        <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Doc Class</Label>
                      <Select value={editDocClass} onValueChange={setEditDocClass}>
                        <SelectTrigger><SelectValue placeholder="Doc class" /></SelectTrigger>
                        <SelectContent>
                          {DOC_CLASS_OPTIONS.map((c) => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {/* Taxonomy editor */}
                  <div className="rounded-lg border bg-sky-50/50 p-3 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-sky-800">
                      <FolderTree className="w-4 h-4" />Taxonomy
                      {selectedDoc.aiSuggestedTaxonomy && (
                        <span className="text-[11px] font-normal text-sky-600">
                          AI suggests: {selectedDoc.aiSuggestedTaxonomy.homeRoot ?? "—"}
                          {selectedDoc.aiSuggestedTaxonomy.node ? ` / ${selectedDoc.aiSuggestedTaxonomy.node}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Shelf (home root)</Label>
                        <Select value={editHomeRoot || "none"} onValueChange={(v) => setEditHomeRoot(v === "none" ? "" : v)}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Pick a shelf" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— Unassigned —</SelectItem>
                            {HOME_ROOTS.map((r) => (<SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Node</Label>
                        <Input value={editNode} onChange={(e) => setEditNode(e.target.value)} placeholder="e.g. offer-creation" />
                      </div>
                      <div>
                        <Label className="text-xs">Ceiling</Label>
                        <Input value={editCeiling} onChange={(e) => setEditCeiling(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">Handoff</Label>
                        <Input value={editHandoff} onChange={(e) => setEditHandoff(e.target.value)} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Tags (comma separated)</Label>
                      <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label>Content (Markdown)</Label>
                    <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={16} className="font-mono text-sm" />
                  </div>
                  <div>
                    <Label>Admin Notes</Label>
                    <Textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} rows={2} />
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant="secondary">{selectedDoc.category}</Badge>
                    {selectedDoc.docClassTarget && (
                      <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                        {selectedDoc.docClassTarget}
                      </Badge>
                    )}
                    {selectedDoc.homeRoot && (
                      <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-200">
                        <FolderTree className="w-3 h-3 mr-1" />{selectedDoc.homeRoot}{selectedDoc.node ? ` / ${selectedDoc.node}` : ""}
                      </Badge>
                    )}
                    {selectedDoc.taxonomyTags?.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                    ))}
                  </div>

                  {/* Provenance panel */}
                  <div className="rounded-lg border bg-gray-50 p-3 text-sm space-y-2">
                    <div className="flex items-center gap-2 font-medium text-gray-700">
                      <Link2 className="w-4 h-4" />Provenance &amp; Authority
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <p className="text-gray-600">
                        <span className="text-gray-400">Origin:</span>{" "}
                        {selectedDoc.originType ? ORIGIN_LABEL[selectedDoc.originType] ?? selectedDoc.originType : selectedDoc.source || "—"}
                      </p>
                      <p className="text-gray-600">
                        <span className="text-gray-400">Authority:</span>{" "}
                        {selectedDoc.authorityRole ? AUTHORITY_LABEL[selectedDoc.authorityRole] ?? selectedDoc.authorityRole : "—"}
                      </p>
                      <p className="text-gray-600">
                        <span className="text-gray-400">Shelf:</span> {shelfLabel(selectedDoc.homeRoot) || "—"}
                      </p>
                      <p className="text-gray-600">
                        <span className="text-gray-400">Class:</span> {selectedDoc.docClassTarget || "—"}
                      </p>
                    </div>
                    {selectedDoc.sourceVideoTitle && (
                      <p className="text-gray-600"><span className="text-gray-400">Source:</span> {selectedDoc.sourceVideoTitle}</p>
                    )}
                    {/* Corroboration — emphasized */}
                    <div className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium ${
                      selectedDoc.conflictData ? "bg-red-50 text-red-700"
                        : selectedDoc.corroborationCount > 0 ? "bg-green-50 text-green-700"
                        : "bg-amber-50 text-amber-700"
                    }`}>
                      {selectedDoc.conflictData ? (
                        <><AlertTriangle className="w-3.5 h-3.5" />Conflicts with another source — adjudicate before publishing</>
                      ) : selectedDoc.corroborationCount > 0 ? (
                        <><CheckCircle className="w-3.5 h-3.5" />Corroborated by {selectedDoc.corroborationCount} other source(s)</>
                      ) : (
                        <><AlertTriangle className="w-3.5 h-3.5" />Single source — no corroboration</>
                      )}
                    </div>
                    {selectedDoc.staleReferences && selectedDoc.staleReferences.length > 0 && (
                      <p className="text-amber-700">
                        <span className="text-amber-500">Legacy refs:</span> {selectedDoc.staleReferences.join(", ")}
                      </p>
                    )}
                  </div>

                  <div className="bg-gray-50 p-4 rounded-lg border">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
                      {selectedDoc.editedContent || selectedDoc.content}
                    </pre>
                  </div>

                  {/* Instruct-the-AI box */}
                  <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-violet-800">
                      <Wand2 className="w-4 h-4" />Instruct the AI
                    </div>
                    <Textarea
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      rows={2}
                      placeholder='e.g. "Tighten the intro and remove the pricing claim"'
                    />
                    <div className="flex justify-end">
                      <Button size="sm" onClick={runRedraft} disabled={redrafting || !instruction.trim()} className="bg-violet-600 hover:bg-violet-700">
                        {redrafting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
                        Redraft
                      </Button>
                    </div>
                  </div>

                  {selectedDoc.adminNotes && (
                    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
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
                    <Button variant="outline" onClick={() => saveEdit(false)}>Save Draft</Button>
                    <Button onClick={() => saveEdit(true)} className="bg-green-600 hover:bg-green-700">
                      <CheckCircle className="w-4 h-4 mr-2" />Save &amp; Approve
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => setEditMode(true)}>
                      <Edit3 className="w-4 h-4 mr-2" />Edit
                    </Button>
                    {selectedDoc.status === "needs_review" && (
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
    );
  }

  // ── Main list view ────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Knowledge Base Truth-Doc Review</h1>
            <p className="text-gray-600 mt-1">
              AI drafts &amp; flags · every member-facing doc is human-verified before it goes live
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={loadSources} disabled={sourcesLoading}>
              {sourcesLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              Sources
            </Button>
            <Button variant="outline" onClick={importCurated} disabled title="Temporarily disabled while the document-review intake is being mapped out">
              {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
              Import Curated
            </Button>
            {(statusCounts.approved || 0) > 0 && (
              <Button onClick={pushApproved} disabled={pushing} className="bg-[#1a56db] hover:bg-[#1a56db]/90">
                {pushing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                Publish {statusCounts.approved}
              </Button>
            )}
            {(docTypeCounts.existing_doc || 0) > 0 && (
              <Button onClick={loadGuidedQueue} variant="outline" disabled title="Temporarily disabled while the document-review intake is being mapped out" className="border-amber-300 text-amber-700 hover:bg-amber-50">
                <Layers className="w-4 h-4 mr-2" />
                Re-verify Track
              </Button>
            )}
            <Button onClick={runTriage} disabled title="Temporarily disabled while the document-review intake is being mapped out" className="bg-violet-600 hover:bg-violet-700">
              {triaging ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {triaging ? "Analyzing…" : "Run AI Analysis"}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={runPipeline} disabled title="Temporarily disabled while the document-review intake is being mapped out" variant="outline">
                  {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                  Run Pipeline
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Mines screened transcript sources into taxonomy-tagged truth drafts (needs review). Skips quarantined and already-mined sources. Nothing goes live until a human approves and publishes.
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Analysis status banner */}
        {triageStatus && (triageStatus.running || triageStatus.needsReview > 0) && (
          <Card className="bg-violet-50 border-violet-200">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-3 text-sm">
                <Sparkles className="w-4 h-4 text-violet-600" />
                <span className="text-violet-800 font-medium">
                  {triageStatus.running ? "AI analysis running…" : "AI analysis idle"}
                </span>
                {triageStatus.needsReview > 0 && (
                  <span className="text-amber-700">{triageStatus.needsReview} awaiting your review</span>
                )}
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
          {STATUS_TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setStatusFilter(key); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${statusFilter === key ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            >
              {label} ({statusCounts[key] || 0})
            </button>
          ))}
          {(statusCounts.merged || 0) > 0 && (
            <button
              onClick={() => { setStatusFilter("merged"); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${statusFilter === "merged" ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-400 hover:bg-gray-200"}`}
            >
              Merged ({statusCounts.merged})
            </button>
          )}
        </div>

        {/* Risk-first triage row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500">Risk:</span>
          {[
            ["all", "All"],
            ["flagged", `Flagged (${riskCounts.flagged})`],
            ["blocking", `Blocking (${riskCounts.blocking})`],
            ["needs_expert", `Needs Expert (${riskCounts.needs_expert})`],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setRiskFilter(key); setPage(1); }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${riskFilter === key ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => { setStaleOnly((v) => !v); setPage(1); }}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${staleOnly ? "bg-amber-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            Stale refs ({riskCounts.stale})
          </button>
        </div>

        {/* Doc-type + doc-class + shelf facets (primary) */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500">Type:</span>
          {[
            ["all", "All"],
            ["truth_draft", `${DOC_TYPE_LABEL.truth_draft} (${docTypeCounts.truth_draft || 0})`],
            ["existing_doc", `${DOC_TYPE_LABEL.existing_doc} (${docTypeCounts.existing_doc || 0})`],
            ...Object.keys(docTypeCounts)
              .filter((k) => k && k !== "truth_draft" && k !== "existing_doc")
              .map((k) => [k, `${DOC_TYPE_LABEL[k] ?? k} (${docTypeCounts[k]})`]),
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setDocTypeFilter(key); setPage(1); }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${docTypeFilter === key ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {label}
            </button>
          ))}
          <span className="text-sm text-gray-500 ml-3">Class:</span>
          {[
            ["all", "All"],
            ["citable", `Citable (${docClassCounts.citable || 0})`],
            ["non_citable", `Non-citable (${docClassCounts.non_citable || 0})`],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setDocClassFilter(key); setPage(1); }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${docClassFilter === key ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {label}
            </button>
          ))}
          <span className="text-sm text-gray-500 ml-3">Shelf:</span>
          <Select value={shelfFilter} onValueChange={(v) => { setShelfFilter(v); setPage(1); }}>
            <SelectTrigger className="h-7 w-[180px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All shelves</SelectItem>
              {HOME_ROOTS.map((r) => {
                const cnt = shelfCounts.find((s) => s.homeRoot === r.value)?.count ?? 0;
                return <SelectItem key={r.value} value={r.value}>{r.label} ({cnt})</SelectItem>;
              })}
              {shelfCounts
                .filter((s) => !HOME_ROOT_LABEL[s.homeRoot])
                .map((s) => (
                  <SelectItem key={s.homeRoot} value={s.homeRoot}>{s.homeRoot} ({s.count})</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {/* Origin + tag facets (secondary) */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500">Origin:</span>
          {[
            ["all", "All"],
            ...ORIGIN_OPTIONS.map((o) => [o.value, `${o.label} (${originCounts[o.value] || 0})`] as [string, string]),
            ["unlabeled", `Unlabeled (${originCounts.unlabeled || 0})`],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setOriginFilter(key); setPage(1); }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${originFilter === key ? "bg-[#1a56db] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {label}
            </button>
          ))}
          {tagCounts.length > 0 && (
            <>
              <span className="text-sm text-gray-500 ml-3">Tag:</span>
              <Select value={tagFilter} onValueChange={(v) => { setTagFilter(v); setPage(1); }}>
                <SelectTrigger className="h-7 w-[200px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tags</SelectItem>
                  {tagCounts.map((t) => (
                    <SelectItem key={t.tag} value={t.tag}>{t.tag} ({t.count})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
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
          {statusFilter === "needs_review" && docs.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={bulkApprove} variant="outline" className="border-green-300 text-green-700" disabled={pageSafeCount === 0}>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Confirm Safe on Page ({pageSafeCount})
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Approves the {pageSafeCount} safe doc(s) on this page.
                {pageBlockedCount > 0 && ` ${pageBlockedCount} flagged doc(s) are held back — open and adjudicate them one at a time.`}
              </TooltipContent>
            </Tooltip>
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
                {totalCount === 0 ? "Run the pipeline to mine screened transcript sources" : "Try a different filter or search"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {docs.map((doc) => {
              const sev = maxSeverity(doc.riskFlags);
              return (
                <Card
                  key={doc.id}
                  className={`transition-colors hover:border-[#1a56db]/30 cursor-pointer ${
                    mergeIds.has(doc.id) ? "ring-2 ring-purple-400 border-purple-300" : ""
                  } ${doc.needsExpert || sev === "critical" ? "border-l-4 border-l-red-400" : sev === "high" ? "border-l-4 border-l-orange-400" : ""}`}
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
                            <h3 className="font-semibold text-gray-900 truncate">{doc.aiCleanedTitle || doc.title}</h3>
                            <Badge variant="outline" className={STATUS_COLORS[doc.status] || ""}>
                              {STATUS_LABEL[doc.status] || doc.status.replace(/_/g, " ")}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-600 border-gray-200">
                              {DOC_TYPE_LABEL[doc.docType] ?? doc.docType}
                            </Badge>
                            {doc.authorityRole && (
                              <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">
                                {AUTHORITY_LABEL[doc.authorityRole] ?? doc.authorityRole}
                              </Badge>
                            )}
                            {doc.homeRoot && (
                              <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700 border-sky-200">
                                <FolderTree className="w-2.5 h-2.5 mr-1" />{shelfLabel(doc.homeRoot)}
                              </Badge>
                            )}
                            {doc.originType && (
                              <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-500 border-gray-200">
                                {ORIGIN_LABEL[doc.originType] ?? doc.originType}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1.5">
                            <RiskChips flags={doc.riskFlags} needsExpert={doc.needsExpert} />
                          </div>
                          {doc.aiSummary ? (
                            <p className="text-sm text-gray-600 mt-1 italic">{doc.aiSummary}</p>
                          ) : (
                            <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                              {(doc.editedContent || doc.content).replace(/^#.*\n/gm, "").replace(/\*\*.*?\*\*/g, "").trim().substring(0, 200)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {doc.status === "needs_review" && (
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
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openDoc(doc); }}>
                          <Eye className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

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

      {renderDetailDialog()}

      {/* Source screening surface */}
      <Dialog open={showSources} onOpenChange={setShowSources}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" />Transcript Source Screening
            </DialogTitle>
          </DialogHeader>
          <div className="flex gap-2 flex-wrap mt-2 text-xs">
            {Object.entries(sourceCountsByDisp).map(([disp, cnt]) => (
              <Badge key={disp} variant="outline" className={disp === "quarantined" ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"}>
                {disp}: {cnt}
              </Badge>
            ))}
          </div>
          <div className="space-y-2 mt-4">
            {sources.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No sources found</p>
            ) : sources.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-3 p-3 bg-gray-50 rounded-lg border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{s.sourceName}</span>
                    <Badge variant="outline" className="text-[10px]">{s.sourceKind}</Badge>
                    {s.authorityRole && <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">{s.authorityRole}</Badge>}
                    <Badge variant="outline" className={`text-[10px] ${s.disposition === "quarantined" ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"}`}>
                      {s.disposition}
                    </Badge>
                  </div>
                  {s.notes && <p className="text-xs text-gray-500 mt-0.5">{s.notes}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  {s.disposition === "quarantined" ? (
                    <Button size="sm" variant="outline" className="text-xs text-green-700" onClick={() => setSourceDisposition(s.id, "confirm-training")}>
                      Confirm
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="text-xs text-red-700" onClick={() => setSourceDisposition(s.id, "quarantine")}>
                      Quarantine
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
