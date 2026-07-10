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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth";
import { Link } from "wouter";
import KnowledgeBaseDuplicates, { LiveDocDialog, type LiveSimilarMatch } from "./KnowledgeBaseDuplicates";
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
  Plus,
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
  Wrench,
  BookOpen,
  Undo2,
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
}

// Reviewer SOP (Task #1851) — mirrors the api-server ReviewerSop shape. The
// listings are registry-derived server-side; the client just renders them.
interface ReviewerSop {
  intro: string;
  sections: { id: string; title: string; body: string[] }[];
  homeRoots: { slug: string; label: string; description: string; nodes: { slug: string; label: string }[] }[];
  docClasses: { slug: string; label: string; citable: boolean; charter: string }[];
  ceilings: { slug: string; description: string }[];
  handoffs: { target: string; node: string; nodeLabel: string; description: string }[];
  flags: { type: string; meaning: string }[];
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
  // Ceiling advisory (Task #1868): re-evaluated on EVERY analysis run, even for
  // filed docs. Non-null only when the AI's fresh ceiling differs from the
  // doc's current ceiling. Advisory — reviewer applies on click WITHOUT
  // reopening the filed home-root / node / doc-class.
  aiSuggestedCeiling: string | null;
  aiSuggestedCeilingReason: string | null;
  needsExpert: boolean;
  aiCleanedTitle: string | null;
  // Title-suggestion decision (Task #1839): null = pending,
  // 'accepted' | 'dismissed' | 'edited' = locked (never regenerated).
  aiTitleDecision: string | null;
  aiSummary: string | null;
  // Synthesis Engine Part 3: New-vs-Update. `updateKind` is 'update' when this
  // draft is a proposed REVISION of an existing published Live AI Document
  // (`targetLiveDocId`), with `updateSummary` describing what changed.
  updateKind: string | null;
  targetLiveDocId: number | null;
  updateSummary: string | null;
  // Stamped by AI analysis (triage); null = never analyzed.
  aiRecommendedAction: string | null;
  // Retrieval self-test (Task #1804); null = never self-tested.
  retrievalSelfTest: RetrievalSelfTest | null;
}

interface SelfTestQuestionResult {
  question: string;
  draftLexRank: number;
  draftSemanticScore: number;
  clearsFloor: boolean;
  wouldSurface: boolean;
  passed: boolean;
  topLiveTitle: string | null;
  topLiveLexRank: number;
  topLiveSemanticScore: number;
}

export interface TitleOutcomeSummary {
  title: string;
  passedCount: number;
  total: number;
  passedQuestions: string[];
}

export interface TitleComparison {
  current: TitleOutcomeSummary;
  suggested: TitleOutcomeSummary;
  improved: boolean;
  strictlyBetter: boolean;
  brandFix: boolean;
}

export interface RetrievalSelfTest {
  ranAt: string;
  semanticAvailable: boolean;
  memberQuestions: string[];
  results: SelfTestQuestionResult[];
  passedCount: number;
  failedCount: number;
  titleComparison?: TitleComparison;
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

// Canonical doc classes for AI Document Review (mirror api-server kb-taxonomy.ts
// CITABLE_DOC_CLASSES). Every review doc exists to be approved + promoted into
// the live, citeable KB, so only citeable classes are selectable here — the
// non-citeable `transcript` class belongs to AI Source Knowledge (Task #1873).
// "reference" was UI-only drift and has been removed.
const DOC_CLASS_OPTIONS = [
  { value: "curated", label: "Curated (citable)" },
  { value: "overview", label: "Overview (citable)" },
  { value: "navigation", label: "Navigation (citable walkthrough)" },
];

// Values a review doc's Doc Class field may hold — used to reject any legacy
// non-citeable filed/suggested value when initializing the editor.
const CITABLE_DOC_CLASS_VALUES = new Set(DOC_CLASS_OPTIONS.map((c) => c.value));
// Every review doc is citeable, so an unfiled doc with no usable citeable value
// defaults here rather than to an empty (savable-as-null) class (Task #1873).
const DEFAULT_REVIEW_DOC_CLASS = "curated";
const asCitableDocClass = (value: string | null | undefined): string =>
  value && CITABLE_DOC_CLASS_VALUES.has(value) ? value : "";

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

// Canonical depth ceilings — mirror kb-taxonomy.ts CEILINGS. The editor picks
// from these three instead of free text (Task #1865). Ceiling stays advisory /
// dormant at answer-time; this only captures it.
const CEILING_OPTIONS = [
  { value: "operational", label: "Operational" },
  { value: "conceptual", label: "Conceptual" },
  { value: "troubleshooting", label: "Troubleshooting" },
];
const CEILING_LABEL: Record<string, string> = Object.fromEntries(
  CEILING_OPTIONS.map((c) => [c.value, c.label]),
);
const ceilingLabel = (v: string | null | undefined) =>
  v ? CEILING_LABEL[v] ?? v : "";

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

// ── Retrieval self-test panel (Task #1804) ─────────────────────────────────────
// "Would the assistant find this doc?" — each AI-generated member question was
// run through the real retrieval path; a fail means the draft likely wouldn't
// surface for that ask (add the member's vocabulary to the draft).

export function SelfTestPanel({ selfTest }: { selfTest: RetrievalSelfTest }) {
  const allPassed = selfTest.failedCount === 0;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`mt-3 rounded-lg border shrink-0 ${allPassed ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 p-3 text-sm font-semibold text-gray-800 text-left"
      >
        {allPassed
          ? <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
          : <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />}
        <span className="min-w-0 truncate">
          Retrieval self-test: {selfTest.passedCount}/{selfTest.results.length} member questions find this doc
          {!selfTest.semanticAvailable && (
            <span className="text-[10px] font-normal text-gray-500"> (keyword matching only)</span>
          )}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[11px] font-normal text-gray-500 shrink-0">
          {expanded ? "Hide details" : "Show details"}
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </button>
      {expanded && (
      <div className="px-3 pb-3 space-y-1 max-h-[30vh] overflow-y-auto">
        {selfTest.results.map((r, i) => (
          <div key={i} className="flex items-start gap-2 text-xs bg-white rounded border p-2">
            {r.passed
              ? <CheckCircle className="w-3.5 h-3.5 text-green-600 mt-0.5 shrink-0" />
              : <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />}
            <div className="min-w-0">
              <div className="text-gray-800">"{r.question}"</div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                {r.passed
                  ? "This draft would surface for this question."
                  : !r.clearsFloor
                  ? "The draft doesn't match this question's wording — add this vocabulary to the draft."
                  : "Live docs currently outrank the draft for this question."}
                {r.topLiveTitle && <> Best live match: "{r.topLiveTitle}".</>}
              </div>
            </div>
          </div>
        ))}
      </div>
      )}
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
  const [showSynthDialog, setShowSynthDialog] = useState(false);
  // Reviewer SOP (Task #1851): the in-app "how to review" reference, fetched
  // lazily on first open. Registry-derived server-side so it never drifts.
  const [sopOpen, setSopOpen] = useState(false);
  const [sop, setSop] = useState<ReviewerSop | null>(null);
  const [sopLoading, setSopLoading] = useState(false);
  const [topicIndexOpen, setTopicIndexOpen] = useState(false);
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
  const [editHomeRoot, setEditHomeRoot] = useState("");
  const [editNode, setEditNode] = useState("");
  const [editDocClass, setEditDocClass] = useState("");
  const [editCeiling, setEditCeiling] = useState("");
  // Controlled taxonomy tags (Task #1865): the editor writes taxonomyTags, not
  // the legacy free-text `tags` column.
  const [editTaxonomyTags, setEditTaxonomyTags] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState("");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagVocab, setTagVocab] = useState<{ concept: string[]; tool: string[]; troubleshooting: string[] }>({
    concept: [],
    tool: [],
    troubleshooting: [],
  });
  // Provenance & Authority is collapsed to a one-line summary by default
  // (Task #1865); Show More expands the full detail.
  const [provenanceExpanded, setProvenanceExpanded] = useState(false);
  const [adminNotes, setAdminNotes] = useState("");
  // AI taxonomy suggestion (Task #1851): dismiss is per-doc + advisory-only
  // (the suggestion itself is never persisted; applying it just fills the editor).
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [redrafting, setRedrafting] = useState(false);
  const [reviewInsights, setReviewInsights] = useState<ReviewInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [refineThread, setRefineThread] = useState<
    Array<{
      role: string;
      content: string;
      // Placement-pushback turns (Task #1851) carry an optional note target so
      // the reviewer can opt into leaving a note on the doc it belongs to.
      placement?: {
        verdict: string;
        target: { kind: "live" | "staging"; id: number; title: string } | null;
        noted?: boolean;
      };
    }>
  >([]);
  const chatThreadRef = useRef<HTMLDivElement | null>(null);
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
  // "Not a name" dismissal list (Task #1815) — admin-visible undo list.
  const [nameDismissals, setNameDismissals] = useState<Array<{ id: number; pair: string; displayPair: string; createdAt: string }>>([]);
  const [showNameDismissals, setShowNameDismissals] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Monotonic token so only the latest review-insights request writes state.
  const insightsRequestRef = useRef(0);
  // Duplicate grouping & similar-live-doc aids (Task #1825).
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [liveSimilarMap, setLiveSimilarMap] = useState<Record<number, LiveSimilarMatch>>({});
  const [viewLiveDocId, setViewLiveDocId] = useState<number | null>(null);

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

  // Informational "similar live doc" indicators for the normal review flow —
  // a single batch fetch across all needs-review drafts. Never blocks review.
  const fetchLiveSimilarity = useCallback(async () => {
    try {
      const res = await authFetch("/admin/knowledgebase/staging/live-similarity");
      if (res.ok) {
        const data = await res.json();
        setLiveSimilarMap(data.matches || {});
      }
    } catch {
      // informational only — ignore
    }
  }, []);

  useEffect(() => {
    fetchLiveSimilarity();
  }, [fetchLiveSimilarity]);

  useEffect(() => {
    fetchTriageStatus();
  }, [fetchTriageStatus]);

  // Load the controlled taxonomy tag vocabulary (Task #1865), grouped into
  // Concept / Tool / Troubleshooting for the editor's multi-select.
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/admin/knowledgebase/staging/tag-vocabulary");
        if (res.ok) {
          const data = await res.json();
          setTagVocab({
            concept: Array.isArray(data.concept) ? data.concept : [],
            tool: Array.isArray(data.tool) ? data.tool : [],
            troubleshooting: Array.isArray(data.troubleshooting) ? data.troubleshooting : [],
          });
        }
      } catch {
        // ignore — the multi-select degrades to empty groups
      }
    })();
  }, []);

  const toggleTaxonomyTag = (tag: string) => {
    setEditTaxonomyTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

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

  // Auto-scroll the refine chat thread to the newest message whenever the
  // thread changes, the "Thinking…" indicator appears, or the pane opens.
  useEffect(() => {
    const el = chatThreadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [refineThread, redrafting, chatOpen, chatWide]);

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

  // Title-suggestion lifecycle (Task #1839): explicit accept/dismiss. Either
  // decision locks the suggestion — analysis never regenerates it afterwards.
  const [titleDeciding, setTitleDeciding] = useState(false);
  const decideTitleSuggestion = async (action: "accept" | "dismiss") => {
    if (!selectedDoc || titleDeciding) return;
    setTitleDeciding(true);
    try {
      const res = await authFetch(
        `/admin/knowledgebase/staging/${selectedDoc.id}/title-suggestion/${action}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "Failed to update title suggestion", variant: "destructive" });
        return;
      }
      setSelectedDoc(data);
      setEditTitle(data.title);
      toast({ title: action === "accept" ? "Suggested title applied" : "Suggestion dismissed — keeping current title" });
      fetchDocs();
    } catch {
      toast({ title: "Failed to update title suggestion", variant: "destructive" });
    } finally {
      setTitleDeciding(false);
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

  const updateDoc = async (
    id: number,
    updates: Record<string, unknown>,
    opts?: { closeDialog?: boolean },
  ) => {
    try {
      const res = await authFetch(`/admin/knowledgebase/staging/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Update failed");
      toast({ title: "Document updated" });
      fetchDocs();
      if (opts?.closeDialog) {
        setSelectedDoc(null);
      } else if (selectedDoc?.id === id) {
        const updated: StagingDoc = await res.json();
        setSelectedDoc(updated);
        fetchInsights(id);
        // Re-hydrate the editor's local field state from the freshly-saved
        // document. A targeted in-place update (e.g. the ceiling "Apply"
        // button) otherwise leaves the edit form showing the stale values it
        // captured when the doc was first opened — making Apply look broken and
        // causing a later save to clobber the applied change. Mirror openDoc's
        // initialization here.
        setEditContent(updated.editedContent || updated.content);
        setEditTitle(updated.title);
        setEditHomeRoot(updated.homeRoot ?? updated.aiSuggestedTaxonomy?.homeRoot ?? "");
        setEditNode(updated.node ?? updated.aiSuggestedTaxonomy?.node ?? "");
        setEditDocClass(updated.docClassTarget ?? updated.aiSuggestedTaxonomy?.docClass ?? "");
        setEditCeiling(updated.ceiling ?? updated.aiSuggestedTaxonomy?.ceiling ?? "");
        setEditTaxonomyTags(Array.isArray(updated.taxonomyTags) ? updated.taxonomyTags : []);
        setAdminNotes(updated.adminNotes || "");
      }
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  const unmergeDoc = async (id: number) => {
    try {
      const res = await authFetch("/admin/knowledgebase/staging/duplicates/unmerge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : "Unmerge failed");
      }
      toast({ title: "Draft restored to needs review" });
      fetchDocs();
    } catch (err) {
      toast({ title: "Unmerge failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
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

  // "Not a name" dismissals (Task #1815): one-click persistent suppression of
  // possible_member_name false positives, with an admin-visible undo list.
  const dismissNamePair = async (pair: string) => {
    try {
      const res = await authFetch("/admin/knowledgebase/staging/name-flag-dismissals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: typeof data.error === "string" ? data.error : "Failed to dismiss", variant: "destructive" });
        return;
      }
      toast({ title: `“${pair}” marked as terminology`, description: "It will no longer flag on any document." });
      if (selectedDoc) fetchInsights(selectedDoc.id);
    } catch {
      toast({ title: "Failed to dismiss", variant: "destructive" });
    }
  };

  const fetchNameDismissals = async () => {
    try {
      const res = await authFetch("/admin/knowledgebase/staging/name-flag-dismissals");
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setNameDismissals(data.dismissals ?? []);
    } catch {
      setNameDismissals([]);
    }
  };

  const undoNameDismissal = async (id: number) => {
    try {
      const res = await authFetch(`/admin/knowledgebase/staging/name-flag-dismissals/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Dismissal removed", description: "The pair will flag again on future analyses." });
      fetchNameDismissals();
      if (selectedDoc) fetchInsights(selectedDoc.id);
    } catch {
      toast({ title: "Failed to remove dismissal", variant: "destructive" });
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
    setEditTitle(doc.title);
    setEditHomeRoot(doc.homeRoot ?? doc.aiSuggestedTaxonomy?.homeRoot ?? "");
    setEditNode(doc.node ?? doc.aiSuggestedTaxonomy?.node ?? "");
    // Citeable-only: default to the filed citeable class, else the AI's citeable
    // suggestion, else the citeable default — never a non-citeable (e.g. legacy
    // transcript) value, and never empty (which could save as a null class).
    setEditDocClass(
      asCitableDocClass(doc.docClassTarget) ||
        asCitableDocClass(doc.aiSuggestedTaxonomy?.docClass) ||
        DEFAULT_REVIEW_DOC_CLASS,
    );
    setEditCeiling(doc.ceiling ?? doc.aiSuggestedTaxonomy?.ceiling ?? "");
    setEditTaxonomyTags(Array.isArray(doc.taxonomyTags) ? doc.taxonomyTags : []);
    setTagSearch("");
    setTagPickerOpen(false);
    setAdminNotes(doc.adminNotes || "");
    setSuggestDismissed(false);
    setProvenanceExpanded(false);
  };

  // Apply the full AI taxonomy suggestion into the editor fields (Task #1851).
  // Advisory only — it fills the editor; nothing is persisted until the reviewer
  // saves. Each field is applied only when the suggestion actually offers one.
  const applySuggestedTaxonomy = () => {
    const s = selectedDoc?.aiSuggestedTaxonomy;
    if (!s) return;
    if (s.homeRoot != null) setEditHomeRoot(s.homeRoot);
    if (s.node != null) setEditNode(s.node);
    // Citeable-only (Task #1873): never inject a non-citeable (e.g. legacy
    // transcript) doc class, even from an AI suggestion on a legacy doc.
    const citeable = asCitableDocClass(s.docClass);
    if (citeable) setEditDocClass(citeable);
    if (s.ceiling != null) setEditCeiling(s.ceiling);
    if (Array.isArray(s.tags) && s.tags.length > 0) {
      setEditTaxonomyTags((prev) => Array.from(new Set([...prev, ...s.tags!])));
    }
    setSuggestDismissed(true);
  };

  const saveEdit = async (approve: boolean) => {
    if (!selectedDoc) return;
    await updateDoc(selectedDoc.id, {
      title: editTitle,
      taxonomyTags: editTaxonomyTags,
      editedContent: editContent,
      adminNotes,
      homeRoot: editHomeRoot || null,
      node: editNode || null,
      docClassTarget: editDocClass || null,
      ceiling: editCeiling || null,
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
      // Placement pushback (Task #1851): advice-only, draft untouched. Carry the
      // verdict + optional note target so the thread can offer "leave a note".
      if (data.mode === "placement") {
        setRefineThread((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.assistantMessage || "This may not belong in this document.",
            placement: { verdict: data.verdict, target: data.target ?? null },
          },
        ]);
        return;
      }
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

  // Leave-a-note (Task #1851): opt-in follow-up to a placement-pushback verdict.
  // Records a short reviewer note on the target doc (live doc.reviewer_notes /
  // draft.admin_notes) so its future editor sees the overlap flagged here.
  const leaveNoteOnTarget = async (turnIndex: number) => {
    if (!selectedDoc) return;
    const turn = refineThread[turnIndex];
    const target = turn?.placement?.target;
    if (!target) return;
    const note = window.prompt(
      `Leave a note on “${target.title}” so its next editor sees this overlap:`,
      turn.content.length > 240 ? turn.content.slice(0, 240) + "…" : turn.content,
    );
    if (note == null || !note.trim()) return;
    try {
      const res = await authFetch(`/admin/knowledgebase/staging/${selectedDoc.id}/leave-note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetKind: target.kind, targetId: target.id, note: note.trim() }),
      });
      if (!res.ok) throw new Error("Failed");
      setRefineThread((prev) =>
        prev.map((t, i) =>
          i === turnIndex && t.placement ? { ...t, placement: { ...t.placement, noted: true } } : t,
        ),
      );
      toast({ title: "Note left", description: `Recorded on “${target.title}”.` });
    } catch {
      toast({ title: "Couldn't leave the note", variant: "destructive" });
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

  // Open the Reviewer SOP dialog, lazily loading it on first open (Task #1851).
  const openSop = async () => {
    setSopOpen(true);
    if (sop || sopLoading) return;
    setSopLoading(true);
    try {
      const res = await authFetch("/admin/knowledgebase/staging/reviewer-sop");
      if (!res.ok) throw new Error("Failed");
      setSop(await res.json());
    } catch {
      toast({ title: "Couldn't load the reviewer guide", variant: "destructive" });
    } finally {
      setSopLoading(false);
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
  // Advanced filters tucked behind the "Filters" popover — count non-default
  // ones so a narrowed list is never a mystery.
  const activeAdvancedFilters = [
    riskFilter !== "all",
    docTypeFilter !== "all",
    docClassFilter !== "all",
    updateKindFilter !== "all",
    tagFilter !== "all",
    staleOnly,
  ].filter(Boolean).length;

  // ── Possible-duplicates view (Task #1825) ─────────────────────────────────────
  if (showDuplicates) {
    return (
      <AppLayout>
        <KnowledgeBaseDuplicates onBack={() => { setShowDuplicates(false); fetchDocs(); fetchLiveSimilarity(); }} />
      </AppLayout>
    );
  }

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
                <h2 className="text-xl font-bold text-gray-900 mb-1">{doc.title}</h2>
                <div className="flex items-center gap-2 flex-wrap">
                  {ceilingLabel(doc.ceiling) && (
                    <Badge variant="secondary" className="text-xs">{ceilingLabel(doc.ceiling)}</Badge>
                  )}
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
                <div className="text-[10px] font-mono text-gray-400 mb-0.5">#{selectedDoc.id}</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <DialogTitle className="text-lg">
                    {editMode ? "Edit Document" : selectedDoc.title}
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

              {/* AI title suggestion (Task #1839): the stored title is always
                  what displays/publishes; the suggestion is applied only via
                  an explicit Accept. Accept/Dismiss/human-edit locks it. */}
              {!editMode &&
                selectedDoc.aiCleanedTitle &&
                !selectedDoc.aiTitleDecision &&
                selectedDoc.aiCleanedTitle.trim() !== selectedDoc.title.trim() && (
                <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
                  <div className="flex items-center gap-2 text-violet-800 font-medium mb-1">
                    <Sparkles className="w-4 h-4" />AI suggests a clearer title
                  </div>
                  {(() => {
                    const cmp = selectedDoc.retrievalSelfTest?.titleComparison;
                    if (!cmp) return null;
                    return (
                      <div className="mb-2 rounded-md border border-violet-100 bg-white p-2 text-[13px] text-gray-700 space-y-1.5">
                        <p className="text-[11px] font-medium text-gray-500">
                          Why this suggestion — measured against {cmp.current.total} member question{cmp.current.total === 1 ? "" : "s"}:
                        </p>
                        <div className="flex items-start gap-2">
                          <span className="text-gray-400 shrink-0">Current:</span>
                          <span>
                            “{cmp.current.title}” — finds this doc for{" "}
                            <span className="font-semibold">{cmp.current.passedCount} of {cmp.current.total}</span>
                          </span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-violet-500 shrink-0">Suggested:</span>
                          <span>
                            “{cmp.suggested.title}” — finds this doc for{" "}
                            <span className="font-semibold text-violet-700">{cmp.suggested.passedCount} of {cmp.suggested.total}</span>
                          </span>
                        </div>
                        {cmp.suggested.passedCount > cmp.current.passedCount && (
                          <p className="text-emerald-700 text-[12px]">
                            +{cmp.suggested.passedCount - cmp.current.passedCount} more member question{cmp.suggested.passedCount - cmp.current.passedCount === 1 ? "" : "s"} would surface this doc.
                          </p>
                        )}
                        {cmp.brandFix && (
                          <p className="text-amber-700 text-[12px]">
                            The current title uses outdated/off-brand naming; the suggestion corrects it.
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  {!selectedDoc.retrievalSelfTest?.titleComparison && (
                    <p className="text-gray-800 mb-2">“{selectedDoc.aiCleanedTitle}”</p>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="h-7 px-3 bg-violet-600 hover:bg-violet-700 text-white"
                      disabled={titleDeciding}
                      onClick={() => decideTitleSuggestion("accept")}
                    >
                      Use suggested title
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-3"
                      disabled={titleDeciding}
                      onClick={() => decideTitleSuggestion("dismiss")}
                    >
                      Keep current title
                    </Button>
                  </div>
                </div>
              )}

              {/* Retrieval self-test (Task #1804) */}
              {!editMode && selectedDoc.retrievalSelfTest && selectedDoc.retrievalSelfTest.results?.length > 0 && (
                <SelfTestPanel selfTest={selectedDoc.retrievalSelfTest} />
              )}

              {editMode ? (
                <div className="flex-1 min-h-0 overflow-y-auto space-y-4 mt-4 pr-1">
                  <div>
                    <Label>Title</Label>
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
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
                  {/* Taxonomy editor */}
                  <div className="rounded-lg border bg-sky-50/50 p-3 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-sky-800">
                      <FolderTree className="w-4 h-4" />Taxonomy
                    </div>
                    {selectedDoc.aiSuggestedTaxonomy && !suggestDismissed && (
                      <div className="rounded-md border border-sky-200 bg-white/70 px-2.5 py-2 text-[11px] text-sky-800 flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="font-medium">AI suggests:</div>
                          <div>
                            Shelf: <span className="font-medium">{shelfLabel(selectedDoc.aiSuggestedTaxonomy.homeRoot) || "—"}</span>
                            {" · "}Node: <span className="font-medium">{selectedDoc.aiSuggestedTaxonomy.node || "—"}</span>
                            {" · "}Doc class: <span className="font-medium">{selectedDoc.aiSuggestedTaxonomy.docClass || "—"}</span>
                            {" · "}Ceiling: <span className="font-medium">{ceilingLabel(selectedDoc.aiSuggestedTaxonomy.ceiling) || "—"}</span>
                          </div>
                          {Array.isArray(selectedDoc.aiSuggestedTaxonomy.tags) && selectedDoc.aiSuggestedTaxonomy.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-0.5">
                              <span>Tags:</span>
                              {selectedDoc.aiSuggestedTaxonomy.tags.map((t) => (
                                <Badge key={t} variant="outline" className="text-[10px] bg-white/70">{t}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={applySuggestedTaxonomy}>Apply</Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setSuggestDismissed(true)}>Dismiss</Button>
                        </div>
                      </div>
                    )}
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
                        <Select value={editCeiling || "none"} onValueChange={(v) => setEditCeiling(v === "none" ? "" : v)}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Pick a ceiling" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— Unassigned —</SelectItem>
                            {CEILING_OPTIONS.map((c) => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {/* Controlled taxonomy tags (Task #1865): grouped multi-select
                        over the Concept / Tool / Troubleshooting vocabulary. */}
                    <div>
                      <Label className="text-xs">Tags</Label>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {editTaxonomyTags.length === 0 && (
                          <span className="text-[11px] text-gray-400">No tags selected</span>
                        )}
                        {editTaxonomyTags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[11px] gap-1 pr-1">
                            {tag}
                            <button
                              type="button"
                              className="rounded-sm hover:bg-gray-300/60 p-0.5"
                              onClick={() => toggleTaxonomyTag(tag)}
                              aria-label={`Remove ${tag}`}
                            >
                              <XCircle className="w-3 h-3" />
                            </button>
                          </Badge>
                        ))}
                        <Popover open={tagPickerOpen} onOpenChange={setTagPickerOpen}>
                          <PopoverTrigger asChild>
                            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]">
                              <Plus className="w-3 h-3 mr-1" />Add tag
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-72 p-0">
                            <div className="p-2 border-b">
                              <Input
                                value={tagSearch}
                                onChange={(e) => setTagSearch(e.target.value)}
                                placeholder="Search tags…"
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="max-h-64 overflow-y-auto p-2 space-y-3">
                              {([
                                { key: "concept", label: "Concept" },
                                { key: "tool", label: "Tool" },
                                { key: "troubleshooting", label: "Troubleshooting" },
                              ] as const).map((group) => {
                                const q = tagSearch.trim().toLowerCase();
                                const items = tagVocab[group.key].filter(
                                  (t) => !q || t.toLowerCase().includes(q),
                                );
                                if (items.length === 0) return null;
                                return (
                                  <div key={group.key}>
                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                                      {group.label}
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {items.map((tag) => {
                                        const active = editTaxonomyTags.includes(tag);
                                        return (
                                          <button
                                            key={tag}
                                            type="button"
                                            onClick={() => toggleTaxonomyTag(tag)}
                                            className={`text-[11px] rounded-full border px-2 py-0.5 transition ${
                                              active
                                                ? "bg-sky-600 border-sky-600 text-white"
                                                : "bg-white border-gray-200 text-gray-700 hover:border-sky-300"
                                            }`}
                                          >
                                            {tag}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                              {tagVocab.concept.length === 0 &&
                                tagVocab.tool.length === 0 &&
                                tagVocab.troubleshooting.length === 0 && (
                                  <div className="text-[11px] text-gray-400 py-2 text-center">
                                    No tag vocabulary available.
                                  </div>
                                )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
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
                  {/* Taxonomy summary (Task #1865) — Shelf / Node / Ceiling /
                      Doc class + controlled taxonomy tags. The legacy Category
                      badge and free-text tags are retired. */}
                  <div className="flex gap-2 flex-wrap">
                    {selectedDoc.homeRoot && (
                      <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-200">
                        <FolderTree className="w-3 h-3 mr-1" />{shelfLabel(selectedDoc.homeRoot)}{selectedDoc.node ? ` / ${selectedDoc.node}` : ""}
                      </Badge>
                    )}
                    {selectedDoc.docClassTarget && (
                      <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                        {selectedDoc.docClassTarget}
                      </Badge>
                    )}
                    {selectedDoc.ceiling && (
                      <Badge variant="outline" className="text-xs bg-violet-50 text-violet-700 border-violet-200">
                        Ceiling: {ceilingLabel(selectedDoc.ceiling)}
                      </Badge>
                    )}
                    {selectedDoc.taxonomyTags?.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                    ))}
                  </div>

                  {/* Ceiling advisory (Task #1868). Re-evaluated on EVERY analysis
                      run — surfaces even for filed docs (unlike the taxonomy
                      suggestion, which is suppressed once filed). Applying it sets
                      ONLY the ceiling; the filed home-root / node / doc-class are
                      untouched. */}
                  {selectedDoc.aiSuggestedCeiling &&
                    selectedDoc.aiSuggestedCeiling !== selectedDoc.ceiling && (
                    <div className="rounded-lg border border-violet-300 bg-violet-50 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-medium text-violet-800">
                          <Sparkles className="w-3.5 h-3.5" />
                          Suggested ceiling: {ceilingLabel(selectedDoc.aiSuggestedCeiling)}
                          {selectedDoc.ceiling && (
                            <span className="font-normal text-violet-600">
                              {" "}(currently {ceilingLabel(selectedDoc.ceiling)})
                            </span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => updateDoc(selectedDoc.id, { ceiling: selectedDoc.aiSuggestedCeiling })}
                        >
                          Apply
                        </Button>
                      </div>
                      {selectedDoc.aiSuggestedCeilingReason && (
                        <p className="mt-1 text-violet-700">{selectedDoc.aiSuggestedCeilingReason}</p>
                      )}
                    </div>
                  )}

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

                  {/* Informational similar-live-doc indicator (Task #1825) —
                      never blocks approval; excludes an update draft's own
                      target live doc. */}
                  {liveSimilarMap[selectedDoc.id] && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800 flex items-center gap-2">
                      <GitCompare className="w-4 h-4 shrink-0" />
                      <span>
                        A published live doc looks similar
                        {liveSimilarMap[selectedDoc.id].reason === "title" ? " (same concept title)" : " (similar content)"}:{" "}
                        <span className="font-medium">“{liveSimilarMap[selectedDoc.id].liveTitle}”</span> — informational only.
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto h-6 px-2 text-[11px] border-blue-300 text-blue-700 shrink-0"
                        onClick={() => setViewLiveDocId(liveSimilarMap[selectedDoc.id].liveDocId)}
                      >
                        <Eye className="w-3 h-3 mr-1" />View live doc
                      </Button>
                    </div>
                  )}

                  {/* Provenance panel — collapsed to a one-line summary by
                      default (Task #1865); Show More reveals the full detail. */}
                  <div className="rounded-lg border bg-gray-50 p-3 text-sm space-y-2">
                    <div className="flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-gray-700 shrink-0" />
                      <div className="min-w-0 flex-1 text-gray-600 truncate">
                        <span className="font-medium text-gray-700">Provenance &amp; Authority</span>
                        <span className="text-gray-300 mx-1.5">·</span>
                        <span className="text-gray-400">Origin:</span>{" "}
                        {selectedDoc.originType ? ORIGIN_LABEL[selectedDoc.originType] ?? selectedDoc.originType : selectedDoc.source || "—"}
                        <span className="text-gray-300 mx-1.5">·</span>
                        <span className="text-gray-400">Authority:</span>{" "}
                        {selectedDoc.authorityRole ? AUTHORITY_LABEL[selectedDoc.authorityRole] ?? selectedDoc.authorityRole : "—"}
                        <span className="text-gray-300 mx-1.5">·</span>
                        <span className="text-gray-400">Corroboration:</span>{" "}
                        {selectedDoc.corroborationCount > 0
                          ? `${selectedDoc.corroborationCount} other source(s)`
                          : "single source"}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px] shrink-0"
                        onClick={() => setProvenanceExpanded((v) => !v)}
                      >
                        {provenanceExpanded ? (
                          <><ChevronUp className="w-3 h-3 mr-1" />Show less</>
                        ) : (
                          <><ChevronDown className="w-3 h-3 mr-1" />Show more</>
                        )}
                      </Button>
                    </div>
                    {provenanceExpanded && (
                    <>
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
                    </>
                    )}
                  </div>

                  {/* Always-visible access to the "Not a name" undo list, even when a doc has zero highlights */}
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px] text-amber-700 hover:bg-amber-100"
                      onClick={() => { setShowNameDismissals(true); fetchNameDismissals(); }}
                    >
                      Dismissed names
                    </Button>
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
                                    {h.kind === "possible_member_name" && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 px-2 text-[11px] text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                                        disabled={redrafting}
                                        onClick={() => dismissNamePair(h.excerpt)}
                                        title="Mark this pair as terminology, not a person — it will never flag again"
                                      >
                                        <CheckCircle className="w-3 h-3 mr-1" />Not a name
                                      </Button>
                                    )}
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
                <div className={`${chatWide ? "basis-2/3" : "basis-1/3"} grow-0 shrink-0 min-h-[220px] flex flex-col rounded-lg border border-violet-200 bg-violet-50/60 transition-all`}>
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
                  <div ref={chatThreadRef} className="flex-1 min-h-0 overflow-y-auto space-y-2 p-2">
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
                          {turn.placement?.target && (
                            <div className="mt-2 pt-2 border-t border-violet-100 flex items-center gap-2 flex-wrap">
                              <span className="text-[11px] text-gray-500">
                                Belongs with: <span className="font-medium">{turn.placement.target.title}</span>
                                <span className="ml-1 text-gray-400">
                                  ({turn.placement.target.kind === "live" ? "live doc" : "draft"} #{turn.placement.target.id})
                                </span>
                              </span>
                              {turn.placement.noted ? (
                                <span className="text-[11px] text-emerald-600 font-medium">✓ Note left</span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-[11px]"
                                  onClick={() => leaveNoteOnTarget(i)}
                                >
                                  Leave a note on it
                                </Button>
                              )}
                            </div>
                          )}
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
                  <div className="shrink-0 p-2 border-t border-violet-100 flex items-end gap-2">
                    <Textarea
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          runRefine();
                        }
                      }}
                      rows={Math.min(chatWide ? 4 : 2, Math.max(1, instruction.split("\n").length))}
                      className="resize-none bg-white min-h-0 flex-1 max-h-32 overflow-y-auto"
                      placeholder='Ask or instruct — e.g. "Why does it say X?" or "Tighten the intro"'
                    />
                    <Button size="sm" onClick={runRefine} disabled={redrafting || !instruction.trim()} className="bg-violet-600 hover:bg-violet-700 shrink-0">
                      {redrafting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
                      Send
                    </Button>
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
                    {(selectedDoc.status === "approved" || selectedDoc.status === "rejected") && (
                      <Button onClick={() => updateDoc(selectedDoc.id, { status: "needs_review" }, { closeDialog: true })}
                        variant="outline"
                        className="border-amber-300 text-amber-700 hover:bg-amber-50">
                        <Undo2 className="w-4 h-4 mr-2" />Send back to review
                      </Button>
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
        {/* Standard admin header: full-width title + subheader */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Knowledge Base Truth-Doc Review</h1>
          <p className="text-gray-600 mt-1">
            AI drafts &amp; flags · every member-facing doc is human-verified before it goes live
          </p>
        </div>

        {/* Compact action row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" onClick={runTriage} disabled={triaging} className="bg-violet-600 hover:bg-violet-700">
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(`${import.meta.env.BASE_URL}docs/tips-and-tricks-categorization-sop.pdf`, "_blank", "noopener,noreferrer")}
            title="How to categorize tips-and-tricks content (Nano Banana, Grok, Anstrex, headlines)"
          >
            <FileText className="w-4 h-4 mr-2" />
            Tips SOP
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={openSop}
            title="How to review a truth-doc draft: workflow, taxonomy, doc classes, ceilings/handoffs and the risk-flag catalog"
            data-testid="button-reviewer-sop"
          >
            <BookOpen className="w-4 h-4 mr-2" />
            Reviewer Guide
          </Button>
          {(statusCounts.approved || 0) > 0 && (
            <Button size="sm" onClick={pushApproved} disabled={pushing} className="bg-[#1a56db] hover:bg-[#1a56db]/90">
              {pushing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Publish {statusCounts.approved}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" data-testid="button-pipeline-tools">
                <Wrench className="w-4 h-4 mr-2" />
                Pipeline tools
                <ChevronDown className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuItem onSelect={loadSources} disabled={sourcesLoading}>
                {sourcesLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                Sources
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={importCurated} disabled title="Temporarily disabled while the document-review intake is being mapped out">
                {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
                Import Curated
              </DropdownMenuItem>
              {(docTypeCounts.existing_doc || 0) > 0 && (
                <DropdownMenuItem onSelect={loadGuidedQueue} disabled title="Temporarily disabled while the document-review intake is being mapped out">
                  <Layers className="w-4 h-4 mr-2" />
                  Re-verify Track
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={buildTopicIndex} disabled={processing} title="Classifies every screened source document into the taxonomy node(s) it informs. Run this before synthesizing.">
                {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Layers className="w-4 h-4 mr-2" />}
                Build Topic Index
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowSynthDialog(true)} disabled={processing}>
                {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                Synthesize…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={toggleCoverage}>
                <Layers className="w-4 h-4 mr-2" />
                {showCoverage ? "Hide Coverage" : "Coverage"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowDuplicates(true)} data-testid="button-possible-duplicates">
                <GitCompare className="w-4 h-4 mr-2" />
                Possible Duplicates
              </DropdownMenuItem>
              {/*
                Blitz change-monitoring (Task #1564) — DORMANT. The plumbing to
                detect changed core-training sources and propose reference-doc
                revisions exists on the backend, but the feature is intentionally
                OFF: this item stays disabled (no boot hook, no schedule). It is
                the only entry point to that plumbing.
              */}
              <DropdownMenuItem disabled title="Coming soon — automatic detection of changed Blitz/core-training content is not enabled yet.">
                <Radar className="w-4 h-4 mr-2" />
                Scan for changes
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Topic-index summary (Task #1794, decluttered): one-line health
            summary with a warning tint when something is flagged; click to
            expand the full last-run detail. */}
        {topicIndex && (topicIndex.running || topicIndex.qualityCheckRunning || topicIndex.lastRun) && (() => {
          const lastRun = topicIndex.lastRun;
          const degradedCount = lastRun ? lastRun.lexicalCount + lastRun.failedCount : 0;
          const flagged =
            !!lastRun &&
            (lastRun.duplicateFlags.length > 0 || degradedCount > 0 || !!lastRun.error || !lastRun.finishedAt);
          return (
          <Card className={flagged ? "border-amber-300 bg-amber-50/50" : "border-slate-200"}>
            <CardContent className="py-0 px-0">
              <button
                type="button"
                onClick={() => setTopicIndexOpen((o) => !o)}
                aria-expanded={topicIndexOpen}
                data-testid="button-topic-index-summary"
                className="w-full flex items-center gap-2 py-2.5 px-4 text-left text-sm"
              >
                {flagged
                  ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  : <Layers className="w-4 h-4 text-gray-400 shrink-0" />}
                <span className="font-semibold text-gray-900 shrink-0">Topic Index</span>
                {topicIndex.running ? (
                  <span className="flex items-center gap-2 text-xs text-blue-700 min-w-0 truncate">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    Classifying {topicIndex.processed}/{topicIndex.total} sources…
                  </span>
                ) : lastRun ? (
                  <span className="text-xs text-gray-500 min-w-0 truncate">
                    Last run {new Date(lastRun.startedAt).toLocaleString()}
                    {lastRun.finishedAt ? "" : " (interrupted)"}
                    {lastRun.force ? " · full re-classify" : " · incremental"}
                    {flagged
                      ? <span className="text-amber-700">
                          {" · "}
                          {[
                            lastRun.duplicateFlags.length > 0 ? `${lastRun.duplicateFlags.length} duplicate group${lastRun.duplicateFlags.length === 1 ? "" : "s"}` : null,
                            degradedCount > 0 ? `${degradedCount} degraded` : null,
                            lastRun.error ? "run error" : null,
                          ].filter(Boolean).join(" · ")}
                        </span>
                      : <span className="text-emerald-700"> · healthy</span>}
                  </span>
                ) : null}
                {topicIndex.qualityCheckRunning && (
                  <span className="flex items-center gap-1.5 text-xs text-violet-700 shrink-0">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> spot-check running…
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1 text-[11px] text-gray-500 shrink-0">
                  {topicIndexOpen ? "Hide details" : "Details"}
                  {topicIndexOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </span>
              </button>
              {topicIndexOpen && (
              <div className="px-4 pb-4 space-y-3">
              <div className="flex justify-end">
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
              </div>
              )}
            </CardContent>
          </Card>
          );
        })()}

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

        {/* Analysis progress strip — shown ONLY while a background run is in
            progress; disappears entirely once it finishes. */}
        {triageStatus?.running && (() => {
          const totalToTriage = triageStatus.triaged + triageStatus.pendingTriage;
          const pct = totalToTriage > 0 ? Math.round((triageStatus.triaged / totalToTriage) * 100) : 0;
          return (
            <Card className="bg-violet-50 border-violet-200" data-testid="strip-ai-analysis-running">
              <CardContent className="py-3 px-4 space-y-2">
                <div className="flex items-center gap-3 text-sm">
                  <Loader2 className="w-4 h-4 text-violet-600 animate-spin" />
                  <span className="text-violet-800 font-medium">
                    AI analysis running… {triageStatus.triaged} of {totalToTriage} analyzed
                  </span>
                </div>
                <div className="w-full bg-violet-100 rounded-full h-1.5">
                  <div className="bg-violet-600 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </CardContent>
            </Card>
          );
        })()}

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

        {/* Search + primary drill-downs + advanced filters (one row) */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="pl-10"
            />
          </div>
          <Select value={shelfFilter} onValueChange={(v) => { setShelfFilter(v); setPage(1); }}>
            <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue /></SelectTrigger>
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
          <Select value={nodeFilter} onValueChange={(v) => { setNodeFilter(v); setPage(1); }}>
            <SelectTrigger className="h-9 w-[200px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All nodes</SelectItem>
              {nodeCounts.map((n) => (
                <SelectItem key={n.node} value={n.node}>{n.node} ({n.count})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={activeAdvancedFilters > 0 ? "border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100" : ""}
                data-testid="button-advanced-filters"
              >
                <ListFilter className="w-4 h-4 mr-2" />
                Filters{activeAdvancedFilters > 0 ? ` (${activeAdvancedFilters})` : ""}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[380px] space-y-4">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Risk</span>
                <div className="flex items-center gap-1.5 flex-wrap">
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
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</span>
                <div className="flex items-center gap-1.5 flex-wrap">
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
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Class</span>
                <div className="flex items-center gap-1.5 flex-wrap">
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
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Change</span>
                <div className="flex items-center gap-1.5 flex-wrap">
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
                </div>
              </div>
              {tagCounts.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tag</span>
                  <Select value={tagFilter} onValueChange={(v) => { setTagFilter(v); setPage(1); }}>
                    <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All tags</SelectItem>
                      {tagCounts.map((t) => (
                        <SelectItem key={t.tag} value={t.tag}>{t.tag} ({t.count})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {activeAdvancedFilters > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-gray-500"
                  onClick={() => {
                    setRiskFilter("all");
                    setDocTypeFilter("all");
                    setDocClassFilter("all");
                    setUpdateKindFilter("all");
                    setTagFilter("all");
                    setStaleOnly(false);
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              )}
            </PopoverContent>
          </Popover>
          {mergeIds.size >= 2 && (
            <Button onClick={mergeSelected} disabled={merging} variant="outline" size="sm" className="border-purple-300 text-purple-700">
              {merging ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Merge className="w-4 h-4 mr-2" />}
              Merge {mergeIds.size} Selected
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
                  onClick={() => openDoc(doc)}
                  data-testid={`card-staging-doc-${doc.id}`}
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
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-mono text-gray-400 mb-0.5">#{doc.id}</div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-gray-900 truncate">{doc.title}</h3>
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
                            {liveSimilarMap[doc.id] && (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-blue-50 text-blue-700 border-blue-300 cursor-pointer hover:bg-blue-100"
                                onClick={(e) => { e.stopPropagation(); setViewLiveDocId(liveSimilarMap[doc.id].liveDocId); }}
                                title={`A published live doc looks similar (${liveSimilarMap[doc.id].reason === "title" ? "same concept title" : "similar content"}): "${liveSimilarMap[doc.id].liveTitle}". Click to read it. Informational only.`}
                                data-testid={`badge-live-similar-${doc.id}`}
                              >
                                <Eye className="w-2.5 h-2.5 mr-1" />Similar live doc
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
                      {doc.status === "merged" && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-purple-700 border-purple-300 hover:bg-purple-50 text-xs"
                            title={`Restore this draft to needs review${doc.mergedIntoId ? ` (currently merged into #${doc.mergedIntoId})` : ""}`}
                            data-testid={`button-unmerge-${doc.id}`}
                            onClick={(e) => { e.stopPropagation(); unmergeDoc(doc.id); }}
                          >
                            Unmerge
                          </Button>
                        </div>
                      )}
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

      {/* Reviewer SOP reference (Task #1851) — registry-derived, drift-guarded. */}
      <Dialog open={sopOpen} onOpenChange={setSopOpen}>
        <DialogContent className="max-w-[900px] w-[92vw] sm:max-w-[900px] h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <BookOpen className="w-5 h-5" /> Reviewer Guide — Truth-Doc Review SOP
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-5 text-sm">
            {sopLoading && (
              <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            )}
            {sop && (
              <>
                <p className="text-gray-700">{sop.intro}</p>

                {sop.sections.map((s) => (
                  <div key={s.id}>
                    <h3 className="font-semibold text-gray-900 mb-1">{s.title}</h3>
                    <ul className="list-disc pl-5 space-y-1 text-gray-700">
                      {s.body.map((b, i) => (<li key={i}>{b}</li>))}
                    </ul>
                  </div>
                ))}

                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Shelves &amp; nodes</h3>
                  <div className="space-y-2">
                    {sop.homeRoots.map((r) => (
                      <div key={r.slug} className="rounded-md border bg-sky-50/50 p-2">
                        <div className="font-medium text-sky-800">{r.label} <span className="text-xs font-normal text-sky-600">({r.slug})</span></div>
                        <div className="text-xs text-gray-600">{r.description}</div>
                        <div className="text-xs text-gray-700 mt-1">
                          {r.nodes.map((n) => n.label).join(" · ")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Doc classes</h3>
                  <ul className="space-y-1 text-gray-700">
                    {sop.docClasses.map((c) => (
                      <li key={c.slug}>
                        <span className="font-medium">{c.label}</span>{" "}
                        <span className={c.citable ? "text-emerald-600 text-xs" : "text-gray-400 text-xs"}>
                          {c.citable ? "citable" : "non-citable"}
                        </span>
                        <div className="text-xs text-gray-600">{c.charter}</div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">Depth ceilings</h3>
                    <ul className="space-y-1 text-gray-700 text-xs">
                      {sop.ceilings.map((c) => (
                        <li key={c.slug}><span className="font-medium">{c.slug}</span>: {c.description}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">Handoffs</h3>
                    <ul className="space-y-1 text-gray-700 text-xs">
                      {sop.handoffs.map((h) => (
                        <li key={h.target}><span className="font-medium">{h.target}</span> → {h.nodeLabel}: {h.description}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Risk-flag catalog</h3>
                  <ul className="space-y-1 text-gray-700 text-xs">
                    {sop.flags.map((f) => (
                      <li key={f.type}><span className="font-mono text-[11px] bg-gray-100 px-1 rounded">{f.type}</span> — {f.meaning}</li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <LiveDocDialog liveDocId={viewLiveDocId} onClose={() => setViewLiveDocId(null)} />

      {/* Synthesis scope picker (moved out of the header into Pipeline tools) */}
      <Dialog open={showSynthDialog} onOpenChange={setShowSynthDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Play className="w-5 h-5 text-gray-600" />
              Synthesize truth-doc drafts
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Consolidates each node's linked sources into ONE truth-doc draft with multi-source
              provenance (needs review). Nothing goes live until a human approves and publishes.
            </p>
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Scope</span>
              <Select value={synthScope} onValueChange={(v) => setSynthScope(v as SynthScope)}>
                <SelectTrigger className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="incremental">Incremental (new + failed)</SelectItem>
                  <SelectItem value="shelf">One shelf…</SelectItem>
                  <SelectItem value="covered">Covered only</SelectItem>
                  <SelectItem value="all">All nodes (full run)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {synthScope === "shelf" && (
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Shelf</span>
                <Select value={synthRoot} onValueChange={setSynthRoot}>
                  <SelectTrigger className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOME_ROOTS.map((r) => (<SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {failedNodesPendingRetry.length > 0 && (
              <p
                className="text-xs text-amber-700"
                title={`Failed nodes: ${failedNodesPendingRetry.slice(0, 15).join(", ")}${failedNodesPendingRetry.length > 15 ? "…" : ""}`}
              >
                {failedNodesPendingRetry.length} failed node{failedNodesPendingRetry.length === 1 ? "" : "s"} pending retry — an
                incremental run retries them automatically.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSynthDialog(false)}>Cancel</Button>
            <Button
              onClick={() => { setShowSynthDialog(false); startSynthesis(); }}
              disabled={processing}
              data-testid="button-run-synthesis"
            >
              <Play className="w-4 h-4 mr-2" />Synthesize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* "Not a name" dismissal list (Task #1815) — admin-visible undo list */}
      <Dialog open={showNameDismissals} onOpenChange={setShowNameDismissals}>
        <DialogContent className="max-w-lg max-h-[75vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-600" />Dismissed name flags
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-gray-500">
            Pairs a reviewer marked as terminology (“Not a name”). They never flag as possible
            member names on any document. Remove one to make it flag again.
          </p>
          <div className="space-y-1.5 mt-2">
            {nameDismissals.length === 0 ? (
              <p className="text-gray-500 text-center py-6 text-sm">No dismissals yet</p>
            ) : nameDismissals.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 p-2 bg-gray-50 rounded-md border text-sm">
                <span className="font-mono">{d.displayPair}</span>
                <span className="text-xs text-gray-400 ml-auto">{new Date(d.createdAt).toLocaleDateString()}</span>
                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] text-red-700 border-red-200 hover:bg-red-50" onClick={() => undoNameDismissal(d.id)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
