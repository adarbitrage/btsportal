import { useState } from "react";
import { useGetTicket, useAddTicketMessage, getGetTicketQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Link, useParams } from "wouter";
import { ArrowLeft, User, ShieldAlert, Send } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

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
        </div>

        <div className="space-y-4">
          {ticket.messages.map((msg) => (
            <Card key={msg.id} className={msg.senderType === 'admin' ? 'border-primary/20 bg-primary/[0.02]' : ''}>
              <CardContent className="p-6">
                <div className="flex gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${msg.senderType === 'admin' ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground'}`}>
                    {msg.senderType === 'admin' ? <ShieldAlert className="w-5 h-5" /> : <User className="w-5 h-5" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-bold text-foreground capitalize">{msg.senderType === 'admin' ? 'Support Team' : 'You'}</span>
                      <span className="text-xs text-muted-foreground">{format(new Date(msg.createdAt), 'MMM d, h:mm a')}</span>
                    </div>
                    <div className="text-foreground whitespace-pre-wrap leading-relaxed text-sm">
                      {msg.body}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {ticket.status !== 'closed' && (
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
