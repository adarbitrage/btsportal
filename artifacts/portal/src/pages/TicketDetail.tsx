import { useState } from "react";
import { useGetTicket, useAddTicketMessage, getGetTicketQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Link, useParams } from "wouter";
import { ArrowLeft, User, ShieldAlert, Send, Bot, Info } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { SatisfactionSurvey } from "@/components/support/SatisfactionSurvey";
import { getTopicPresetForSubject } from "@/lib/support-topics";

export default function TicketDetail() {
  const { id } = useParams();
  const ticketId = parseInt(id || "1", 10);
  const { data: ticket, isLoading } = useGetTicket(ticketId);
  const addMessage = useAddTicketMessage();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");

  if (isLoading) return <AppLayout><div className="animate-pulse h-96 bg-card rounded-xl" /></AppLayout>;
  if (!ticket) return <AppLayout><div>Ticket not found</div></AppLayout>;

  const handleReply = () => {
    if (!reply.trim()) return;
    addMessage.mutate({ id: ticketId, data: { body: reply } }, {
      onSuccess: () => {
        setReply("");
        queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) });
      }
    });
  };

  const visibleMessages = ticket.messages.filter((msg: any) => !msg.isInternal);

  const topicPreset = getTopicPresetForSubject(ticket.subject);
  const isResolved = ticket.status === "resolved" || ticket.status === "closed";

  const isSystemMessage = (body: string) => {
    const systemPatterns = [
      /^this ticket has been automatically closed/i,
      /^your ticket has been automatically closed/i,
      /^was your issue fully resolved/i,
      /^this ticket was auto-closed/i,
    ];
    return systemPatterns.some((pattern) => pattern.test(body.trim()));
  };

  const getMessageStyle = (msg: any) => {
    if (isSystemMessage(msg.body)) {
      return {
        cardClass: "border-amber-200/50 bg-amber-50/30",
        iconBg: "bg-amber-100 text-amber-600",
        icon: <Bot className="w-5 h-5" />,
        label: "System",
      };
    }
    if (msg.senderType === "admin") {
      return {
        cardClass: "border-primary/20 bg-primary/[0.02]",
        iconBg: "bg-primary text-white",
        icon: <ShieldAlert className="w-5 h-5" />,
        label: "Support Team",
      };
    }
    return {
      cardClass: "",
      iconBg: "bg-secondary text-muted-foreground",
      icon: <User className="w-5 h-5" />,
      label: "You",
    };
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <Link href="/support">
          <Button variant="ghost" className="pl-0 hover:bg-transparent hover:text-primary -ml-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Tickets
          </Button>
        </Link>

        <div className="bg-white p-6 md:p-8 rounded-xl border border-border shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground mb-2">{ticket.subject}</h1>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="font-mono bg-secondary px-2 py-0.5 rounded">{ticket.ticketNumber}</span>
                <span>•</span>
                <span>Created {format(new Date(ticket.createdAt), 'MMM d, yyyy')}</span>
                <span>•</span>
                <span className="capitalize">{ticket.category}</span>
              </div>
            </div>
            <Badge variant={ticket.status === 'open' ? 'warning' : 'default'} className="text-sm px-3 py-1">
              {ticket.status.replace('_', ' ')}
            </Badge>
          </div>
          {topicPreset && (
            <div
              role="status"
              data-testid="ticket-topic-notice"
              className="mt-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
            >
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-600" />
              <p>{topicPreset.notice}</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {visibleMessages.map((msg: any) => {
            const style = getMessageStyle(msg);
            return (
              <Card key={msg.id} className={style.cardClass}>
                <CardContent className="p-6">
                  <div className="flex gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${style.iconBg}`}>
                      {style.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-bold text-foreground capitalize">{style.label}</span>
                        <span className="text-xs text-muted-foreground">{format(new Date(msg.createdAt), 'MMM d, h:mm a')}</span>
                      </div>
                      <div className="text-foreground whitespace-pre-wrap leading-relaxed text-sm">
                        {msg.body}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {isResolved && (
          <SatisfactionSurvey ticketId={ticketId} />
        )}

        {ticket.status !== 'closed' && ticket.status !== 'resolved' && (
          <Card className="mt-8 overflow-hidden border-border focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all">
            <textarea 
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              className="w-full p-4 border-none outline-none resize-none bg-transparent min-h-[120px]" 
              placeholder="Type your reply here..."
            />
            <div className="bg-secondary/50 p-3 border-t border-border flex justify-end">
              <Button onClick={handleReply} disabled={!reply.trim() || addMessage.isPending}>
                <Send className="w-4 h-4 mr-2" /> Send Reply
              </Button>
            </div>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
