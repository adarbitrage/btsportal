import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sparkles, CheckCircle2, Send,
  ClipboardList, AlertCircle,
  Upload, AlertTriangle, X, RotateCw, Loader2,
} from "lucide-react";
import { useState, useRef } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useListTickets, useGetTicket } from "@workspace/api-client-react";
import type { Ticket } from "@workspace/api-client-react";
import {
  validateTicketAttachment,
  TICKET_ATTACHMENT_MAX_LABEL,
  TICKET_ATTACHMENT_ALLOWED_LABEL,
  isActiveTicketStatus,
  isAwaitingMember,
  formatMemberSubmissionStatus,
} from "@workspace/support-config";

const API_BASE = `${import.meta.env.BASE_URL}api`;

const networkOptions = ["Clickbank", "MediaMavens"];
const trafficSources = ["Grasshopper", "Crane", "Caterpillar"];
const phases = ['"Build" Phase', '"Test" Phase', '"Scale" Phase'];

const bannerSizes = ["300x250", "970x250", "970x550", "900x750", "1536x864"];

const shareOptions = ["Yes, I have shared access", "No, I have not shared access"];

// Each task carries a stable `id` separate from its display `label` so the
// dynamic relabeling (network/traffic-driven wording) and the "selected
// tasks"/banner-size/split-test conditionals never have to match on the
// human-readable string.
type Task = { id: string; label: string };

const SPLIT_TEST_TASK_ID = "build-split-tests";
// Tasks that reveal the Banner Sizes selector once selected.
const BANNER_SIZE_TASK_IDS = ["build-full-banner", "scale-promising-other-sizes"];

// Page-creative terminology follows the Affiliate Network; banner/ad
// terminology follows the Traffic Source. Returned plural so the Test/Scale
// labels read naturally.
const pagePlural = (network: string) => (network === "MediaMavens" ? "Advertorials" : "Jump Pages");
const bannerPlural = (traffic: string) => (traffic === "Caterpillar" ? "Ads" : "Banners");

function buildPhaseTasks(network: string, traffic: string): Task[] {
  const pageTasks: Task[] =
    network === "Clickbank"
      ? [
          { id: "build-jumppage-heroshots", label: "Create Jump Page Hero Shot Images (10 images max)" },
          { id: "build-jumppage-headlines", label: "Create Jump Page Headlines (10 headlines max)" },
        ]
      : network === "MediaMavens"
        ? [
            { id: "build-advertorial-heroshots", label: "Create Advertorial Hero Shot Images (10 images max)" },
            { id: "build-advertorial-headlines", label: "Create Advertorial Headlines (10 headlines max)" },
          ]
        : [];

  const creativeTasks: Task[] =
    traffic === "Caterpillar"
      ? [
          { id: "build-ad-headlines", label: "Create Ad Headlines/Descriptions (20 Max)" },
          { id: "build-ad-images", label: "Create Ad Images (10 Max)" },
        ]
      : traffic === "Grasshopper" || traffic === "Crane"
        ? [
            { id: "build-banner-headlines", label: "Create Banner Headlines (20 Max)" },
            { id: "build-banner-images", label: "Create Banner Images (10 Max)" },
            { id: "build-full-banner", label: "Create Full Banner (10 Max)" },
          ]
        : [];

  const constantTasks: Task[] = [
    { id: "build-diytrax-campaign", label: "Set Up Initial DIYTrax™ Campaign" },
    { id: SPLIT_TEST_TASK_ID, label: "Create Split Tests With MetricMover™ & Integrate With DIYTrax™ (25 Variations)" },
    { id: "build-other", label: "Other" },
  ];

  return [...pageTasks, ...creativeTasks, ...constantTasks];
}

function testPhaseTasks(network: string, traffic: string): Task[] {
  const banners = bannerPlural(traffic);
  const pages = pagePlural(network);
  return [
    { id: "test-optimize-campaign", label: `Optimize Campaign ${banners} (1 campaign max)` },
    { id: "test-optimize-page", label: `Optimize ${pages} (1 campaign max)` },
    { id: "test-iterate-banner", label: `Iterate Off Of Promising ${banners} (20 new ${banners.toLowerCase()} max)` },
    { id: "test-iterate-page", label: `Iterate Off Of Promising ${pages} (20 new ${pages.toLowerCase()} max)` },
    { id: "test-other", label: "Other" },
  ];
}

function scalePhaseTasks(traffic: string): Task[] {
  const banners = bannerPlural(traffic);
  return [
    { id: "scale-email-creative", label: "Build Dedicated Email Creative (1 creative max)" },
    { id: "scale-promising-other-sizes", label: `Create Promising ${banners} In Other Sizes` },
    { id: "scale-other", label: "Other" },
  ];
}

// ── File upload (replicated from the Compliance "Submit For Review" form) ──
const FILE_ACCEPT = "image/*,application/pdf,.zip,application/zip";
const MAX_FILES = 100;
const MAX_TOTAL_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB per submission

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

function validateFiles(files: File[]): string | null {
  if (files.length > MAX_FILES) {
    return `Too many files. You can upload at most ${MAX_FILES} files (you selected ${files.length}).`;
  }
  let total = 0;
  for (const f of files) {
    const perFileError = validateTicketAttachment({ fileName: f.name, fileSize: f.size, contentType: f.type });
    if (perFileError) return perFileError;
    total += f.size;
  }
  if (total > MAX_TOTAL_SIZE_BYTES) {
    return `Your files total ${formatBytes(total)}, which exceeds the ${formatBytes(MAX_TOTAL_SIZE_BYTES)} limit.`;
  }
  return null;
}

type AttachmentMeta = {
  objectPath: string;
  fileName: string;
  fileSize: number;
  contentType: string;
};

type UploadStatus = "pending" | "uploading" | "uploaded" | "failed";

type StagedFile = {
  id: string;
  file: File;
  status: UploadStatus;
  meta?: AttachmentMeta;
  error?: string;
};

let stagedFileSeq = 0;
const nextStagedFileId = () => `concierge-staged-${Date.now()}-${stagedFileSeq++}`;

async function uploadFileToStorage(file: File): Promise<AttachmentMeta> {
  let metaRes: Response;
  try {
    metaRes = await fetch(`${API_BASE}/storage/uploads/request-url`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
    });
  } catch {
    throw new Error("Network error — couldn't reach the server. Check your connection and retry.");
  }
  if (!metaRes.ok) {
    throw new Error(`Couldn't prepare the upload (server error ${metaRes.status}). Retry in a moment.`);
  }
  const { uploadURL, objectPath } = await metaRes.json();
  let putRes: Response;
  try {
    putRes = await fetch(uploadURL, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });
  } catch {
    throw new Error("Network error during upload — check your connection and retry.");
  }
  if (!putRes.ok) {
    throw new Error(`Storage rejected the file (error ${putRes.status}). Retry in a moment.`);
  }
  return { objectPath: objectPath as string, fileName: file.name, fileSize: file.size, contentType: file.type };
}

const inputClass =
  "w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/40";

const pillClass = (selected: boolean, mono = false) =>
  `px-3 py-1.5 rounded-lg text-sm border transition-colors ${mono ? "font-mono" : ""} ${
    selected
      ? "bg-primary text-primary-foreground border-primary"
      : "bg-background border-border text-muted-foreground hover:border-foreground/30"
  }`;

const chipClass = (active: boolean) =>
  `px-3 py-1.5 rounded-lg text-sm border transition-colors ${
    active
      ? "bg-foreground text-background border-foreground"
      : "bg-background border-border text-muted-foreground hover:border-foreground/40"
  }`;

type SubmitResult =
  | { kind: "success"; ticketNumber: string; confirmationEmailSent: boolean }
  | { kind: "error"; message: string };

// ── Submissions view (mirrors the Compliance Review landing page) ──
//
// A concierge submission is just a support ticket of category `concierge_task`;
// reuse the generated schema type so the section components stay in lockstep
// with the API.
type ConciergeTicket = Ticket;

// Submissions are filed with subject `Concierge Task — <offer>` (see the
// POST /tickets/concierge route). Strip the prefix so each row leads with the
// offer name the member actually cares about, falling back to the raw subject.
function conciergeOfferLabel(subject: string): string {
  const prefix = "Concierge Task — ";
  return subject.startsWith(prefix) ? subject.slice(prefix.length) : subject;
}

// At-a-glance summary the spec requires on every live row (offer name + task(s)
// + file count). The list endpoint carries none of this, so it's parsed from
// the submission's own intake message, which the POST /tickets/concierge route
// formats with `Selected Task(s): a; b` and `Uploaded Files (N):` lines (see
// artifacts/api-server/src/routes/tickets.ts). The `selectedTasks` payload is
// the human-readable task *labels*, so no slug→label mapping is needed.
type ConciergeSummary = { tasks: string[]; fileCount: number };

const TASKS_LINE_PREFIX = "Selected Task(s):";

function parseConciergeSummary(ticket: {
  messages?: { senderType: string; body: string }[];
  attachments?: unknown[];
} | null | undefined): ConciergeSummary {
  const body =
    (ticket?.messages ?? []).find((m) => m.senderType === "member")?.body ?? "";
  const taskLine = body
    .split("\n")
    .find((l) => l.trim().startsWith(TASKS_LINE_PREFIX));
  const tasksRaw = taskLine ? taskLine.trim().slice(TASKS_LINE_PREFIX.length).trim() : "";
  const tasks =
    tasksRaw && tasksRaw !== "None selected"
      ? tasksRaw
          .split(";")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  // Prefer the structured attachment rows; fall back to the body's
  // `Uploaded Files (N):` header when none are linked (e.g. drive-only shares).
  let fileCount = ticket?.attachments?.length ?? 0;
  if (fileCount === 0) {
    const match = body.match(/Uploaded Files \((\d+)\):/);
    if (match) fileCount = Number(match[1]);
  }

  return { tasks, fileCount };
}

// Renders the parsed task(s) + file-count summary for one row. The detail is
// fetched lazily per row (the list payload lacks messages/attachments); while
// it loads or if it's empty the row still shows its offer + date, so this only
// ever adds information.
function SubmissionSummary({ ticketId }: { ticketId: number }) {
  const { data: ticket } = useGetTicket(ticketId);
  if (!ticket) return null;

  const { tasks, fileCount } = parseConciergeSummary(ticket);
  if (tasks.length === 0 && fileCount === 0) return null;

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-1.5"
      data-testid={`concierge-summary-${ticketId}`}
    >
      {tasks.map((task) => (
        <span
          key={task}
          className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground"
          data-testid={`concierge-summary-task-${ticketId}`}
        >
          {task}
        </span>
      ))}
      {fileCount > 0 && (
        <span
          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
          data-testid={`concierge-summary-files-${ticketId}`}
        >
          <Upload className="w-3 h-3" />
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </span>
      )}
    </div>
  );
}

const conciergeByNewestFirst = (a: ConciergeTicket, b: ConciergeTicket) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

// One row in the "Current Submissions" list. The action is state-aware: a quiet
// "View Request" by default, escalating to a prominent "Action needed" banner +
// "View & Reply" CTA when the Concierge team is waiting on the member (status
// `awaiting_response`). Either way the button opens the existing ticket thread
// page — we never rebuild the conversation UI here.
function CurrentSubmissionRow({ ticket }: { ticket: ConciergeTicket }) {
  const offer = conciergeOfferLabel(ticket.subject);
  const actionNeeded = isAwaitingMember(ticket.status);
  return (
    <Card className="border-border/60" data-testid={`concierge-active-${ticket.id}`} data-status={ticket.status}>
      <CardContent className="p-4 sm:p-5">
        {actionNeeded && (
          <div
            className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
            data-testid={`concierge-action-needed-${ticket.id}`}
          >
            Action needed — the team needs your input
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="warning">{formatMemberSubmissionStatus(ticket.status)}</Badge>
              <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
            </div>
            <h3 className="font-semibold text-foreground truncate">{offer}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Submitted {format(new Date(ticket.createdAt), "MMM d, yyyy")}
            </p>
            <SubmissionSummary ticketId={ticket.id} />
          </div>
          <Link href={`/support/tickets/${ticket.id}`} className="shrink-0">
            <Button
              variant={actionNeeded ? "default" : "outline"}
              size="sm"
              data-testid={`concierge-view-submission-${ticket.id}`}
            >
              {actionNeeded ? "View & Reply" : "View Request"}
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// One row in the "Past Submissions" list. "Complete" covers resolved/closed;
// the team's final reply is revealed in a focused popup via onViewDetails
// rather than sending the member to the full thread.
function PastSubmissionRow({
  ticket,
  onViewDetails,
}: {
  ticket: ConciergeTicket;
  onViewDetails: () => void;
}) {
  const offer = conciergeOfferLabel(ticket.subject);
  return (
    <Card className="border-border/60" data-testid={`concierge-past-${ticket.id}`} data-status={ticket.status}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Complete
              </Badge>
              <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
            </div>
            <h3 className="font-semibold text-foreground truncate">{offer}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Submitted {format(new Date(ticket.createdAt), "MMM d, yyyy")}
            </p>
            <SubmissionSummary ticketId={ticket.id} />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onViewDetails}
            data-testid={`concierge-view-details-${ticket.id}`}
          >
            View Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Body of the "View Details" popup. Fetches the submission's thread on demand
// (mounted only while the dialog is open) and shows every Concierge reply,
// newest first and highlighted. Replies are admin, non-internal messages; a
// submission completed with no written reply gets a graceful fallback instead
// of an empty box.
function ConciergeDetailsBody({ ticketId }: { ticketId: number }) {
  const { data: ticket, isLoading } = useGetTicket(ticketId);

  if (isLoading) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
        Loading the details…
      </div>
    );
  }

  const replies = (ticket?.messages ?? [])
    .filter((m) => m.senderType === "admin" && !(m as { isInternal?: boolean }).isInternal)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (replies.length === 0) {
    return (
      <div
        className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground"
        data-testid="concierge-details-empty"
      >
        No written response was provided for this request.
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto">
      {replies.map((m, i) => (
        <div
          key={m.id}
          className={`rounded-lg border p-4 ${i === 0 ? "border-primary/30 bg-primary/[0.03]" : "border-border bg-muted/20"}`}
          data-testid={`concierge-detail-${m.id}`}
        >
          <div className="flex items-center gap-2 mb-2 text-xs">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="font-medium text-foreground">BTS Concierge™ Team</span>
            {i === 0 && replies.length > 1 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Latest</Badge>
            )}
            <span className="ml-auto text-muted-foreground">
              {format(new Date(m.createdAt), "MMM d, yyyy")}
            </span>
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap">{m.body}</p>
        </div>
      ))}
    </div>
  );
}

// A "Submit a Task" button shared by the section header and the empty state, so
// there's always an obvious path to the intake form below (anchored to #task).
function SubmitTaskButton({ size = "default" }: { size?: "default" | "sm" }) {
  return (
    <a href="#task">
      <Button size={size} className="shadow-lg shadow-primary/20" data-testid="concierge-submit-cta">
        <Send className="w-4 h-4 mr-2" />
        Submit a Task
      </Button>
    </a>
  );
}

// The two status sections that make up the Concierge submissions view,
// mirroring the Compliance Review landing page: "Current Submissions" (active)
// and "Past Submissions" (completed). The sections are always shown — a
// first-time member sees the headings, empty states, and the "Submit a Task"
// call to action.
function ConciergeSubmissions() {
  const { data: tickets, isLoading } = useListTickets();
  const [detailsTicket, setDetailsTicket] = useState<ConciergeTicket | null>(null);

  const concierge = (tickets ?? []).filter((t) => t.category === "concierge_task");
  const active = concierge.filter((t) => isActiveTicketStatus(t.status)).sort(conciergeByNewestFirst);
  const past = concierge
    .filter((t) => t.status === "resolved" || t.status === "closed")
    .sort(conciergeByNewestFirst);

  return (
    <div className="space-y-8" data-testid="concierge-submissions">
      <section>
        <div className="flex items-center justify-between gap-4 border-b border-border pb-3 mb-4">
          <h2 className="text-xl font-bold text-foreground">Current Submissions</h2>
          <SubmitTaskButton size="sm" />
        </div>
        {isLoading ? (
          <div className="animate-pulse h-28 bg-card rounded-xl" />
        ) : active.length > 0 ? (
          <div className="space-y-3">
            {active.map((ticket) => (
              <CurrentSubmissionRow key={ticket.id} ticket={ticket} />
            ))}
          </div>
        ) : (
          <Card data-testid="concierge-active-empty">
            <CardContent className="p-8 text-center">
              <Sparkles className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                No Active Requests
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Hand a task to the Concierge™ team and we'll get to work — most are done within 24–72 hours.
              </p>
              <SubmitTaskButton />
            </CardContent>
          </Card>
        )}
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground border-b border-border pb-3 mb-4">
          Past Submissions
        </h2>
        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-card rounded-xl" />
            ))}
          </div>
        ) : past.length > 0 ? (
          <div className="space-y-3">
            {past.map((ticket) => (
              <PastSubmissionRow
                key={ticket.id}
                ticket={ticket}
                onViewDetails={() => setDetailsTicket(ticket)}
              />
            ))}
          </div>
        ) : (
          <div
            className="rounded-lg border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground"
            data-testid="concierge-past-empty"
          >
            You don't have any completed requests yet.
          </div>
        )}
      </section>

      <Dialog open={!!detailsTicket} onOpenChange={(open) => { if (!open) setDetailsTicket(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {detailsTicket ? `Request Details — ${conciergeOfferLabel(detailsTicket.subject)}` : "Request Details"}
            </DialogTitle>
            <DialogDescription>
              The BTS Concierge™ team's response to your request.
            </DialogDescription>
          </DialogHeader>
          {detailsTicket && <ConciergeDetailsBody ticketId={detailsTicket.id} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConciergeForm() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [network, setNetwork] = useState("");
  const [offerName, setOfferName] = useState("");
  const [offerUrl, setOfferUrl] = useState("");
  const [traffic, setTraffic] = useState("");
  const [phase, setPhase] = useState("");
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [driveLink, setDriveLink] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [otherInfo, setOtherInfo] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  // Inline prerequisite warnings (selection order: Network → Traffic → Phase).
  const [networkWarning, setNetworkWarning] = useState(false);
  const [trafficWarning, setTrafficWarning] = useState(false);

  // Optional "share files with us" disclosure — members open it only if a task
  // needs reference files (split-test assets, existing creative, anything else).
  const [showAttachments, setShowAttachments] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const anyUploading = files.some((sf) => sf.status === "uploading");

  // Wipe any selections that depend on the network/traffic/phase so a member
  // can't submit task/upload/banner-size options that no longer match setup.
  // The optional "share files" section is no longer tied to a specific task, so
  // it survives network/traffic/phase changes — only the setup-dependent
  // task/banner-size selections are cleared.
  const clearDependentSelections = () => {
    setSelectedTasks([]);
    setSelectedSizes([]);
  };

  // Radio-style single-select: clicking switches between options but never
  // deselects back to empty once chosen, so a satisfied prerequisite can't
  // silently go blank and strand a downstream phase/task selection.
  const selectNetwork = (n: string) => {
    if (network === n) return;
    setNetwork(n);
    setNetworkWarning(false);
    clearDependentSelections();
  };

  const selectTraffic = (t: string) => {
    if (!network) {
      setNetworkWarning(true);
      return;
    }
    if (traffic === t) return;
    setTraffic(t);
    setTrafficWarning(false);
    clearDependentSelections();
  };

  const selectPhase = (p: string) => {
    let blocked = false;
    if (!network) {
      setNetworkWarning(true);
      blocked = true;
    }
    if (!traffic) {
      setTrafficWarning(true);
      blocked = true;
    }
    if (blocked) return;
    setPhase(p);
    clearDependentSelections();
  };

  const phaseTasks: Task[] =
    phase === '"Build" Phase'
      ? buildPhaseTasks(network, traffic)
      : phase === '"Test" Phase'
        ? testPhaseTasks(network, traffic)
        : phase === '"Scale" Phase'
          ? scalePhaseTasks(traffic)
          : [];

  const maxTasks = phase === '"Build" Phase' ? 2 : 1;

  const showBannerSizes = selectedTasks.some((id) => BANNER_SIZE_TASK_IDS.includes(id));

  // Sharing files is optional in general, but REQUIRED when the split-test task
  // is selected (we need the assets to build the 25 variations). When required,
  // the section is force-open, can't be removed, and submit is blocked until a
  // Drive link or an uploaded zip is provided.
  const filesRequired = selectedTasks.includes(SPLIT_TEST_TASK_ID);
  const attachmentsOpen = showAttachments || filesRequired;
  const hasSharedFiles = driveLink.trim().length > 0 || files.length > 0;

  const toggleTask = (id: string) => {
    if (selectedTasks.includes(id)) {
      setSelectedTasks(selectedTasks.filter((t) => t !== id));
      // Clear banner sizes when the last size-driving task is unchecked.
      if (BANNER_SIZE_TASK_IDS.includes(id)) {
        const stillHasSizeTask = selectedTasks.some(
          (t) => t !== id && BANNER_SIZE_TASK_IDS.includes(t),
        );
        if (!stillHasSizeTask) setSelectedSizes([]);
      }
    } else if (selectedTasks.length < maxTasks) {
      setSelectedTasks([...selectedTasks, id]);
      // Split tests need assets, so nudge the member by opening the optional
      // file-share section for them — they can still close it if not needed.
      if (id === SPLIT_TEST_TASK_ID) setShowAttachments(true);
    }
  };

  const toggleSize = (size: string) => {
    setSelectedSizes(
      selectedSizes.includes(size) ? selectedSizes.filter((s) => s !== size) : [...selectedSizes, size],
    );
  };

  const removeFile = (fileId: string) => {
    setFiles((prev) => prev.filter((sf) => sf.id !== fileId));
  };

  const handleFilesSelected = (selected: File[]) => {
    const error = validateFiles(selected);
    if (error) {
      setResult({ kind: "error", message: error });
      return;
    }
    setResult(null);
    setFiles(selected.map((file) => ({ id: nextStagedFileId(), file, status: "pending" })));
  };

  const uploadOne = async (target: StagedFile): Promise<StagedFile> => {
    try {
      const meta = await uploadFileToStorage(target.file);
      return { ...target, status: "uploaded", meta, error: undefined };
    } catch (err) {
      return {
        ...target,
        status: "failed",
        error: err instanceof Error ? err.message : `Upload failed for ${target.file.name}`,
      };
    }
  };

  const startUpload = async (target: StagedFile) => {
    setFiles((prev) => prev.map((sf) => (sf.id === target.id ? { ...sf, status: "uploading", error: undefined } : sf)));
    const result = await uploadOne(target);
    setFiles((prev) => prev.map((sf) => (sf.id === target.id ? result : sf)));
  };

  const retryFile = async (fileId: string) => {
    const target = files.find((sf) => sf.id === fileId);
    if (!target || target.status === "uploading") return;
    await startUpload(target);
  };

  const resetForm = () => {
    setResult(null);
    setFirstName(""); setLastName(""); setEmail("");
    setNetwork(""); setOfferName(""); setOfferUrl("");
    setTraffic(""); setPhase("");
    setSelectedTasks([]); setSelectedSizes([]);
    setDriveLink(""); setShareStatus(""); setFiles([]); setShowAttachments(false);
    setOtherInfo(""); setConfirmed(false);
    setNetworkWarning(false); setTrafficWarning(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (filesRequired && !hasSharedFiles) {
      setShowAttachments(true);
      setResult({
        kind: "error",
        message: "Split tests require your assets. Add a Google Drive link or upload a zip file before submitting.",
      });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      let attachments: AttachmentMeta[] = [];

      if (files.length > 0) {
        const fileError = validateFiles(files.map((sf) => sf.file));
        if (fileError) {
          setResult({ kind: "error", message: fileError });
          return;
        }

        const pending = files.filter((sf) => sf.status !== "uploaded");
        let working = files;
        if (pending.length > 0) {
          setFiles((prev) => prev.map((sf) => (sf.status !== "uploaded" ? { ...sf, status: "uploading", error: undefined } : sf)));
          const results = await Promise.all(pending.map(uploadOne));
          const byId = new Map(results.map((r) => [r.id, r]));
          working = files.map((sf) => byId.get(sf.id) ?? sf);
          setFiles(working);
          if (working.some((sf) => sf.status === "failed")) {
            setResult({ kind: "error", message: "Some files didn't upload. Retry or remove them, then submit again." });
            return;
          }
        }

        attachments = working
          .map((sf) => sf.meta)
          .filter((meta): meta is AttachmentMeta => Boolean(meta));
      }

      // Map the selected stable ids back to their display labels so the ticket
      // body reads the same wording the member saw.
      const selectedTaskLabels = phaseTasks
        .filter((t) => selectedTasks.includes(t.id))
        .map((t) => t.label);

      const res = await fetch(`${API_BASE}/tickets/concierge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName, lastName, email,
          network, offerName, offerUrl,
          traffic, phase,
          selectedTasks: selectedTaskLabels,
          selectedSizes: showBannerSizes ? selectedSizes : [],
          driveLink: attachmentsOpen ? driveLink : "",
          shareStatus: attachmentsOpen ? shareStatus : "",
          attachments,
          otherInfo,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = typeof data?.error === "string" ? data.error : "Failed to submit. Please try again.";
        setResult({ kind: "error", message: msg });
        return;
      }
      const data = await res.json();
      setResult({
        kind: "success",
        ticketNumber: data.ticketNumber,
        confirmationEmailSent: data.confirmationEmailSent !== false,
      });
    } catch {
      setResult({ kind: "error", message: "Network error. Please check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  };

  if (result?.kind === "success") {
    return (
      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-emerald-700" />
          </div>
          <h3 className="text-xl font-bold text-foreground">Task Submitted!</h3>
          <p className="text-muted-foreground">
            Your request has been received and logged under reference{" "}
            <span className="font-mono font-semibold text-foreground" data-testid="text-ticket-number">{result.ticketNumber}</span>.
            Our BTS Concierge™ team will get back to you within 24–72 hours.
            {result.confirmationEmailSent ? " Check your email for a confirmation." : ""}
          </p>
          {!result.confirmationEmailSent && (
            <div
              className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 text-left"
              data-testid="alert-confirmation-email-failed"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
              <p>
                Your request was logged successfully, but we couldn't send a confirmation email
                right now. No need to resubmit — note your reference number above, and our team
                will still receive your request.
              </p>
            </div>
          )}
          <Button onClick={resetForm} variant="outline" className="mt-4">
            Submit Another Task
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {result?.kind === "error" && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
          <p>{result.message}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">First Name *</label>
          <input
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClass}
            data-testid="input-first-name"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Last Name *</label>
          <input
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputClass}
            data-testid="input-last-name"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Email *</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          data-testid="input-email"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Affiliate Network *</label>
        <div className="flex flex-wrap items-center gap-2">
          {networkOptions.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => selectNetwork(n)}
              className={pillClass(network === n)}
              data-testid={`pill-network-${n}`}
            >
              {n}
            </button>
          ))}
          {networkWarning && !network && (
            <span className="text-xs text-red-600" data-testid="warning-network">
              Please select an affiliate network first
            </span>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Offer Name *</label>
        <input
          type="text"
          required
          value={offerName}
          onChange={(e) => setOfferName(e.target.value)}
          className={inputClass}
          data-testid="input-offer-name"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Offer URL (exact link to the VSL or Product Sales Page) *</label>
        <input
          type="url"
          required
          value={offerUrl}
          onChange={(e) => setOfferUrl(e.target.value)}
          placeholder="https://"
          className={inputClass}
          data-testid="input-offer-url"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Traffic Source *</label>
        <div className="flex flex-wrap items-center gap-2">
          {trafficSources.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => selectTraffic(t)}
              className={pillClass(traffic === t)}
              data-testid={`pill-traffic-${t}`}
            >
              {t}
            </button>
          ))}
          {trafficWarning && !traffic && (
            <span className="text-xs text-red-600" data-testid="warning-traffic">
              Please select a traffic source first
            </span>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Which Phase Are You On? *</label>
        <div className="flex flex-wrap gap-2">
          {phases.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => selectPhase(p)}
              className={pillClass(phase === p)}
              data-testid={`pill-phase-${p}`}
            >
              {p}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Refer to the Blitz if you are unsure.
        </p>
      </div>

      {phase && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            What tasks would you like us to do? (Max {maxTasks}) *
          </label>
          <div className="space-y-2">
            {phaseTasks.map((task) => (
              <label key={task.id} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedTasks.includes(task.id)}
                  onChange={() => toggleTask(task.id)}
                  className="mt-1 accent-primary"
                  data-testid={`checkbox-task-${task.id}`}
                />
                <span className="text-sm text-muted-foreground">{task.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {!attachmentsOpen ? (
        <button
          type="button"
          onClick={() => setShowAttachments(true)}
          className="inline-flex items-center gap-1.5 text-sm text-primary font-medium hover:underline"
          data-testid="button-add-attachments"
        >
          <Upload className="w-4 h-4" />
          Need to share files with us? Add a Google Drive link or upload a zip (optional)
        </button>
      ) : (
        <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {filesRequired ? "Share your assets (required)" : "Share files with us (optional)"}
            </p>
            {!filesRequired && (
              <button
                type="button"
                onClick={() => {
                  setShowAttachments(false);
                  setDriveLink("");
                  setShareStatus("");
                  setFiles([]);
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Remove file sharing section"
                data-testid="button-remove-attachments"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {filesRequired
              ? "Split tests need your assets so we can build the 25 variations. Please share a Google Drive link or upload a zip file — one of the two is required to submit."
              : "If any task you've selected needs reference files — split-test assets, existing creative, screenshots, or anything else — share a Google Drive link or upload a zip below."}
          </p>
          {filesRequired && !hasSharedFiles && (
            <p
              className="flex items-center gap-1.5 text-xs text-destructive"
              role="alert"
              data-testid="attachments-required-warning"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Add a Google Drive link or upload a zip file to continue.
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Google Drive Link
            </label>
            <p className="text-xs text-muted-foreground mb-1.5">
              If you don't have a Google Drive link, you can upload a zip file below.
            </p>
            <input
              type="url"
              value={driveLink}
              onChange={(e) => setDriveLink(e.target.value)}
              placeholder="https://drive.google.com/..."
              className={inputClass}
              data-testid="input-drive-link"
            />
          </div>

          {driveLink && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Have you shared access with the Concierge Team?
              </label>
              <p className="text-xs text-muted-foreground mb-1.5">
                Failure to share proper access will delay completion of this task.
              </p>
              <div className="flex flex-wrap gap-2">
                {shareOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setShareStatus(opt)}
                    className={chipClass(shareStatus === opt)}
                    data-testid={`chip-share-${opt}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Upload a Zip File</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-foreground/40 transition-colors"
              data-testid="dropzone-files"
            >
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {files.length > 0 ? `${files.length} file(s) selected` : "Drag & drop files or click to browse"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Up to {MAX_FILES} files — {TICKET_ATTACHMENT_ALLOWED_LABEL} — max {TICKET_ATTACHMENT_MAX_LABEL} each
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={FILE_ACCEPT}
              onChange={(e) => handleFilesSelected(Array.from(e.target.files || []))}
              className="hidden"
            />
            {files.length > 0 && (
              <ul className="mt-2 space-y-1" data-testid="concierge-files-list">
                {files.map((sf, i) => (
                  <li
                    key={sf.id}
                    data-testid={`concierge-file-${i}`}
                    data-status={sf.status}
                    className="text-xs bg-muted/40 rounded px-2 py-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-muted-foreground">
                      <span className="truncate max-w-xs">{sf.file.name}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        {sf.status === "uploading" && (
                          <span className="flex items-center gap-1 text-blue-600" data-testid={`concierge-file-status-${i}`}>
                            <Loader2 className="w-3 h-3 animate-spin" /> Uploading…
                          </span>
                        )}
                        {sf.status === "uploaded" && (
                          <span className="flex items-center gap-1 text-green-600" data-testid={`concierge-file-status-${i}`}>
                            <CheckCircle2 className="w-3 h-3" /> Uploaded
                          </span>
                        )}
                        {sf.status === "failed" && (
                          <>
                            <span
                              className="flex items-center gap-1 text-destructive"
                              data-testid={`concierge-file-status-${i}`}
                            >
                              <AlertTriangle className="w-3 h-3" /> Failed
                            </span>
                            <button
                              type="button"
                              onClick={() => retryFile(sf.id)}
                              disabled={anyUploading}
                              className="flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
                              data-testid={`concierge-file-retry-${i}`}
                            >
                              <RotateCw className="w-3 h-3" /> Retry
                            </button>
                          </>
                        )}
                        {sf.status !== "uploading" && (
                          <button
                            type="button"
                            onClick={() => removeFile(sf.id)}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Remove ${sf.file.name}`}
                            data-testid={`concierge-file-remove-${i}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </span>
                    </div>
                    {sf.status === "failed" && sf.error && (
                      <p
                        className="mt-1 text-destructive"
                        role="alert"
                        data-testid={`concierge-file-error-${i}`}
                      >
                        <span className="sr-only">Upload failed: </span>
                        {sf.error}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {showBannerSizes && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Banner Sizes Needed</label>
          <div className="flex flex-wrap gap-2">
            {bannerSizes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleSize(s)}
                className={pillClass(selectedSizes.includes(s), true)}
                data-testid={`pill-size-${s}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Any Other Info We Might Need?</label>
        <textarea
          rows={4}
          value={otherInfo}
          onChange={(e) => setOtherInfo(e.target.value)}
          placeholder="Please be as specific and detailed as possible..."
          className={`${inputClass} resize-none`}
        />
      </div>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1 accent-primary"
          required
          data-testid="checkbox-confirm"
        />
        <span className="text-sm text-muted-foreground">
          I understand that most tasks are completed within 24 hours, but some may take up to 72 hours. *
        </span>
      </label>

      <Button type="submit" className="gap-2 w-full sm:w-auto" isLoading={submitting} disabled={submitting} data-testid="button-submit">
        <Send className="w-4 h-4" />
        Submit Your Task
      </Button>
    </form>
  );
}

export default function Concierge() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">The BTS Concierge™</h1>
          </div>
          <p className="text-muted-foreground">
            Skilled specialists ready to take the technical setup off your plate — connecting your tools, configuring your software, and building the ad creatives to get your campaigns live.
          </p>
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-4 space-y-1.5">
          <p className="text-sm font-semibold text-foreground">How it works</p>
          <p className="text-sm text-muted-foreground">
            Submit a task below and a specialist picks it up — no back-and-forth, no learning curve. You'll get finished, ready-to-use work delivered straight to you, usually within 24–72 hours. Keep moving while we handle the heavy lifting.
          </p>
          <p className="text-sm text-muted-foreground">
            <em>
              Prefer to be walked through something live instead?{" "}
              <Link href="/va-calls" className="text-primary font-medium hover:underline">
                Book a 1-on-1 VA Call
              </Link>
              .
            </em>
          </p>
        </div>

        <ConciergeSubmissions />

        <section id="task">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-5 sm:p-8 md:p-10 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg border border-border/60 bg-muted flex items-center justify-center">
                  <ClipboardList className="w-5 h-5 text-foreground" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Submit A Task For The Concierge™</h2>
                  <p className="text-sm text-muted-foreground">
                    Fill out the form below and let us know how we can assist. Turnaround time: 24-72 hours.
                  </p>
                </div>
              </div>
              <ConciergeForm />
            </CardContent>
          </Card>
        </section>
      </div>
    </AppLayout>
  );
}
