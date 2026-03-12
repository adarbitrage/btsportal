import { useParams, useSearch } from "wouter";
import { useGetTicket } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { SatisfactionSurvey } from "@/components/support/SatisfactionSurvey";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function SatisfactionSurveyPage() {
  const { id } = useParams();
  const ticketId = parseInt(id || "0", 10);
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const initialRating = parseInt(params.get("rating") || "0", 10) || undefined;
  const { data: ticket, isLoading } = useGetTicket(ticketId);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="animate-pulse h-96 bg-card rounded-xl max-w-2xl mx-auto" />
      </AppLayout>
    );
  }

  if (!ticket) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto text-center py-16">
          <h1 className="text-2xl font-bold text-foreground mb-2">Ticket Not Found</h1>
          <p className="text-muted-foreground mb-6">
            The ticket you're looking for doesn't exist or you don't have access to it.
          </p>
          <Link href="/support">
            <Button variant="outline">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Support
            </Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const isResolved = ticket.status === "resolved" || ticket.status === "closed";

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <Link href={`/support/tickets/${ticketId}`}>
          <Button variant="ghost" className="pl-0 hover:bg-transparent hover:text-primary -ml-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Ticket
          </Button>
        </Link>

        <div className="text-center mb-4">
          <h1 className="text-2xl font-bold text-foreground mb-2">Rate Your Experience</h1>
          <p className="text-muted-foreground">
            Ticket <span className="font-mono bg-secondary px-2 py-0.5 rounded text-sm">{ticket.ticketNumber}</span> — {ticket.subject}
          </p>
        </div>

        {isResolved ? (
          <SatisfactionSurvey ticketId={ticketId} initialRating={initialRating} />
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">
              This survey is available once the ticket has been resolved.
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
