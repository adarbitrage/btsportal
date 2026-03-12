import { useState } from "react";
import { useListTickets, useCreateTicket, getListTicketsQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Link } from "wouter";
import { PlusCircle, Search, MessageCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";

const ticketSchema = z.object({
  category: z.enum(["billing", "technical", "training", "account", "other"]),
  subject: z.string().min(5),
  description: z.string().min(10)
});

export default function Support() {
  const [isCreating, setIsCreating] = useState(false);
  const { data: tickets, isLoading } = useListTickets();
  const createTicket = useCreateTicket();
  const queryClient = useQueryClient();

  const form = useForm<z.infer<typeof ticketSchema>>({
    resolver: zodResolver(ticketSchema),
    defaultValues: { category: "technical", subject: "", description: "" }
  });

  const onSubmit = (data: z.infer<typeof ticketSchema>) => {
    createTicket.mutate({ data }, {
      onSuccess: () => {
        setIsCreating(false);
        form.reset();
        queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
      }
    });
  };

  const statusColors: Record<string, string> = {
    open: "warning",
    in_progress: "warning",
    awaiting_response: "secondary",
    resolved: "success",
    closed: "default"
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Support Center</h1>
            <p className="text-muted-foreground">We're here to help you succeed.</p>
          </div>
          <Button onClick={() => setIsCreating(true)} className="shadow-md">
            <PlusCircle className="w-4 h-4 mr-2" /> New Ticket
          </Button>
        </div>

        {isCreating && (
          <Card className="border-primary/50 shadow-lg mb-8">
            <div className="bg-primary/5 p-4 border-b border-border font-bold text-foreground">
              Create New Support Ticket
            </div>
            <CardContent className="p-6">
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <select {...form.register("category")} className="w-full p-2 border rounded-md bg-white">
                    <option value="technical">Technical Support</option>
                    <option value="billing">Billing Inquiry</option>
                    <option value="training">Training Content</option>
                    <option value="account">Account Issue</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Subject</label>
                  <input {...form.register("subject")} className="w-full p-2 border rounded-md bg-white" placeholder="Brief summary of your issue" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea {...form.register("description")} rows={4} className="w-full p-2 border rounded-md bg-white" placeholder="Please provide details..."></textarea>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="ghost" onClick={() => setIsCreating(false)}>Cancel</Button>
                  <Button type="submit" isLoading={createTicket.isPending}>Submit Ticket</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <div className="p-4 border-b border-border flex gap-4 items-center bg-secondary/20">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input type="text" placeholder="Search tickets..." className="w-full pl-9 pr-4 py-2 text-sm border rounded-md bg-white" />
            </div>
          </div>
          <div className="divide-y divide-border">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading tickets...</div>
            ) : tickets?.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No support tickets yet.</p>
              </div>
            ) : (
              tickets?.map(ticket => (
                <Link key={ticket.id} href={`/support/tickets/${ticket.id}`}>
                  <div className="p-5 hover:bg-secondary/30 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 group">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
                        <Badge variant={statusColors[ticket.status] as any}>{ticket.status.replace('_', ' ')}</Badge>
                        <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground bg-secondary px-2 py-0.5 rounded">{ticket.category}</span>
                      </div>
                      <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors">{ticket.subject}</h4>
                    </div>
                    <div className="text-sm text-muted-foreground shrink-0 text-right">
                      Updated {format(new Date(ticket.updatedAt), 'MMM d, yyyy')}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
