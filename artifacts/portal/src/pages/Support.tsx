import { useState } from "react";
import { useListTickets, useCreateTicket, useResolveTicket, getListTicketsQueryKey, ApiError } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Link } from "wouter";
import { Search, MessageCircle, HelpCircle, AlertTriangle, LifeBuoy, Info, CheckCircle2 } from "lucide-react";
import { getTopicPresetForSubject, formatTicketCategory } from "@/lib/support-topics";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";

const ticketSchema = z.object({
  category: z.enum(["billing", "technical", "training", "account", "other"]),
  subject: z.string().min(5),
  description: z.string().min(10)
});

interface LimitReachedDetails {
  limit: number;
  usedThisMonth: number;
}

function parseLimitReachedError(err: unknown): LimitReachedDetails | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null;
  const body = err.data as { error?: { code?: string; details?: unknown } } | null;
  if (body?.error?.code !== "TICKET_LIMIT_REACHED") return null;
  const details = body.error.details as Partial<LimitReachedDetails> | undefined;
  const limit = typeof details?.limit === "number" ? details.limit : 0;
  const usedThisMonth = typeof details?.usedThisMonth === "number" ? details.usedThisMonth : 0;
  return { limit, usedThisMonth };
}

const inputClass =
  "w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/40";

const ACTIVE_STATUSES = new Set(["open", "in_progress", "awaiting_response"]);

const statusColors: Record<string, string> = {
  open: "warning",
  in_progress: "warning",
  awaiting_response: "secondary",
  resolved: "success",
  closed: "default"
};

export default function Support() {
  const [isCreating, setIsCreating] = useState(false);
  const [limitReached, setLimitReached] = useState<LimitReachedDetails | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const { data: tickets, isLoading } = useListTickets();
  const createTicket = useCreateTicket();
  const resolveTicket = useResolveTicket();
  const queryClient = useQueryClient();

  const form = useForm<z.infer<typeof ticketSchema>>({
    resolver: zodResolver(ticketSchema),
    defaultValues: { category: "technical", subject: "", description: "" }
  });

  const onSubmit = (data: z.infer<typeof ticketSchema>) => {
    setLimitReached(null);
    createTicket.mutate({ data }, {
      onSuccess: () => {
        setIsCreating(false);
        form.reset();
        queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
      },
      onError: (err) => {
        const parsed = parseLimitReachedError(err);
        if (parsed) {
          setLimitReached(parsed);
        }
      },
    });
  };

  const handleMarkResolved = (e: React.MouseEvent, ticketId: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (resolvingId !== null) return;
    if (!window.confirm("Mark this ticket as resolved? You can still reply to re-open it.")) return;
    setResolvingId(ticketId);
    resolveTicket.mutate({ id: ticketId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
      },
      onSettled: () => {
        setResolvingId(null);
      },
    });
  };

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <LifeBuoy className="w-6 h-6 text-primary" />
              <h1 className="text-3xl font-bold">Support Center</h1>
            </div>
            <p className="text-muted-foreground">We're here to help you succeed.</p>
          </div>
          <Button
            onClick={() => {
              setLimitReached(null);
              setIsCreating(true);
            }}
          >
            New Ticket
          </Button>
        </div>

        {isCreating && (
          <Card className="border-border/60 shadow-sm">
            <div className="bg-muted/40 p-4 border-b border-border/60 font-bold text-foreground">
              Create New Support Ticket
            </div>
            <CardContent className="p-6">
              {limitReached && (
                <div
                  data-testid="ticket-limit-reached"
                  className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
                >
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
                  <div className="flex-1">
                    <p className="font-semibold">
                      You've reached your monthly limit of {limitReached.limit} ticket
                      {limitReached.limit === 1 ? "" : "s"}.
                    </p>
                    <p className="mt-1">
                      <Link
                        href="/plans"
                        className="font-semibold underline hover:no-underline"
                      >
                        Upgrade your plan
                      </Link>{" "}
                      to file more support tickets this month.
                    </p>
                  </div>
                </div>
              )}
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Category</label>
                  <select {...form.register("category")} className={inputClass}>
                    <option value="technical">Technical Support</option>
                    <option value="billing">Billing Inquiry</option>
                    <option value="training">Training Content</option>
                    <option value="account">Account Issue</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Subject</label>
                  <input {...form.register("subject")} className={inputClass} placeholder="Brief summary of your issue" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Description</label>
                  <textarea {...form.register("description")} rows={4} className={`${inputClass} resize-none`} placeholder="Please provide details..."></textarea>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="ghost" onClick={() => setIsCreating(false)}>Cancel</Button>
                  <Button type="submit" isLoading={createTicket.isPending}>Submit Ticket</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card className="border-border/60 shadow-sm">
          <div className="p-4 border-b border-border/60 flex gap-4 items-center bg-muted/40">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search tickets..."
                className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
          </div>
          <div className="divide-y divide-border/60">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading tickets...</div>
            ) : tickets?.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No support tickets yet.</p>
              </div>
            ) : (
              tickets?.map(ticket => {
                const isActive = ACTIVE_STATUSES.has(ticket.status);
                const isResolved = ticket.status === "resolved" || ticket.status === "closed";
                return (
                  <Link key={ticket.id} href={`/support/tickets/${ticket.id}`}>
                    <div className={`p-5 hover:bg-muted/40 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 group${isResolved ? " opacity-70" : ""}`}>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                          <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
                          <Badge variant={statusColors[ticket.status] as any}>
                            {isResolved ? (
                              <span className="flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                {ticket.status.replace('_', ' ')}
                              </span>
                            ) : ticket.status.replace('_', ' ')}
                          </Badge>
                          <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground bg-muted px-2 py-0.5 rounded">{formatTicketCategory(ticket.category)}</span>
                          {(() => {
                            const preset = getTopicPresetForSubject(ticket.subject);
                            if (!preset) return null;
                            return (
                              <span
                                data-testid={`ticket-topic-badge-${ticket.id}`}
                                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-900"
                              >
                                <Info className="w-3 h-3 text-blue-600" />
                                {preset.badgeLabel}
                              </span>
                            );
                          })()}
                        </div>
                        <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors">{ticket.subject}</h4>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {isActive && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs gap-1.5 border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800 hover:border-green-400"
                            disabled={resolvingId === ticket.id}
                            onClick={(e) => handleMarkResolved(e, ticket.id)}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {resolvingId === ticket.id ? "Resolving..." : "Mark Resolved"}
                          </Button>
                        )}
                        <div className="text-sm text-muted-foreground text-right">
                          Updated {format(new Date(ticket.updatedAt), 'MMM d, yyyy')}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-6 flex flex-col sm:flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-lg border border-border/60 bg-muted flex items-center justify-center shrink-0">
              <HelpCircle className="w-6 h-6 text-foreground" />
            </div>
            <div className="flex-1 text-center sm:text-left">
              <h3 className="font-semibold text-foreground">Can't find what you're looking for?</h3>
              <p className="text-sm text-muted-foreground">Fill out a quick form and we'll reply within 24 hours.</p>
            </div>
            <Button asChild className="whitespace-nowrap">
              <Link href="/support/contact">Contact Us</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
