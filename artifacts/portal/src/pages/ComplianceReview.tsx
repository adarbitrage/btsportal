import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, CheckCircle2, Send, AlertCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useListTickets } from "@workspace/api-client-react";
import type { Ticket } from "@workspace/api-client-react";
import { ConversationModal } from "@/components/support/ConversationModal";
import { isActiveTicketStatus, isAwaitingMember } from "@workspace/support-config";

// A compliance submission is just a support ticket of category
// `compliance_review`; reuse the generated schema type so the section
// components stay in lockstep with the API.
type ComplianceTicket = Ticket;

// Submissions are filed with subject `Compliance Review — <offer>` (see the
// POST /tickets/compliance route). Strip the prefix so each row leads with the
// offer name the member actually cares about, falling back to the raw subject.
function complianceOfferLabel(subject: string): string {
  const prefix = "Compliance Review — ";
  return subject.startsWith(prefix) ? subject.slice(prefix.length) : subject;
}

const byNewestFirst = (a: ComplianceTicket, b: ComplianceTicket) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

// One row in the "Current Submissions" list. Badge + button escalate with
// urgency: when the compliance team is waiting on the member
// (`awaiting_response`) the row shows a loud amber "Action Needed" badge and a
// solid "View & Respond" button linking to the full ticket page (read + reply +
// upload). Otherwise it shows a calm "Under Review" badge and an outlined "View
// Conversation" button that opens the read-only conversation modal in place.
function CurrentSubmissionRow({
  ticket,
  onViewConversation,
}: {
  ticket: ComplianceTicket;
  onViewConversation: () => void;
}) {
  const offer = complianceOfferLabel(ticket.subject);
  const actionNeeded = isAwaitingMember(ticket.status);
  return (
    <Card className="border-border/60" data-testid={`compliance-active-${ticket.id}`} data-status={ticket.status}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {actionNeeded ? (
                <Badge variant="warning" className="gap-1" data-testid={`compliance-action-needed-${ticket.id}`}>
                  <AlertCircle className="w-3 h-3" />
                  Action Needed
                </Badge>
              ) : (
                <Badge variant="secondary">Under Review</Badge>
              )}
              <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
            </div>
            <h3 className="font-semibold text-foreground truncate">{offer}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Submitted {format(new Date(ticket.createdAt), "MMM d, yyyy")}
            </p>
          </div>
          {actionNeeded ? (
            <Link href={`/support/tickets/${ticket.id}`} className="shrink-0">
              <Button variant="default" size="sm" data-testid={`compliance-respond-${ticket.id}`}>
                View &amp; Respond
              </Button>
            </Link>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={onViewConversation}
              data-testid={`compliance-view-conversation-${ticket.id}`}
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
  ticket: ComplianceTicket;
  onViewConversation: () => void;
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
                Completed
              </Badge>
              <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
            </div>
            <h3 className="font-semibold text-foreground truncate">{offer}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Submitted {format(new Date(ticket.createdAt), "MMM d, yyyy")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onViewConversation}
            data-testid={`compliance-view-conversation-${ticket.id}`}
          >
            View Conversation
          </Button>
        </div>
      </CardContent>
    </Card>
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
  const [conversationTicket, setConversationTicket] = useState<ComplianceTicket | null>(null);

  const compliance = (tickets ?? []).filter((t) => t.category === "compliance_review");
  const active = compliance.filter((t) => isActiveTicketStatus(t.status)).sort(byNewestFirst);
  const past = compliance
    .filter((t) => t.status === "resolved" || t.status === "closed")
    .sort(byNewestFirst);

  return (
    <div className="space-y-8" data-testid="compliance-submissions">
      <section>
        <div className="flex items-center justify-between gap-4 border-b border-border pb-3 mb-4">
          <h2 className="text-xl font-bold text-foreground">Current Submissions</h2>
          <SubmitForReviewButton size="sm" />
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
          <Card data-testid="compliance-active-empty">
            <CardContent className="p-8 text-center">
              <ShieldCheck className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                No Current Submissions
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
                onViewConversation={() => setConversationTicket(ticket)}
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

      <ConversationModal
        ticketId={conversationTicket?.id ?? null}
        title={
          conversationTicket
            ? `Conversation — ${complianceOfferLabel(conversationTicket.subject)}`
            : "Conversation"
        }
        teamLabel="Compliance Team"
        teamIcon={<ShieldCheck className="w-3.5 h-3.5 text-primary" />}
        onClose={() => setConversationTicket(null)}
      />
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
