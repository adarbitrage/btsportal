import { useState } from "react";
import { useGetTicket, useAddTicketMessage, useResolveTicket, getGetTicketQueryKey, getListTicketsQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Link, useParams } from "wouter";
import { ArrowLeft, User, ShieldAlert, Send, Bot, Info, CheckCircle2, Clock, AlertTriangle, Paperclip, Download } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { SatisfactionSurvey } from "@/components/support/SatisfactionSurvey";
import { getTopicPresetForSubject, formatTicketCategory } from "@/lib/support-topics";

export default function TicketDetail() {
  const { id } = useParams();
  const ticketId = parseInt(id || "1", 10);
  const { data: ticket, isLoading } = useGetTicket(ticketId);
  const addMessage = useAddTicketMessage();
  const resolveTicket = useResolveTicket();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const [resolving, setResolving] = useState(false);

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

  const handleMarkResolved = () => {
    if (resolving) return;
    if (!window.confirm("Mark this ticket as resolved? You can still reply to re-open it.")) return;
    setResolving(true);
    resolveTicket.mutate({ id: ticketId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) });
        queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
      },
      onSettled: () => {
        setResolving(false);
      },
    });
  };

  const visibleMessages = ticket.messages.filter((msg: any) => !msg.isInternal);

  const topicPreset = getTopicPresetForSubject(ticket.subject);
  const isResolved = ticket.status === "resolved" || ticket.status === "closed";
  const isActive = !isResolved;

  const deliveryStatus = ticket.deliveryStatus;
  const isDelivered = deliveryStatus === "delivered";
  const isDeliveryFailed = deliveryStatus === "failed";

  const statusBadgeVariant = () => {
    if (ticket.status === "resolved" || ticket.status === "closed") return "success";
    if (ticket.status === "open" || ticket.status === "in_progress") return "warning";
    return "secondary";
  };

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
                <span>{formatTicketCategory(ticket.category)}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <Badge variant={statusBadgeVariant()} className="text-sm px-3 py-1 gap-1.5">
                {isResolved && <CheckCircle2 className="w-3.5 h-3.5" />}
                {ticket.status.replace('_', ' ')}
              </Badge>
              <div data-testid="ticket-delivery-badge">
                {isDelivered ? (
                  <Badge variant="outline" className="gap-1 border-green-500 bg-green-50 text-green-700">
                    <CheckCircle2 className="w-3 h-3" /> Delivered to support team
                  </Badge>
                ) : isDeliveryFailed ? (
                  <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-900">
                    <AlertTriangle className="w-3 h-3" /> Team notified by email
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-blue-200 bg-blue-50 text-blue-700">
                    <Clock className="w-3 h-3" /> Delivering to support team
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {isActive && (
            <div className="mt-4 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800 hover:border-green-400"
                onClick={handleMarkResolved}
                disabled={resolving}
                data-testid="mark-resolved-btn"
              >
                <CheckCircle2 className="w-4 h-4" />
                {resolving ? "Resolving..." : "Mark this issue resolved"}
              </Button>
            </div>
          )}

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
          {isDeliveryFailed && (
            <div
              role="status"
              data-testid="ticket-delivery-failed-notice"
              className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
              <p>
                We couldn't deliver this ticket to our support queue automatically, but
                don't worry — the team was notified by email and will follow up with you
                here. You can keep replying below; no need to resubmit.
              </p>
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

        {ticket.attachments && ticket.attachments.length > 0 && (
          <Card data-testid="ticket-attachments-card">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Paperclip className="w-4 h-4 text-muted-foreground" />
                <h2 className="font-bold text-foreground">Attachments</h2>
                <span className="text-xs font-normal text-muted-foreground">({ticket.attachments.length})</span>
              </div>
              <ul className="space-y-2" data-testid="ticket-attachments-list">
                {ticket.attachments.map((att: any) => {
                  const fileName = att.fileName ?? `attachment-${att.id}`;
                  const downloadUrl = `${import.meta.env.BASE_URL}api/tickets/${ticketId}/attachments/${att.id}/download`;
                  const sizeLabel = att.fileSize != null
                    ? att.fileSize < 1024 * 1024
                      ? `${Math.round(att.fileSize / 1024)} KB`
                      : `${(att.fileSize / (1024 * 1024)).toFixed(1)} MB`
                    : null;
                  return (
                    <li key={att.id} className="flex items-center justify-between gap-3 text-sm rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Paperclip className="w-4 h-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-foreground font-medium" title={fileName}>{fileName}</span>
                        {sizeLabel && <span className="text-xs text-muted-foreground shrink-0">{sizeLabel}</span>}
                      </div>
                      <a
                        href={downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                        data-testid={`attachment-download-${att.id}`}
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </a>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

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
