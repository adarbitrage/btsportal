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
import { ShieldCheck, CheckCircle2, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useListTickets, useGetTicket } from "@workspace/api-client-react";
import type { Ticket } from "@workspace/api-client-react";

// A compliance submission is just a support ticket of category
// `compliance_review`; reuse the generated schema type so the section
// components stay in lockstep with the API.
type ComplianceTicket = Ticket;

const ACTIVE_COMPLIANCE_STATUSES = new Set(["open", "in_progress", "awaiting_response"]);

// Submissions are filed with subject `Compliance Review — <offer>` (see the
// POST /tickets/compliance route). Strip the prefix so each row leads with the
// offer name the member actually cares about, falling back to the raw subject.
function complianceOfferLabel(subject: string): string {
  const prefix = "Compliance Review — ";
  return subject.startsWith(prefix) ? subject.slice(prefix.length) : subject;
}

const byNewestFirst = (a: ComplianceTicket, b: ComplianceTicket) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

// One row in the "Currently Under Review" list. The action is state-aware: a
// quiet "View Submission" by default, escalating to a prominent
// "Action needed — reply requested" banner + "View & Reply" CTA when the
// compliance team is waiting on the member (status `awaiting_response`). Either
// way the button opens the existing ticket thread page — we never rebuild the
// conversation UI here.
function UnderReviewRow({ ticket }: { ticket: ComplianceTicket }) {
  const offer = complianceOfferLabel(ticket.subject);
  const actionNeeded = ticket.status === "awaiting_response";
  return (
    <Card className="border-border/60" data-testid={`compliance-active-${ticket.id}`} data-status={ticket.status}>
      <CardContent className="p-4 sm:p-5">
        {actionNeeded && (
          <div
            className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
            data-testid={`compliance-action-needed-${ticket.id}`}
          >
            Action needed — reply requested
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="warning">Under review</Badge>
              <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
            </div>
            <h3 className="font-semibold text-foreground truncate">{offer}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Submitted {format(new Date(ticket.createdAt), "MMM d, yyyy")}
            </p>
          </div>
          <Link href={`/support/tickets/${ticket.id}`} className="shrink-0">
            <Button
              variant={actionNeeded ? "default" : "outline"}
              size="sm"
              data-testid={`compliance-view-submission-${ticket.id}`}
            >
              {actionNeeded ? "View & Reply" : "View Submission"}
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// One row in the "Past Submissions" list. "Complete" covers resolved/closed;
// the reviewer's verdict is revealed in a focused popup via onViewResults
// rather than sending the member to the full thread.
function PastSubmissionRow({
  ticket,
  onViewResults,
}: {
  ticket: ComplianceTicket;
  onViewResults: () => void;
}) {
  const offer = complianceOfferLabel(ticket.subject);
  return (
    <Card className="border-border/60" data-testid={`compliance-past-${ticket.id}`} data-status={ticket.status}>
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
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onViewResults}
            data-testid={`compliance-view-results-${ticket.id}`}
          >
            View Results
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Body of the "View Results" popup. Fetches the submission's thread on demand
// (mounted only while the dialog is open) and shows every reviewer reply,
// newest first and highlighted. Reviewer replies are admin, non-internal
// messages; a submission completed with no written reply gets a graceful
// fallback instead of an empty box.
function ComplianceResultsBody({ ticketId }: { ticketId: number }) {
  const { data: ticket, isLoading } = useGetTicket(ticketId);

  if (isLoading) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
        Loading the review…
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
        data-testid="compliance-results-empty"
      >
        No written response was provided for this submission.
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto">
      {replies.map((m, i) => (
        <div
          key={m.id}
          className={`rounded-lg border p-4 ${i === 0 ? "border-primary/30 bg-primary/[0.03]" : "border-border bg-muted/20"}`}
          data-testid={`compliance-result-${m.id}`}
        >
          <div className="flex items-center gap-2 mb-2 text-xs">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
            <span className="font-medium text-foreground">Compliance Team</span>
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

// The "Submit for Review" button shared by the section header and the empty
// state, so there's always an obvious path to the intake form.
function SubmitForReviewButton({ size = "default" }: { size?: "default" | "sm" }) {
  return (
    <Link href="/compliance/submit">
      <Button size={size} className="shadow-lg shadow-primary/20" data-testid="compliance-submit-cta">
        <Send className="w-4 h-4 mr-2" />
        Submit for Review
      </Button>
    </Link>
  );
}

// The two status sections that make up the Compliance Review landing page,
// mirroring the Private Coaching (Session Booking) layout: "Currently Under
// Review" (active submissions) and "Past Submissions" (completed). The sections
// are always shown — a first-time member sees the headings, empty states, and
// the "Submit for Review" call to action.
function ComplianceSubmissions() {
  const { data: tickets, isLoading } = useListTickets();
  const [resultsTicket, setResultsTicket] = useState<ComplianceTicket | null>(null);

  const compliance = (tickets ?? []).filter((t) => t.category === "compliance_review");
  const active = compliance.filter((t) => ACTIVE_COMPLIANCE_STATUSES.has(t.status)).sort(byNewestFirst);
  const past = compliance
    .filter((t) => t.status === "resolved" || t.status === "closed")
    .sort(byNewestFirst);

  return (
    <div className="space-y-8" data-testid="compliance-submissions">
      <section>
        <div className="flex items-center justify-between gap-4 border-b border-border pb-3 mb-4">
          <h2 className="text-xl font-bold text-foreground">Currently Under Review</h2>
          <SubmitForReviewButton size="sm" />
        </div>
        {isLoading ? (
          <div className="animate-pulse h-28 bg-card rounded-xl" />
        ) : active.length > 0 ? (
          <div className="space-y-3">
            {active.map((ticket) => (
              <UnderReviewRow key={ticket.id} ticket={ticket} />
            ))}
          </div>
        ) : (
          <Card data-testid="compliance-active-empty">
            <CardContent className="p-8 text-center">
              <ShieldCheck className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Nothing Under Review
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Submit a creative for compliance review before running it on any traffic source.
              </p>
              <SubmitForReviewButton />
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
                onViewResults={() => setResultsTicket(ticket)}
              />
            ))}
          </div>
        ) : (
          <div
            className="rounded-lg border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground"
            data-testid="compliance-past-empty"
          >
            You don't have any completed submissions yet.
          </div>
        )}
      </section>

      <Dialog open={!!resultsTicket} onOpenChange={(open) => { if (!open) setResultsTicket(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {resultsTicket ? `Review Results — ${complianceOfferLabel(resultsTicket.subject)}` : "Review Results"}
            </DialogTitle>
            <DialogDescription>
              The compliance team's response to your submission.
            </DialogDescription>
          </DialogHeader>
          {resultsTicket && <ComplianceResultsBody ticketId={resultsTicket.id} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// The Compliance Review landing page. Shows the member's submissions split into
// "Currently Under Review" and "Past Submissions", with a "Submit for Review"
// button that routes to the intake form at /compliance/submit.
export default function ComplianceReview() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Compliance Review</h1>
          </div>
          <p className="text-muted-foreground">
            Submit your creative for review before running it on any traffic source. We'll
            review each submission within 24 hours — track its status below.
          </p>
        </div>

        <ComplianceSubmissions />
      </div>
    </AppLayout>
  );
}
