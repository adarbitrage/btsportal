import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, CheckCircle2, Send, Upload, AlertCircle,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useListTickets, useGetTicket, getGetTicketQueryKey } from "@workspace/api-client-react";
import type { Ticket } from "@workspace/api-client-react";
import { ConversationModal } from "@/components/support/ConversationModal";
import {
  isActiveTicketStatus,
  isAwaitingMember,
} from "@workspace/support-config";
import {
  usePreviewEnabled,
  getPreviewConciergeTickets,
  getPreviewTicketDetail,
} from "@/lib/supportPreview";

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
  const preview = getPreviewTicketDetail(ticketId);
  const { data } = useGetTicket(ticketId, {
    query: { enabled: preview == null, queryKey: getGetTicketQueryKey(ticketId) },
  });
  const ticket = preview ?? data;
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

// One row in the "Current Submissions" list. Badge + button escalate with
// urgency: when the Concierge team is waiting on the member (`awaiting_response`)
// the row shows a loud amber "Action Needed" badge and a solid "View & Respond"
// button linking to the full ticket page (read + reply + upload). Otherwise it
// shows a calm "In Progress" badge and an outlined "View Conversation" button
// that opens the read-only conversation modal in place.
function CurrentSubmissionRow({
  ticket,
  onViewConversation,
}: {
  ticket: ConciergeTicket;
  onViewConversation: () => void;
}) {
  const offer = conciergeOfferLabel(ticket.subject);
  const actionNeeded = isAwaitingMember(ticket.status);
  return (
    <Card className="border-border/60" data-testid={`concierge-active-${ticket.id}`} data-status={ticket.status}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {actionNeeded ? (
                <Badge variant="warning" className="gap-1" data-testid={`concierge-action-needed-${ticket.id}`}>
                  <AlertCircle className="w-3 h-3" />
                  Action Needed
                </Badge>
              ) : (
                <Badge variant="secondary">In Progress</Badge>
              )}
              <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
            </div>
            <h3 className="font-semibold text-foreground truncate">{offer}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Submitted {format(new Date(ticket.createdAt), "MMM d, yyyy")}
            </p>
            <SubmissionSummary ticketId={ticket.id} />
          </div>
          {actionNeeded ? (
            <Link href={`/support/tickets/${ticket.id}`} className="shrink-0">
              <Button variant="default" size="sm" data-testid={`concierge-respond-${ticket.id}`}>
                View &amp; Respond
              </Button>
            </Link>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={onViewConversation}
              data-testid={`concierge-view-conversation-${ticket.id}`}
            >
              View Conversation
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// One row in the "Past Submissions" list — always "Completed" (resolved or
// closed). The quiet ghost "View Conversation" button opens the same read-only
// conversation modal in place.
function PastSubmissionRow({
  ticket,
  onViewConversation,
}: {
  ticket: ConciergeTicket;
  onViewConversation: () => void;
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
                Completed
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
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onViewConversation}
            data-testid={`concierge-view-conversation-${ticket.id}`}
          >
            View Conversation
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// A "Submit a Task" button shared by the section header and the empty state, so
// there's always an obvious path to the intake form. Routes to the dedicated
// /concierge/submit page (mirrors how Compliance Review routes to
// /compliance/submit), so the form lives on its own page.
function SubmitTaskButton({ size = "default" }: { size?: "default" | "sm" }) {
  return (
    <Link href="/concierge/submit">
      <Button size={size} className="shadow-lg shadow-primary/20" data-testid="concierge-submit-cta">
        <Send className="w-4 h-4 mr-2" />
        Submit a Task
      </Button>
    </Link>
  );
}

// The two status sections that make up the Concierge submissions view,
// mirroring the Compliance Review landing page: "Current Submissions" (active)
// and "Past Submissions" (completed). The sections are always shown — a
// first-time member sees the headings, empty states, and the "Submit a Task"
// call to action.
function ConciergeSubmissions() {
  const { data: tickets, isLoading } = useListTickets();
  const previewEnabled = usePreviewEnabled();
  const [conversationTicket, setConversationTicket] = useState<ConciergeTicket | null>(null);

  // TEMPORARY: the designated preview account sees fake submission cards so the
  // card UI can be designed before the live API is wired (see lib/supportPreview).
  const allTickets = previewEnabled
    ? [...getPreviewConciergeTickets(), ...(tickets ?? [])]
    : tickets ?? [];
  const concierge = allTickets.filter((t) => t.category === "concierge_task");
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
              <CurrentSubmissionRow
                key={ticket.id}
                ticket={ticket}
                onViewConversation={() => setConversationTicket(ticket)}
              />
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
                onViewConversation={() => setConversationTicket(ticket)}
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

      <ConversationModal
        ticketId={conversationTicket?.id ?? null}
        title={
          conversationTicket
            ? `Conversation — ${conciergeOfferLabel(conversationTicket.subject)}`
            : "Conversation"
        }
        teamLabel="BTS Concierge™ Team"
        teamIcon={<Sparkles className="w-3.5 h-3.5 text-primary" />}
        onClose={() => setConversationTicket(null)}
      />
    </div>
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
      </div>
    </AppLayout>
  );
}
