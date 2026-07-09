import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
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
import { Link } from "wouter";
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
  ChevronUp,
  ChevronDown,
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
  Radar,
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

interface SynthSource {
  sourceDocId?: number | null;
  sourceType?: string | null;
  authorityRole?: string | null;
  sourceName?: string | null;
  transcriptSourceId?: number | null;
  relevance?: number | null;
  isNew?: boolean | null;
}

// Review-gate insights (Task #1752): risky passages + contributing source set,
// computed server-side from the draft's CURRENT text.
interface ReviewHighlight {
  kind: string;
  severity: FlagSeverity;
  label: string;
  excerpt: string;
  line: number;
  lineText: string;
  note: string;
}

interface ReviewSource {
  sourceName: string | null;
  sourceType: string | null;
  sourceKind: string | null;
  coachName: string | null;
  authorityRole: string | null;
  relevance: number | null;
  date: string | null;
}

interface ReviewInsights {
  highlights: ReviewHighlight[];
  sources: ReviewSource[];
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
  synthesisSources: SynthSource[] | null;
  conflictData: ConflictData | null;
  staleReferences: string[] | null;
  aiSuggestedTaxonomy: SuggestedTaxonomy | null;
  needsExpert: boolean;
  aiCleanedTitle: string | null;
  aiSummary: string | null;
  // Synthesis Engine Part 3: New-vs-Update. `updateKind` is 'update' when this
  // draft is a proposed REVISION of an existing published Live AI Document
  // (`targetLiveDocId`), with `updateSummary` describing what changed.
  updateKind: string | null;
  targetLiveDocId: number | null;
  updateSummary: string | null;
  // Stamped by AI analysis (triage); null = never analyzed.
  aiRecommendedAction: string | null;
}

interface StatusCounts {
  [key: string]: number;
}

interface ShelfCount {
  homeRoot: string;
  count: number;
}

interface NodeCount {
  node: string;
  count: number;
}

// Synthesis Engine Part 2 (Task #1534): depth-aware coverage view.
interface NodeCoverage {
  slug: string;
  label: string;
  root: string;
  importance: "high" | "normal";
  sourceCount: number;
  newSourceCount: number;
  isAffected: boolean;
  lastSynthesizedAt: string | null;
  lastSynthesizedSourceCount: number | null;
  liveDocCount: number;
  liveDocTiers: string[];
  expectedTier: "overview" | "curated";
  depthGap: boolean;
  depthGapReason: string | null;
}

interface SynthesisCoverage {
  nodes: NodeCoverage[];
  depthGapCount: number;
  affectedCount: number;
}

interface NavGapFlagRow {
  id: number;
  app: string;
  area: string;
  status: string;
  tier: number;
  topicCount: number;
  lastEvidence: string | null;
}

type SynthScope = "all" | "shelf" | "covered" | "incremental" | "nodes";

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
  unanalyzed?: number;
}

// Topic-index run status (Task #1794): live progress + durable last-run report
// (survives restarts) + corpus-health split from the status endpoint.
interface TopicIndexRunReport {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  force: boolean;
  total: number;
  processed: number;
  llmCount: number;
  llmNoneCount: number;
  lexicalCount: number;
  failedCount: number;
  excludedCount: number;
  linkedCount: number;
  error: string | null;
  failures: Array<{ sourceDocId: number; title: string; reason: string }>;
  duplicateFlags: Array<{ ids: number[]; titles: string[] }>;
  qualityCheck: {
    ranAt: string;
    model: string;
    sampleSize: number;
    nodeAgreement: number;
    meanRelevanceDelta: number;
  } | null;
}

interface TopicIndexStatus {
  running: boolean;
  total: number;
  processed: number;
  linked: number;
  llmCount: number;
  llmNoneCount: number;
  lexicalCount: number;
  failedCount: number;
  excludedCount: number;
  error: string | null;
  lastRun: TopicIndexRunReport | null;
  health: {
    totalSources: number;
    llmSources: number;
    pureLexicalSources: number;
    zeroLinkSources: number;
    llmNoneSources: number;
  } | null;
  qualityCheckRunning: boolean;
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
  { value: "navigation", label: "Navigation (citable walkthrough)" },
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

// ── Review-focus highlighting (Task #1752) ──────────────────────────────────────

// Line tint + excerpt mark styles per severity.
const HIGHLIGHT_LINE_BG: Record<FlagSeverity, string> = {
  critical: "bg-red-50",
  high: "bg-orange-50",
  medium: "bg-amber-50",
  low: "bg-slate-50",
};
const HIGHLIGHT_MARK_BG: Record<FlagSeverity, string> = {
  critical: "bg-red-200",
  high: "bg-orange-200",
  medium: "bg-amber-200",
  low: "bg-slate-200",
};

/** Wrap each highlight excerpt found in `text` with a tinted <mark>. */
function markExcerpts(text: string, hs: ReviewHighlight[]): ReactNode {
  // Collect non-overlapping [start, end, severity] ranges (first occurrence each).
  const ranges: Array<{ start: number; end: number; severity: FlagSeverity }> = [];
  for (const h of hs) {
    if (!h.excerpt) continue;
    let from = 0;
    const idxAll: number[] = [];
    let idx = text.indexOf(h.excerpt, from);
    while (idx !== -1) {
      idxAll.push(idx);
      from = idx + h.excerpt.length;
      idx = text.indexOf(h.excerpt, from);
    }
    for (const start of idxAll) {
      const end = start + h.excerpt.length;
      if (!ranges.some((r) => start < r.end && end > r.start)) {
        ranges.push({ start, end, severity: h.severity });
      }
    }
  }
  if (ranges.length === 0) return text;
  ranges.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) out.push(text.slice(cursor, r.start));
    out.push(
      <mark key={i} className={`${HIGHLIGHT_MARK_BG[r.severity]} rounded px-0.5`}>
        {text.slice(r.start, r.end)}
      </mark>,
    );
    cursor = r.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

/** Render draft content line-by-line with risk-highlighted lines and excerpts. */
function HighlightedContent({ content, highlights }: { content: string; highlights: ReviewHighlight[] }) {
  const byLine = new Map<number, ReviewHighlight[]>();
  for (const h of highlights) {
    const arr = byLine.get(h.line) ?? [];
    arr.push(h);
    byLine.set(h.line, arr);
  }
  const lines = content.split("\n");
  return (
    <div className="font-sans text-sm text-gray-800 leading-relaxed">
      {lines.map((line, i) => {
        // Only trust highlights whose lineText still matches (content may have
        // shifted between analysis and render — never mis-highlight).
        const hs = (byLine.get(i) ?? []).filter((h) => h.lineText === line);
        if (hs.length === 0) {
          return (
            <div key={i} className="whitespace-pre-wrap min-h-[1.25em]">
              {line || "\u00A0"}
            </div>
          );
        }
        const worst = hs.reduce<FlagSeverity>(
          (acc, h) => (SEVERITY_RANK[h.severity] > SEVERITY_RANK[acc] ? h.severity : acc),
          "low",
        );
        return (
          <div key={i} className={`whitespace-pre-wrap min-h-[1.25em] ${HIGHLIGHT_LINE_BG[worst]} -mx-1 px-1 rounded-sm`}>
            {markExcerpts(line, hs)}
          </div>
        );
      })}
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
  const [updateKindCounts, setUpdateKindCounts] = useState<{ new: number; update: number }>({ new: 0, update: 0 });
  const [riskCounts, setRiskCounts] = useState<RiskCounts>({ blocking: 0, flagged: 0, needs_expert: 0, stale: 0 });
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [shelfCounts, setShelfCounts] = useState<ShelfCount[]>([]);
  const [nodeCounts, setNodeCounts] = useState<NodeCount[]>([]);
  const [coverage, setCoverage] = useState<SynthesisCoverage | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [navGaps, setNavGaps] = useState<NavGapFlagRow[]>([]);
  // Default to Incremental: full-corpus "All nodes" runs take ~13h and cost
  // real LLM budget, so the expensive scope is opt-in behind a confirm dialog.
  const [synthScope, setSynthScope] = useState<SynthScope>("incremental");
  const [confirmSynthAll, setConfirmSynthAll] = useState(false);
  const [failedNodesPendingRetry, setFailedNodesPendingRetry] = useState<string[]>([]);
  const [synthRoot, setSynthRoot] = useState("process");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const [includeAnalyzed, setIncludeAnalyzed] = useState(false);
  const [analyzingDoc, setAnalyzingDoc] = useState(false);
  const [chatWide, setChatWide] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [topicIndex, setTopicIndex] = useState<TopicIndexStatus | null>(null);
  const topicIndexPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [importing, setImporting] = useState(false);
  const [statusFilter, setStatusFilter] = useState("needs_review");
  const [originFilter, setOriginFilter] = useState("all");
  const [docTypeFilter, setDocTypeFilter] = useState("all");
  const [shelfFilter, setShelfFilter] = useState("all");
  const [nodeFilter, setNodeFilter] = useState("all");
  const [docClassFilter, setDocClassFilter] = useState("all");
  const [updateKindFilter, setUpdateKindFilter] = useState("all");
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
  const [reviewInsights, setReviewInsights] = useState<ReviewInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [refineThread, setRefineThread] = useState<Array<{ role: string; content: string }>>([]);
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
  // Monotonic token so only the latest review-insights request writes state.
  const insightsRequestRef = useRef(0);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (searchQuery) params.set("search", searchQuery);
      if (docTypeFilter && docTypeFilter !== "all") params.set("docType", docTypeFilter);
      if (shelfFilter && shelfFilter !== "all") params.set("homeRoot", shelfFilter);
      if (nodeFilter && nodeFilter !== "all") params.set("node", nodeFilter);
      if (docClassFilter && docClassFilter !== "all") params.set("docClass", docClassFilter);
      if (updateKindFilter && updateKindFilter !== "all") params.set("updateKind", updateKindFilter);
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
      setUpdateKindCounts(data.updateKindCounts || { new: 0, update: 0 });
      setRiskCounts(data.riskCounts || { blocking: 0, flagged: 0, needs_expert: 0, stale: 0 });
      setTagCounts(data.tagCounts || []);
      setShelfCounts(data.shelfCounts || []);
      setNodeCounts(data.nodeCounts || []);
      setTotalPages(data.pagination?.totalPages || 1);
      setTotal(data.pagination?.total || 0);
    } catch {
      toast({ title: "Error loading documents", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, docTypeFilter, shelfFilter, nodeFilter, docClassFilter, updateKindFilter, tagFilter, riskFilter, staleOnly, searchQuery, page, toast]);

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

  // Topic-index status: fetch once on mount, then poll while a build (or
  // model-quality spot-check) is running so the progress card stays live.
  const fetchTopicIndexStatus = useCallback(async () => {
    try {
      const res = await authFetch("/admin/knowledgebase/pipeline/topic-index-status");
      if (res.ok) setTopicIndex(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchTopicIndexStatus();
  }, [fetchTopicIndexStatus]);

  useEffect(() => {
    const active = topicIndex?.running || topicIndex?.qualityCheckRunning;
    if (active) {
      topicIndexPollRef.current = setInterval(fetchTopicIndexStatus, 4000);
    } else if (topicIndexPollRef.current) {
      clearInterval(topicIndexPollRef.current);
      topicIndexPollRef.current = null;
    }
    return () => { if (topicIndexPollRef.current) { clearInterval(topicIndexPollRef.current); topicIndexPollRef.current = null; } };
  }, [topicIndex?.running, topicIndex?.qualityCheckRunning, fetchTopicIndexStatus]);

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

  // Synthesis Engine (Task #1533): flat-file "process transcripts" mining is
  // retired. The engine builds a topic index over the whole source corpus, then
  // consolidates each taxonomy node into ONE truth-doc draft (needs review).
  const buildTopicIndex = async () => {
    setProcessing(true);
    try {
      const res = await authFetch("/admin/knowledgebase/pipeline/build-topic-index", { method: "POST" });
      const data = await res.json();
      toast({ title: data.message ?? "Building topic index…" });
      // Kick the status card into polling mode immediately.
      setTimeout(fetchTopicIndexStatus, 1500);
    } catch {
      toast({ title: "Failed to build topic index", variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const runTopicIndexQualityCheck = async () => {
    try {
      const res = await authFetch("/admin/knowledgebase/pipeline/topic-index-quality-check", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "Failed to start quality check", variant: "destructive" });
        return;
      }
      toast({ title: data.message ?? "Running model-quality spot-check…" });
      setTimeout(fetchTopicIndexStatus, 1500);
    } catch {
      toast({ title: "Failed to start quality check", variant: "destructive" });
    }
  };

  // Failed-nodes hint for the Synthesize control ("N failed nodes pending
  // retry" — incremental scope picks them up automatically). Best-effort.
  const fetchSynthesisStatus = useCallback(async () => {
    try {
      const res = await authFetch("/admin/knowledgebase/pipeline/synthesis-status");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.failedNodesPendingRetry)) {
        setFailedNodesPendingRetry(data.failedNodesPendingRetry);
      }
    } catch {
      // hint only — ignore
    }
  }, []);

  useEffect(() => {
    fetchSynthesisStatus();
  }, [fetchSynthesisStatus]);

  const startSynthesis = () => {
    if (synthScope === "all") {
      setConfirmSynthAll(true);
      return;
    }
    runSynthesis();
  };

  const runSynthesis = async () => {
    setConfirmSynthAll(false);
    setProcessing(true);
    try {
      const body: Record<string, unknown> = { scope: synthScope };
      if (synthScope === "shelf") body.root = synthRoot;
      const res = await authFetch("/admin/knowledgebase/pipeline/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "Failed to start synthesis", variant: "destructive" });
        return;
      }
      toast({ title: data.message ?? "Synthesizing…", description: "New truth-doc drafts land in the review queue." });
      setTimeout(fetchSynthesisStatus, 2000);
    } catch {
      toast({ title: "Failed to start synthesis", variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const fetchCoverage = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const res = await authFetch("/admin/knowledgebase/pipeline/synthesis-coverage");
      const data = await res.json();
      if (res.ok) setCoverage(data as SynthesisCoverage);
    } catch {
      toast({ title: "Failed to load coverage", variant: "destructive" });
    } finally {
      setCoverageLoading(false);
    }
    // Advisory navigation-gap flags (Task #1776) — surfaced alongside depth
    // gaps in the coverage view; never block publishing. Best-effort.
    try {
      const res = await authFetch("/admin/knowledgebase/nav/gaps");
      const data = await res.json();
      if (res.ok && Array.isArray(data.flags)) setNavGaps(data.flags as NavGapFlagRow[]);
    } catch {
      // advisory only — ignore
    }
  }, []);

  const dismissNavGap = async (id: number) => {
    try {
      const res = await authFetch(`/admin/knowledgebase/nav/gaps/${id}/dismiss`, { method: "POST" });
      if (!res.ok) throw new Error();
      setNavGaps((prev) => prev.filter((f) => f.id !== id));
      toast({ title: "Gap dismissed", description: "It will never be re-raised by later runs." });
    } catch {
      toast({ title: "Failed to dismiss gap", variant: "destructive" });
    }
  };

  const toggleCoverage = () => {
    const next = !showCoverage;
    setShowCoverage(next);
    if (next) fetchCoverage();
  };

  const runTriage = async () => {
    setTriaging(true);
    try {
      const res = await authFetch("/admin/knowledgebase/staging/run-triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeStatuses: ["pending_review", "needs_review"], includeAnalyzed }),
      });
      const data = await res.json();
      toast({ title: data.message });
      // "Nothing to do" responses don't start a background run — stop polling.
      if (!data.running) setTriaging(false);
    } catch {
      toast({ title: "Failed to start analysis", variant: "destructive" });
      setTriaging(false);
    }
  };

  // Synchronous per-doc analysis from the review dialog. Blocks the button
  // (not the whole dialog) and refreshes the doc in place when done.
  const analyzeSelectedDoc = async () => {
    if (!selectedDoc || analyzingDoc) return;
    setAnalyzingDoc(true);
    try {
      const res = await authFetch(`/admin/knowledgebase/staging/${selectedDoc.id}/analyze`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "Analysis failed", variant: "destructive" });
        return;
      }
      if (data.document) {
        setSelectedDoc(data.document);
        fetchInsights(data.document.id);
      }
      toast({ title: "AI analysis complete" });
      fetchDocs();
      fetchTriageStatus();
    } catch {
      toast({ title: "Analysis failed", variant: "destructive" });
    } finally {
      setAnalyzingDoc(false);
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
        fetchInsights(id);
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

  // Review-gate insights (Task #1752): fetched fresh whenever the draft text
  // changes (open / edit-save / refine) so highlights track the CURRENT text.
  const fetchInsights = async (docId: number) => {
    // Version guard: only the LATEST request may write state, so a slow
    // response for a previously-open doc can never render on the wrong doc.
    const token = ++insightsRequestRef.current;
    setInsightsLoading(true);
    try {
      const res = await authFetch(`/admin/knowledgebase/staging/${docId}/review-insights`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      if (insightsRequestRef.current !== token) return; // stale response
      setReviewInsights(data);
    } catch {
      if (insightsRequestRef.current !== token) return;
      setReviewInsights(null); // advisory panel — fail quiet, content still shown
    } finally {
      if (insightsRequestRef.current === token) setInsightsLoading(false);
    }
  };

  const openDoc = (doc: StagingDoc) => {
    setSelectedDoc(doc);
    setEditMode(false);
    setInstruction("");
    setRefineThread([]);
    setReviewInsights(null);
    loadRefineThread(doc.id);
    fetchInsights(doc.id);
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

  const loadRefineThread = async (docId: number) => {
    try {
      const res = await authFetch(`/admin/knowledgebase/staging/${docId}/refine-thread`);
      if (!res.ok) return;
      const data = await res.json();
      const rows: Array<{ reasoning: string | null }> = data.thread || [];
      const turns: Array<{ role: string; content: string }> = [];
      // Persisted rows are newest-first; replay chronologically. Each row's
      // reasoning packs "…per instruction: <instr> — <assistant summary>".
      for (const r of rows.slice().reverse()) {
        const reasoning = r.reasoning || "";
        const m = reasoning.match(/per instruction:\s*([\s\S]*?)\s+—\s+([\s\S]*)$/);
        if (m) {
          turns.push({ role: "user", content: m[1].trim() });
          turns.push({ role: "assistant", content: m[2].trim() });
        } else if (reasoning) {
          turns.push({ role: "assistant", content: reasoning });
        }
      }
      setRefineThread(turns);
    } catch {
      /* thread is best-effort context; ignore load failures */
    }
  };

  // Core refine call — shared by the chat box (runRefine) and the per-passage
  // "Soften" control (softenHighlight). Builds on the existing /refine path.
  const sendRefine = async (myInstruction: string) => {
    if (!selectedDoc || !myInstruction.trim()) return;
    const priorHistory = refineThread;
    setRedrafting(true);
    setRefineThread((prev) => [...prev, { role: "user", content: myInstruction }]);
    try {
      const res = await authFetch(`/admin/knowledgebase/staging/${selectedDoc.id}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: myInstruction, history: priorHistory }),
      });
      if (!res.ok) throw new Error("Refine failed");
      const data = await res.json();
      // Richer change descriptions: append the per-edit summary so the
      // reviewer can verify what changed without diffing.
      const changeList: string[] = Array.isArray(data.changes) ? data.changes : [];
      const bubble =
        (data.assistantMessage || "Draft updated.") +
        (changeList.length ? "\n\nChanges:\n" + changeList.map((c: string) => `• ${c}`).join("\n") : "");
      setRefineThread((prev) => [...prev, { role: "assistant", content: bubble }]);
      if (data.mode !== "discussion") {
        // Only edit turns touch the draft; discussion turns leave it as-is.
        setSelectedDoc(data.document);
        setEditContent(data.document.editedContent || data.document.content);
        fetchDocs();
        fetchInsights(selectedDoc.id);
      }
    } catch {
      toast({ title: "Refine failed", variant: "destructive" });
      setRefineThread((prev) => prev.slice(0, -1));
      throw new Error("refine-failed");
    } finally {
      setRedrafting(false);
    }
  };

  const runRefine = async () => {
    if (!selectedDoc || !instruction.trim()) return;
    const myInstruction = instruction.trim();
    setInstruction("");
    try {
      await sendRefine(myInstruction);
    } catch {
      setInstruction(myInstruction); // restore the box so the admin can retry
    }
  };

  // Per-passage "Soften": canned refine instruction quoting the flagged excerpt.
  const softenHighlight = (h: ReviewHighlight) => {
    if (redrafting) return;
    const line = h.lineText.length > 220 ? h.lineText.slice(0, 220) + "…" : h.lineText;
    sendRefine(
      `Soften this flagged passage (${h.label}): keep any facts correct but rewrite it as timeless, context-bound guidance — no member-specific figures stated as universal targets, no time-sensitive phrasing, no names. Flagged excerpt: "${h.excerpt}" in the line: "${line.trim()}". Remove any leftover [SITUATIONAL]/[CONTEXT-BOUND]/[ANOMALY] tags or SOURCE CONFLICT blockquote markers from that passage once resolved.`,
    ).catch(() => {});
  };

  // Per-passage "Cut": deterministically remove the flagged line via the
  // existing draft-edit path (PATCH editedContent). Exact-line match so a
  // stale insight can never delete the wrong text.
  const cutHighlightLine = async (h: ReviewHighlight) => {
    if (!selectedDoc) return;
    const current = selectedDoc.editedContent || selectedDoc.content;
    const lines = current.split("\n");
    let idx = h.line >= 0 && lines[h.line] === h.lineText ? h.line : lines.indexOf(h.lineText);
    if (idx === -1) {
      toast({ title: "Passage has changed", description: "Refreshing highlights — try again.", variant: "destructive" });
      fetchInsights(selectedDoc.id);
      return;
    }
    lines.splice(idx, 1);
    // Collapse a doubled blank line left by the removal.
    if (idx > 0 && idx < lines.length && lines[idx] === "" && lines[idx - 1] === "") lines.splice(idx, 1);
    const next = lines.join("\n");
    await updateDoc(selectedDoc.id, { editedContent: next });
    setEditContent(next);
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
      <Dialog open={!!selectedDoc} onOpenChange={(open) => { if (!open) { setSelectedDoc(null); setEditMode(false); setChatOpen(false); setChatWide(false); } }}>
        <DialogContent className="max-w-[1150px] w-[92vw] sm:max-w-[1150px] h-[88vh] flex flex-col overflow-hidden">
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
                <div className="flex-1 min-h-0 overflow-y-auto space-y-4 mt-4 pr-1">
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
                <div className="flex-1 min-h-0 flex flex-col gap-3 mt-4">
                {/* Top pane: the document + panels (independently scrollable) */}
                <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
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

                  {/* New-vs-Update panel (Synthesis Engine Part 3). A proposed
                      revision supersedes an existing published Live AI Document —
                      the reviewer sees the diff + which live doc it replaces before
                      approving (the same human gate; no silent second copy). */}
                  {selectedDoc.updateKind === "update" ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm space-y-2">
                      <div className="flex items-center gap-2 font-medium text-amber-800">
                        <GitCompare className="w-4 h-4" />
                        Proposed update to an existing published doc
                        {selectedDoc.targetLiveDocId ? (
                          <span className="text-amber-700 font-normal">
                            — supersedes live doc #{selectedDoc.targetLiveDocId}
                          </span>
                        ) : null}
                      </div>
                      {selectedDoc.updateSummary ? (
                        <div className="rounded-md border border-amber-200 bg-white p-2">
                          <p className="text-gray-500 text-xs font-medium mb-1">What changed vs the current version:</p>
                          <div className="whitespace-pre-wrap text-gray-700 text-xs">{selectedDoc.updateSummary}</div>
                        </div>
                      ) : null}
                      <p className="text-amber-700 text-xs">
                        On approval this revision replaces the published version in place; the prior version is
                        archived to history and last-verified is re-stamped.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800 flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      New document — no existing published doc for this topic.
                    </div>
                  )}

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
                    {/* Multi-source provenance — the sources this truth-doc consolidates */}
                    {selectedDoc.synthesisSources && selectedDoc.synthesisSources.length > 0 ? (
                      <div className="rounded-md border bg-white p-2">
                        <p className="text-gray-500 text-xs font-medium mb-1">
                          Consolidated from {selectedDoc.synthesisSources.length} source(s):
                        </p>
                        <ul className="space-y-0.5 max-h-40 overflow-auto">
                          {(reviewInsights?.sources?.length
                            ? reviewInsights.sources.map((s, i) => (
                                <li key={`ri-${i}`} className="flex items-center gap-2 text-xs text-gray-600">
                                  <span className="text-gray-400 w-4 text-right">{i + 1}.</span>
                                  <span className="truncate">{s.sourceName ?? "Unknown source"}</span>
                                  {s.coachName && (
                                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">{s.coachName}</Badge>
                                  )}
                                  {s.authorityRole && (
                                    <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">{s.authorityRole}</Badge>
                                  )}
                                  {s.date && (
                                    <span className="text-gray-400 whitespace-nowrap">{new Date(s.date).toLocaleDateString()}</span>
                                  )}
                                  {typeof s.relevance === "number" && (
                                    <span className="ml-auto text-gray-400">{Math.round(s.relevance * 100)}%</span>
                                  )}
                                </li>
                              ))
                            : selectedDoc.synthesisSources
                                .slice()
                                .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
                                .map((s, i) => (
                                  <li key={`${s.sourceDocId ?? "s"}-${i}`} className="flex items-center gap-2 text-xs text-gray-600">
                                    <span className="text-gray-400 w-4 text-right">{i + 1}.</span>
                                    <span className="truncate">{s.sourceName ?? `Source #${s.sourceDocId ?? "?"}`}</span>
                                    {s.authorityRole && (
                                      <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">{s.authorityRole}</Badge>
                                    )}
                                    {typeof s.relevance === "number" && (
                                      <span className="ml-auto text-gray-400">{Math.round(s.relevance * 100)}%</span>
                                    )}
                                  </li>
                                )))}
                        </ul>
                      </div>
                    ) : selectedDoc.sourceVideoTitle ? (
                      <p className="text-gray-600"><span className="text-gray-400">Source:</span> {selectedDoc.sourceVideoTitle}</p>
                    ) : null}
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

                  {/* Review focus — risky passages with per-passage soften/cut (Task #1752) */}
                  {(insightsLoading || (reviewInsights?.highlights?.length ?? 0) > 0) && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                        <Radar className="w-4 h-4" />
                        Review focus
                        {insightsLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                        ) : (
                          <span className="text-xs font-normal text-amber-700">
                            {reviewInsights?.highlights.length} flagged passage(s) — soften, cut, or confirm each before publishing
                          </span>
                        )}
                      </div>
                      {!insightsLoading && reviewInsights && (
                        <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                          {reviewInsights.highlights
                            .slice()
                            .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
                            .map((h, i) => (
                              <li key={`${h.kind}-${h.line}-${i}`} className="rounded-md border bg-white p-2 text-xs space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="outline" className={`text-[10px] ${SEVERITY_STYLES[h.severity].chip}`}>
                                    {h.label}
                                  </Badge>
                                  <span className="font-mono text-gray-700 truncate max-w-[18rem]" title={h.excerpt}>
                                    “{h.excerpt.length > 60 ? h.excerpt.slice(0, 60) + "…" : h.excerpt}”
                                  </span>
                                  <span className="text-gray-400">line {h.line + 1}</span>
                                  <span className="ml-auto flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 px-2 text-[11px] text-violet-700 border-violet-200 hover:bg-violet-50"
                                      disabled={redrafting}
                                      onClick={() => softenHighlight(h)}
                                    >
                                      <Wand2 className="w-3 h-3 mr-1" />Soften
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 px-2 text-[11px] text-red-700 border-red-200 hover:bg-red-50"
                                      disabled={redrafting}
                                      onClick={() => cutHighlightLine(h)}
                                    >
                                      <XCircle className="w-3 h-3 mr-1" />Cut line
                                    </Button>
                                  </span>
                                </div>
                                <p className="text-gray-500">{h.note}</p>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  )}

                  <div className="bg-gray-50 p-4 rounded-lg border">
                    {reviewInsights && reviewInsights.highlights.length > 0 ? (
                      <HighlightedContent
                        content={selectedDoc.editedContent || selectedDoc.content}
                        highlights={reviewInsights.highlights}
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
                        {selectedDoc.editedContent || selectedDoc.content}
                      </pre>
                    )}
                  </div>

                  {selectedDoc.adminNotes && (
                    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-sm font-medium text-yellow-800">Admin Notes</p>
                      <p className="text-sm text-yellow-700 mt-1">{selectedDoc.adminNotes}</p>
                    </div>
                  )}
                </div>

                {/* Bottom pane: refine chat — threaded, corpus-aware refinement.
                    Collapsed by default; opens to ~1/3 of the dialog height with
                    a one-click expand toggle to ~2/3 (chat-dominant). Thread
                    scrolls, input stays pinned at the bottom and auto-grows. */}
                {!chatOpen ? (
                  <button
                    type="button"
                    onClick={() => setChatOpen(true)}
                    className="shrink-0 flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-sm font-medium text-violet-800 hover:bg-violet-100/70 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Wand2 className="w-4 h-4" />Refine with AI
                      {refineThread.length > 0 && (
                        <span className="text-xs font-normal text-violet-600">
                          ({refineThread.length} message{refineThread.length === 1 ? "" : "s"})
                        </span>
                      )}
                    </span>
                    <ChevronUp className="w-4 h-4" />
                  </button>
                ) : (
                <div className={`${chatWide ? "h-2/3" : "h-1/3"} shrink-0 min-h-0 flex flex-col rounded-lg border border-violet-200 bg-violet-50/60 transition-all`}>
                  <div className="flex items-center justify-between px-3 py-2 border-b border-violet-100">
                    <div className="flex items-center gap-2 text-sm font-medium text-violet-800">
                      <Wand2 className="w-4 h-4" />Refine with AI
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-violet-700"
                        onClick={() => setChatWide((w) => !w)}
                        title={chatWide ? "Shrink chat to 1/3 height" : "Expand chat to 2/3 height"}
                      >
                        {chatWide ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-violet-700"
                        onClick={() => { setChatOpen(false); setChatWide(false); }}
                        title="Collapse chat"
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-2 p-2">
                    {refineThread.length === 0 && (
                      <p className="text-xs text-violet-700/80 px-1 pt-1">
                        Ask a question about this draft or its sources, or give an edit
                        instruction — questions are answered without touching the draft.
                      </p>
                    )}
                    {refineThread.map((turn, i) => (
                      <div
                        key={i}
                        className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
                      >
                        <div
                          className={
                            "max-w-[85%] md:max-w-[720px] rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap break-words " +
                            (turn.role === "user"
                              ? "bg-violet-600 text-white"
                              : "bg-white border border-violet-100 text-gray-800")
                          }
                        >
                          {turn.content}
                        </div>
                      </div>
                    ))}
                    {redrafting && (
                      <div className="flex justify-start">
                        <div className="rounded-lg px-3 py-1.5 text-sm bg-white border border-violet-100 text-gray-500 flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="p-2 border-t border-violet-100 space-y-2">
                    <Textarea
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          runRefine();
                        }
                      }}
                      rows={Math.min(6, Math.max(2, instruction.split("\n").length))}
                      className="resize-none bg-white"
                      placeholder='Ask or instruct — e.g. "Why does it say X?" or "Tighten the intro"'
                    />
                    <div className="flex justify-end">
                      <Button size="sm" onClick={runRefine} disabled={redrafting || !instruction.trim()} className="bg-violet-600 hover:bg-violet-700">
                        {redrafting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
                        Send
                      </Button>
                    </div>
                  </div>
                </div>
                )}
                </div>
              )}

              <DialogFooter className="mt-4 shrink-0">
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
                    <Button
                      variant="outline"
                      onClick={analyzeSelectedDoc}
                      disabled={analyzingDoc || triaging}
                      title={triaging ? "A batch AI analysis is running — per-doc analysis is disabled until it finishes." : undefined}
                      className="border-violet-300 text-violet-700 hover:bg-violet-50"
                    >
                      {analyzingDoc ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                      {analyzingDoc ? "Analyzing…" : selectedDoc.aiRecommendedAction ? "Re-analyze" : "Analyze with AI"}
                    </Button>
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
            <Button
              variant="outline"
              onClick={() => window.open(`${import.meta.env.BASE_URL}docs/tips-and-tricks-categorization-sop.pdf`, "_blank", "noopener,noreferrer")}
              title="How to categorize tips-and-tricks content (Nano Banana, Grok, Anstrex, headlines)"
            >
              <FileText className="w-4 h-4 mr-2" />
              Tips SOP
            </Button>
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
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={runTriage} disabled={triaging} className="bg-violet-600 hover:bg-violet-700">
                    {triaging ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                    {triaging ? "Analyzing…" : "Run AI Analysis"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Analyzes staged drafts: suggested taxonomy, risk flags and a recommendation. By default only docs that have never been analyzed are processed{typeof triageStatus?.unanalyzed === "number" ? ` (${triageStatus.unanalyzed} pending)` : ""}. Tick "include analyzed" to re-run everything.
                </TooltipContent>
              </Tooltip>
              <label className="flex items-center gap-1 text-[11px] text-gray-600 cursor-pointer select-none" title="Re-analyze docs that already have an AI analysis too">
                <input
                  type="checkbox"
                  checked={includeAnalyzed}
                  onChange={(e) => setIncludeAnalyzed(e.target.checked)}
                  className="h-3.5 w-3.5 accent-violet-600"
                />
                include analyzed
              </label>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={buildTopicIndex} disabled={processing} variant="outline">
                  {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Layers className="w-4 h-4 mr-2" />}
                  Build Topic Index
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Classifies every screened source document into the taxonomy node(s) it informs. Run this before synthesizing.
              </TooltipContent>
            </Tooltip>
            <div className="flex items-center gap-1">
              <Select value={synthScope} onValueChange={(v) => setSynthScope(v as SynthScope)}>
                <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="incremental">Incremental (new + failed)</SelectItem>
                  <SelectItem value="shelf">One shelf…</SelectItem>
                  <SelectItem value="covered">Covered only</SelectItem>
                  <SelectItem value="all">All nodes (full run)</SelectItem>
                </SelectContent>
              </Select>
              {failedNodesPendingRetry.length > 0 && (
                <span
                  className="text-[11px] text-amber-700 whitespace-nowrap"
                  title={`Failed nodes: ${failedNodesPendingRetry.slice(0, 15).join(", ")}${failedNodesPendingRetry.length > 15 ? "…" : ""} — an incremental run retries them automatically.`}
                >
                  {failedNodesPendingRetry.length} failed node{failedNodesPendingRetry.length === 1 ? "" : "s"} pending retry
                </span>
              )}
              {synthScope === "shelf" && (
                <Select value={synthRoot} onValueChange={setSynthRoot}>
                  <SelectTrigger className="h-9 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOME_ROOTS.map((r) => (<SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={startSynthesis} disabled={processing} variant="outline">
                    {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                    Synthesize
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Consolidates a node's linked sources into ONE truth-doc draft with multi-source provenance and a corroboration count (needs review). Scope controls which nodes run: all, one shelf, only nodes with sources, or just those with newly-classified material (incremental). Nothing goes live until a human approves and publishes.
                </TooltipContent>
              </Tooltip>
            </div>
            <Button onClick={toggleCoverage} variant="outline">
              <Layers className="w-4 h-4 mr-2" />
              {showCoverage ? "Hide Coverage" : "Coverage"}
            </Button>
            {/*
              Blitz change-monitoring (Task #1564) — DORMANT. The plumbing to
              detect changed core-training sources and propose reference-doc
              revisions exists on the backend, but the feature is intentionally
              OFF: this button stays disabled (no boot hook, no schedule). It is
              the only entry point to that plumbing.
            */}
            <Button
              variant="outline"
              disabled
              title="Coming soon — automatic detection of changed Blitz/core-training content is not enabled yet."
            >
              <Radar className="w-4 h-4 mr-2" />
              Scan for changes
            </Button>
          </div>
        </div>

        {/* Topic-index run progress + durable last-run report (Task #1794). */}
        {topicIndex && (topicIndex.running || topicIndex.qualityCheckRunning || topicIndex.lastRun) && (
          <Card className="border-slate-200">
            <CardContent className="py-4 px-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-semibold text-sm text-gray-900">Topic Index</span>
                  {topicIndex.running ? (
                    <span className="flex items-center gap-2 text-xs text-blue-700">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Classifying {topicIndex.processed}/{topicIndex.total} sources…
                    </span>
                  ) : topicIndex.lastRun ? (
                    <span className="text-xs text-gray-500">
                      Last run {new Date(topicIndex.lastRun.startedAt).toLocaleString()}
                      {topicIndex.lastRun.finishedAt ? "" : " (interrupted)"}
                      {topicIndex.lastRun.force ? " · full re-classify" : " · incremental"}
                    </span>
                  ) : null}
                  {topicIndex.qualityCheckRunning && (
                    <span className="flex items-center gap-1.5 text-xs text-violet-700">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> quality spot-check running…
                    </span>
                  )}
                </div>
                <Button onClick={runTopicIndexQualityCheck} variant="ghost" size="sm"
                  disabled={topicIndex.running || topicIndex.qualityCheckRunning}
                  title="Re-classify a sample of healthy sources with the current model and compare against stored links (no changes are saved).">
                  Quality spot-check
                </Button>
              </div>
              {(() => {
                const src = topicIndex.running ? topicIndex : topicIndex.lastRun;
                if (!src) return null;
                const degraded = src.lexicalCount + src.failedCount;
                return (
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{src.llmCount} LLM-classified</span>
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{src.llmNoneCount} no-topic (LLM verdict)</span>
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{src.excludedCount} excluded (duplicates)</span>
                    {degraded > 0 ? (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        {degraded} degraded ({src.lexicalCount} lexical fallback, {src.failedCount} failed) — re-attempted next run
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">0 degraded</span>
                    )}
                    {"error" in src && src.error && (
                      <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700">run error: {src.error}</span>
                    )}
                  </div>
                );
              })()}
              {topicIndex.health && !topicIndex.running && (
                <div className="text-xs text-gray-500">
                  Corpus health: {topicIndex.health.llmSources}/{topicIndex.health.totalSources} sources LLM-linked
                  {topicIndex.health.pureLexicalSources > 0 && <> · <span className="text-amber-700">{topicIndex.health.pureLexicalSources} lexical-only</span></>}
                  {topicIndex.health.zeroLinkSources > 0 && <> · {topicIndex.health.zeroLinkSources} unlinked ({topicIndex.health.llmNoneSources} deliberate no-topic)</>}
                </div>
              )}
              {topicIndex.lastRun && topicIndex.lastRun.duplicateFlags.length > 0 && (
                <div className="text-xs text-amber-700">
                  {topicIndex.lastRun.duplicateFlags.length} exact-duplicate source group{topicIndex.lastRun.duplicateFlags.length === 1 ? "" : "s"} flagged for cleanup:{" "}
                  {topicIndex.lastRun.duplicateFlags.slice(0, 3).map((g) => g.titles[0]).join("; ")}
                  {topicIndex.lastRun.duplicateFlags.length > 3 ? "…" : ""}
                </div>
              )}
              {topicIndex.lastRun?.qualityCheck && (
                <div className="text-xs text-gray-600">
                  Model quality ({topicIndex.lastRun.qualityCheck.model}, {topicIndex.lastRun.qualityCheck.sampleSize} sources):{" "}
                  <span className={topicIndex.lastRun.qualityCheck.nodeAgreement >= 0.85 ? "text-emerald-700 font-medium" : "text-amber-700 font-medium"}>
                    {(topicIndex.lastRun.qualityCheck.nodeAgreement * 100).toFixed(0)}% node agreement
                  </span>{" "}
                  vs stored links · mean relevance delta {topicIndex.lastRun.qualityCheck.meanRelevanceDelta >= 0 ? "+" : ""}
                  {topicIndex.lastRun.qualityCheck.meanRelevanceDelta.toFixed(2)}
                </div>
              )}
              {topicIndex.lastRun && topicIndex.lastRun.failures.length > 0 && (
                <details className="text-xs text-gray-600">
                  <summary className="cursor-pointer">{topicIndex.lastRun.failures.length} source failure{topicIndex.lastRun.failures.length === 1 ? "" : "s"} recorded</summary>
                  <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                    {topicIndex.lastRun.failures.map((f) => (
                      <li key={f.sourceDocId}>#{f.sourceDocId} {f.title}: <span className="text-red-700">{f.reason}</span></li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>
        )}

        {showCoverage && (
          <Card className="border-slate-200">
            <CardContent className="py-4 px-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm text-gray-900">Depth-Aware Coverage</span>
                  {coverage && (
                    <>
                      <span className="text-xs text-gray-500">{coverage.nodes.length} nodes</span>
                      {coverage.affectedCount > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          {coverage.affectedCount} with new sources
                        </span>
                      )}
                      {coverage.depthGapCount > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          {coverage.depthGapCount} depth gap{coverage.depthGapCount === 1 ? "" : "s"} (advisory)
                        </span>
                      )}
                    </>
                  )}
                </div>
                <Button onClick={fetchCoverage} variant="ghost" size="sm" disabled={coverageLoading}>
                  {coverageLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
                </Button>
              </div>
              {coverageLoading && !coverage ? (
                <div className="text-sm text-gray-500 py-4 text-center">Loading coverage…</div>
              ) : coverage ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="py-1.5 pr-3 font-medium">Node</th>
                        <th className="py-1.5 px-2 font-medium">Shelf</th>
                        <th className="py-1.5 px-2 font-medium text-right">Sources</th>
                        <th className="py-1.5 px-2 font-medium text-right">New</th>
                        <th className="py-1.5 px-2 font-medium">Live docs</th>
                        <th className="py-1.5 px-2 font-medium">Target tier</th>
                        <th className="py-1.5 px-2 font-medium">Last synthesized</th>
                        <th className="py-1.5 pl-2 font-medium">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coverage.nodes.map((n) => (
                        <tr key={n.slug} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-1.5 pr-3">
                            <span className="font-medium text-gray-900">{n.label}</span>
                            {n.importance === "high" && (
                              <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-purple-100 text-purple-700 align-middle">high</span>
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-gray-600">{n.root}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{n.sourceCount}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">
                            {n.newSourceCount > 0 ? <span className="text-blue-600 font-medium">{n.newSourceCount}</span> : <span className="text-gray-300">0</span>}
                          </td>
                          <td className="py-1.5 px-2 text-gray-600">
                            {n.liveDocCount > 0 ? `${n.liveDocCount} (${n.liveDocTiers.join(", ")})` : <span className="text-gray-300">none</span>}
                          </td>
                          <td className="py-1.5 px-2 text-gray-600">{n.expectedTier}</td>
                          <td className="py-1.5 px-2 text-gray-500">
                            {n.lastSynthesizedAt ? new Date(n.lastSynthesizedAt).toLocaleDateString() : <span className="text-gray-300">never</span>}
                          </td>
                          <td className="py-1.5 pl-2">
                            <div className="flex gap-1 flex-wrap">
                              {n.isAffected && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">new sources</span>
                              )}
                              {n.depthGap && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title={n.depthGapReason ?? undefined}>depth gap</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Depth-gap flags are advisory only — they highlight high-demand topics with enough source material but no published doc at the target depth. They never block publishing.
                  </p>
                </div>
              ) : (
                <div className="text-sm text-gray-500 py-4 text-center">No coverage data.</div>
              )}
              {navGaps.length > 0 && (
                <div className="border-t pt-3" data-testid="panel-nav-gaps">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-sm text-gray-900">Navigation Gaps</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                      {navGaps.length} open (advisory)
                    </span>
                    <Link href="/admin/ai-knowledgebase/navigation-docs" className="text-xs text-blue-600 hover:underline ml-auto">
                      Author walkthroughs →
                    </Link>
                  </div>
                  <div className="space-y-1.5">
                    {navGaps.map((gap) => (
                      <div key={gap.id} className="flex items-center gap-2 text-xs border border-gray-100 rounded px-2 py-1.5" data-testid={`row-nav-gap-${gap.id}`}>
                        <span className="font-medium text-gray-900">{gap.app}</span>
                        <span className="text-gray-500">· {gap.area}</span>
                        {gap.tier === 2 && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-500">lower priority</span>
                        )}
                        <span className="text-gray-400 ml-auto tabular-nums" title={gap.lastEvidence ?? undefined}>
                          {gap.topicCount} topic{gap.topicCount === 1 ? "" : "s"}
                        </span>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => dismissNavGap(gap.id)} data-testid={`button-dismiss-nav-gap-${gap.id}`}>
                          Dismiss
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Navigation-gap flags are advisory only — synthesis noticed members performing tasks in these apps with no published walkthrough doc covering them. Dismissals are sticky; publishing a covering navigation doc auto-resolves the flag. They never block publishing.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

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
          <span className="text-sm text-gray-500 ml-3">Change:</span>
          {[
            ["all", "All"],
            ["new", `New (${updateKindCounts.new || 0})`],
            ["update", `Update (${updateKindCounts.update || 0})`],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setUpdateKindFilter(key); setPage(1); }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${updateKindFilter === key ? "bg-amber-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {label}
            </button>
          ))}
          <span className="text-sm text-gray-500 ml-3">Shelf:</span>
          <Select value={shelfFilter} onValueChange={(v) => { setShelfFilter(v); setPage(1); }}>
            <SelectTrigger className="h-7 w-[160px] text-xs"><SelectValue /></SelectTrigger>
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
          {/* Node is the PRIMARY synthesis drill-down (Shelf → Node) */}
          <span className="text-sm text-gray-500 ml-3">Node:</span>
          <Select value={nodeFilter} onValueChange={(v) => { setNodeFilter(v); setPage(1); }}>
            <SelectTrigger className="h-7 w-[220px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All nodes</SelectItem>
              {nodeCounts.map((n) => (
                <SelectItem key={n.node} value={n.node}>{n.node} ({n.count})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tag facet (secondary) */}
        <div className="flex items-center gap-2 flex-wrap">
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
                            {doc.updateKind === "update" ? (
                              <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300">
                                Update{doc.targetLiveDocId ? ` → #${doc.targetLiveDocId}` : ""}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                                New
                              </Badge>
                            )}
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

      {/* Confirm gate for the expensive full-corpus synthesis run */}
      <Dialog open={confirmSynthAll} onOpenChange={setConfirmSynthAll}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Run synthesis on ALL nodes?
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-600 space-y-2">
            <p>
              This will re-synthesize{" "}
              <span className="font-medium">
                {nodeCounts.length > 0 ? `all ${nodeCounts.length} taxonomy nodes` : "every taxonomy node"}
              </span>{" "}
              — a full-corpus run can take many hours (a prior full run took ~13h) and uses significant
              AI budget.
            </p>
            <p className="text-amber-700">
              It also creates <span className="font-medium">new drafts for nodes that are already
              current</span>, adding duplicate documents to the review queue.
            </p>
            <p>
              The default <span className="font-medium">Incremental</span> scope already covers new
              material and automatically retries failed nodes
              {failedNodesPendingRetry.length > 0
                ? ` (${failedNodesPendingRetry.length} currently pending retry)`
                : ""}.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSynthAll(false)}>Cancel</Button>
            <Button onClick={runSynthesis} className="bg-amber-600 hover:bg-amber-700">
              <Play className="w-4 h-4 mr-2" />Run all nodes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
