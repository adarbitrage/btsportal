import { useState, useMemo, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  User,
  ShieldAlert,
  Send,
  StickyNote,
  MessageSquareText,
  Search,
  GitMerge,
  Eye,
  EyeOff,
  AlertTriangle,
  Clock,
  CheckCircle2,
  ScrollText,
  ExternalLink,
} from "lucide-react";
import { mockCannedResponses } from "@/lib/admin-mock-data";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { cn } from "@/lib/utils";

type TicketAuditRow = {
  id: number;
  actionType: string;
  entityType: string;
  entityId: string | null;
  actorId: number | null;
  actorEmail: string | null;
  description: string;
  createdAt: string;
};

type AdminTicketDetail = Awaited<ReturnType<typeof adminPanelApi.getAdminTicket>>;
type AdminTicketSla = NonNullable<Awaited<ReturnType<typeof adminPanelApi.getAdminTicketSla>>>;
type AdminTicketListItem = Awaited<ReturnType<typeof adminPanelApi.getAdminTickets>>[number];
type Assignee = Awaited<ReturnType<typeof adminPanelApi.getTicketAssignees>>[number];

type SlaBadgeStatus = "breached" | "approaching" | "within";

// Reduce the SLA record's per-target flags into a single rollup status
// for the page header badge: breached wins over approaching, otherwise
// we render "within". Returns null when no SLA row exists for this
// ticket (e.g. test fixtures that skip SLA seeding).
function computeSlaStatus(sla: AdminTicketSla | null): SlaBadgeStatus | null {
  if (!sla) return null;
  if (sla.firstResponseBreached || sla.resolutionBreached) return "breached";
  if (sla.firstResponseWarning || sla.resolutionWarning) return "approaching";
  return "within";
}

function CannedResponsePicker({
  open,
  onClose,
  onInsert,
  ticket,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
  ticket: AdminTicketDetail;
}) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  const categories = useMemo(() => {
    const cats = [...new Set(mockCannedResponses.map((r) => r.category))];
    return cats;
  }, []);

  const filtered = useMemo(() => {
    let responses = mockCannedResponses;
    if (selectedCategory !== "all") responses = responses.filter((r) => r.category === selectedCategory);
    if (search) {
      const q = search.toLowerCase();
      responses = responses.filter((r) => r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q));
    }
    return responses;
  }, [search, selectedCategory]);

  const memberName = ticket.member?.name ?? "Member";
  const memberEmail = ticket.member?.email ?? "";

  const replaceVariables = (body: string) => {
    return body
      .replace(/\{\{member_name\}\}/g, memberName)
      .replace(/\{\{member_email\}\}/g, memberEmail)
      .replace(/\{\{agent_name\}\}/g, "Admin")
      .replace(/\{\{ticket_number\}\}/g, ticket.ticketNumber)
      .replace(/\{\{refund_amount\}\}/g, "$XX.XX")
      .replace(/\{\{sla_hours\}\}/g, "24")
      .replace(/\{\{resolution_summary\}\}/g, "[Enter resolution details]");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Canned Responses</DialogTitle>
          <DialogDescription>Select a response to insert. Variables will be auto-replaced.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-3 mb-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search responses..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border rounded-md bg-white"
            />
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {filtered.map((response) => (
            <div
              key={response.id}
              className="p-3 border rounded-lg hover:bg-secondary/30 cursor-pointer transition-colors group"
              onClick={() => {
                onInsert(replaceVariables(response.body));
                onClose();
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <h4 className="font-medium text-sm group-hover:text-primary transition-colors">{response.title}</h4>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-secondary text-muted-foreground">{response.category}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{replaceVariables(response.body)}</p>
              {response.variables.length > 0 && (
                <div className="flex gap-1 mt-1.5">
                  {response.variables.map((v) => (
                    <span key={v} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">{`{{${v}}}`}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MergeDialog({
  open,
  onClose,
  currentTicket,
  onMerged,
}: {
  open: boolean;
  onClose: () => void;
  currentTicket: AdminTicketDetail;
  onMerged: () => void;
}) {
  const [selectedTickets, setSelectedTickets] = useState<Set<number>>(new Set());
  const [otherTickets, setOtherTickets] = useState<AdminTicketListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  // Refetch the candidate list every time the dialog opens so an admin who
  // closes another ticket in a different tab and comes back doesn't see a
  // stale row in the merge picker.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setOtherTickets(null);
    setError(null);
    setSelectedTickets(new Set());
    adminPanelApi
      .getAdminTickets()
      .then((rows) => {
        if (cancelled) return;
        // Only mergeable candidates: not the current ticket, not already
        // closed (closed tickets can't accept reassigned messages).
        const candidates = rows.filter(
          (t) => t.id !== currentTicket.id && t.status !== "closed",
        );
        setOtherTickets(candidates);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load tickets");
        setOtherTickets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentTicket.id]);

  const toggleTicket = (id: number) => {
    setSelectedTickets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMerge = async () => {
    if (selectedTickets.size === 0) return;
    setMerging(true);
    setError(null);
    try {
      await adminPanelApi.mergeTickets(currentTicket.id, Array.from(selectedTickets));
      onMerged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge tickets");
    } finally {
      setMerging(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" data-testid="ticket-merge-dialog">
        <DialogHeader>
          <DialogTitle>Merge Tickets</DialogTitle>
          <DialogDescription>
            Select duplicate tickets to merge into <span className="font-mono font-bold">{currentTicket.ticketNumber}</span> (primary).
            All messages from selected tickets will be combined.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {otherTickets === null ? (
            <p className="text-sm text-muted-foreground" data-testid="ticket-merge-loading">Loading tickets…</p>
          ) : otherTickets.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="ticket-merge-empty">No other open tickets to merge.</p>
          ) : (
            otherTickets.map((ticket) => (
              <div
                key={ticket.id}
                className={cn(
                  "flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors",
                  selectedTickets.has(ticket.id) ? "bg-primary/5 border-primary/30" : "hover:bg-secondary/30"
                )}
                onClick={() => toggleTicket(ticket.id)}
                data-testid={`ticket-merge-candidate-${ticket.id}`}
              >
                <Checkbox checked={selectedTickets.has(ticket.id)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
                    <span className="text-xs text-muted-foreground">· {ticket.member?.name ?? "Unknown member"}</span>
                  </div>
                  <p className="text-sm font-medium truncate">{ticket.subject}</p>
                </div>
                <Badge variant="secondary" className="text-[10px]">{ticket.status.replace(/_/g, " ")}</Badge>
              </div>
            ))
          )}
        </div>
        {error && <p className="text-sm text-destructive" data-testid="ticket-merge-error">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={merging}>Cancel</Button>
          <Button
            disabled={selectedTickets.size === 0 || merging}
            onClick={handleMerge}
            data-testid="ticket-merge-confirm"
          >
            <GitMerge className="w-4 h-4 mr-2" />
            {merging ? "Merging…" : `Merge ${selectedTickets.size} ticket(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminTicketDetail() {
  const { id } = useParams();
  const ticketId = parseInt(id || "", 10);

  const [ticket, setTicket] = useState<AdminTicketDetail | null>(null);
  const [ticketLoading, setTicketLoading] = useState(true);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [sla, setSla] = useState<AdminTicketSla | null>(null);

  const [assignees, setAssignees] = useState<Assignee[]>([]);

  const [reply, setReply] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [showCannedPicker, setShowCannedPicker] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);

  // Recent audit-log rows for this ticket. Continues to come from the live
  // audit log so the deep-links into /admin/audit-log keep working — this
  // card was wired to real data in task #192 and stays as-is.
  const [auditRows, setAuditRows] = useState<TicketAuditRow[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  // Tracks which select is currently being mutated so we can show
  // disabled/spinner state and surface failures inline. We only need a
  // single field marker because the three selects gate each other for the
  // brief moment of the network round-trip.
  const [savingField, setSavingField] = useState<null | "status" | "priority" | "assignee">(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadTicket = useCallback(async () => {
    if (!Number.isFinite(ticketId)) {
      setNotFound(true);
      setTicketLoading(false);
      return;
    }
    setTicketLoading(true);
    setTicketError(null);
    setNotFound(false);
    try {
      const data = await adminPanelApi.getAdminTicket(ticketId);
      setTicket(data);
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e?.status === 404) {
        setNotFound(true);
      } else {
        setTicketError(e?.message ?? "Failed to load ticket");
      }
    } finally {
      setTicketLoading(false);
    }
  }, [ticketId]);

  const loadSla = useCallback(async () => {
    if (!Number.isFinite(ticketId)) return;
    try {
      const data = await adminPanelApi.getAdminTicketSla(ticketId);
      setSla(data);
    } catch {
      // SLA is a non-critical UI badge — swallow failures so the rest of
      // the page still renders. The header just won't show an SLA badge.
      setSla(null);
    }
  }, [ticketId]);

  const loadAuditHistory = useCallback(async () => {
    if (!Number.isFinite(ticketId)) return;
    setAuditRows(null);
    setAuditError(null);
    try {
      const data = await adminPanelApi.getTicketAuditHistory(ticketId);
      setAuditRows(data.auditHistory ?? []);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "Failed to load activity");
      setAuditRows([]);
    }
  }, [ticketId]);

  useEffect(() => {
    loadTicket();
    loadSla();
    loadAuditHistory();
  }, [loadTicket, loadSla, loadAuditHistory]);

  useEffect(() => {
    let cancelled = false;
    adminPanelApi
      .getTicketAssignees()
      .then((rows) => {
        if (!cancelled) setAssignees(rows);
      })
      .catch(() => {
        if (!cancelled) setAssignees([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const slaStatus = useMemo(() => computeSlaStatus(sla), [sla]);

  const handleStatusChange = async (next: string) => {
    if (!ticket || ticket.status === next) return;
    setSavingField("status");
    setSaveError(null);
    try {
      await adminPanelApi.updateTicketStatus(ticket.id, next);
      await Promise.all([loadTicket(), loadSla(), loadAuditHistory()]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setSavingField(null);
    }
  };

  const handlePriorityChange = async (next: string) => {
    if (!ticket || ticket.priority === next) return;
    setSavingField("priority");
    setSaveError(null);
    try {
      await adminPanelApi.updateTicketPriority(ticket.id, next);
      await Promise.all([loadTicket(), loadAuditHistory()]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to update priority");
    } finally {
      setSavingField(null);
    }
  };

  const handleAssigneeChange = async (next: string) => {
    if (!ticket) return;
    const assignedTo = next === "unassigned" ? null : parseInt(next, 10);
    if (assignedTo !== null && !Number.isFinite(assignedTo)) return;
    if ((ticket.assignedTo ?? null) === assignedTo) return;
    setSavingField("assignee");
    setSaveError(null);
    try {
      await adminPanelApi.updateTicketAssignee(ticket.id, assignedTo);
      await Promise.all([loadTicket(), loadAuditHistory()]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to update assignee");
    } finally {
      setSavingField(null);
    }
  };

  if (ticketLoading) {
    return (
      <AdminLayout>
        <div className="text-center py-12 text-muted-foreground" data-testid="ticket-detail-loading">
          Loading ticket…
        </div>
      </AdminLayout>
    );
  }

  if (notFound) {
    return (
      <AdminLayout>
        <div className="text-center py-12 text-muted-foreground" data-testid="ticket-detail-not-found">
          Ticket not found
        </div>
      </AdminLayout>
    );
  }

  if (ticketError || !ticket) {
    return (
      <AdminLayout>
        <div className="max-w-4xl mx-auto space-y-4 py-12 text-center">
          <p className="text-destructive" data-testid="ticket-detail-error">
            {ticketError ?? "Failed to load ticket"}
          </p>
          <Button variant="outline" onClick={() => loadTicket()}>Retry</Button>
        </div>
      </AdminLayout>
    );
  }

  const handleInsertCanned = (text: string) => {
    setReply((prev) => prev + text);
  };

  const memberName = ticket.member?.name ?? "Unknown member";
  const memberEmail = ticket.member?.email ?? "";
  const assigneeSelectValue = ticket.assignedTo != null ? String(ticket.assignedTo) : "unassigned";

  // The current assignee may not be in the assignees list (e.g. role
  // changed since assignment); surface them anyway so the dropdown can
  // render the current selection without the value going blank.
  const assigneeOptions: Assignee[] = (() => {
    if (!ticket.assignee) return assignees;
    const exists = assignees.some((a) => a.id === ticket.assignee!.id);
    if (exists) return assignees;
    return [ticket.assignee, ...assignees];
  })();

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <Link href="/admin/tickets">
          <Button variant="ghost" className="pl-0 hover:bg-transparent hover:text-primary -ml-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Queue
          </Button>
        </Link>

        <div className="bg-white p-6 md:p-8 rounded-xl border border-border shadow-sm" data-testid="ticket-detail-header">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground mb-2" data-testid="ticket-subject">{ticket.subject}</h1>
              <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                <span className="font-mono bg-secondary px-2 py-0.5 rounded" data-testid="ticket-number">{ticket.ticketNumber}</span>
                <span>·</span>
                <span data-testid="ticket-member">{memberName}{memberEmail ? ` (${memberEmail})` : ""}</span>
                <span>·</span>
                <span className="capitalize">{ticket.category}</span>
                <span>·</span>
                <span>Created {format(new Date(ticket.createdAt), "MMM d, yyyy h:mm a")}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0" data-testid="ticket-sla-badge">
              {slaStatus === "breached" && (
                <Badge className="bg-red-600 text-white gap-1"><AlertTriangle className="w-3 h-3" />SLA Breached</Badge>
              )}
              {slaStatus === "approaching" && (
                <Badge className="bg-orange-500 gap-1"><Clock className="w-3 h-3" />SLA Approaching</Badge>
              )}
              {slaStatus === "within" && (
                <Badge className="bg-green-600 gap-1"><CheckCircle2 className="w-3 h-3" />Within SLA</Badge>
              )}
            </div>
          </div>

          <div className="flex gap-3 mt-4 flex-wrap">
            <Select
              value={ticket.status}
              onValueChange={handleStatusChange}
              disabled={savingField === "status"}
            >
              <SelectTrigger className="w-[160px]" data-testid="ticket-status-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="awaiting_response">Awaiting Response</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={ticket.priority}
              onValueChange={handlePriorityChange}
              disabled={savingField === "priority"}
            >
              <SelectTrigger className="w-[130px]" data-testid="ticket-priority-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={assigneeSelectValue}
              onValueChange={handleAssigneeChange}
              disabled={savingField === "assignee"}
            >
              <SelectTrigger className="w-[180px]" data-testid="ticket-assignee-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {assigneeOptions.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setShowMergeDialog(true)} data-testid="ticket-merge-button">
              <GitMerge className="w-4 h-4 mr-2" /> Merge
            </Button>
          </div>
          {saveError && (
            <p className="mt-3 text-sm text-destructive" data-testid="ticket-save-error">{saveError}</p>
          )}
        </div>

        <div className="space-y-4" data-testid="ticket-messages">
          {ticket.messages.map((msg) => (
            <Card
              key={msg.id}
              className={cn(
                msg.isInternal
                  ? "bg-yellow-50 border-yellow-200"
                  : msg.senderType === "admin"
                  ? "border-primary/20 bg-primary/[0.02]"
                  : ""
              )}
              data-testid={`ticket-message-${msg.id}`}
            >
              <CardContent className="p-6">
                <div className="flex gap-4">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                      msg.isInternal
                        ? "bg-yellow-200 text-yellow-800"
                        : msg.senderType === "admin"
                        ? "bg-primary text-white"
                        : "bg-secondary text-muted-foreground"
                    )}
                  >
                    {msg.isInternal ? (
                      <StickyNote className="w-5 h-5" />
                    ) : msg.senderType === "admin" ? (
                      <ShieldAlert className="w-5 h-5" />
                    ) : (
                      <User className="w-5 h-5" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-bold text-foreground">{msg.senderName}</span>
                      {msg.isInternal && (
                        <Badge className="bg-yellow-200 text-yellow-800 text-[10px] gap-1">
                          <EyeOff className="w-3 h-3" /> Internal Note
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{format(new Date(msg.createdAt), "MMM d, h:mm a")}</span>
                    </div>
                    <div className="text-foreground whitespace-pre-wrap leading-relaxed text-sm">{msg.body}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {ticket.messages.length === 0 && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground" data-testid="ticket-messages-empty">
                No messages on this ticket yet.
              </CardContent>
            </Card>
          )}
        </div>

        <Card data-testid="ticket-recent-activity-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ScrollText className="w-4 h-4" /> Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {auditRows === null ? (
              <p className="text-sm text-muted-foreground" data-testid="ticket-recent-activity-loading">
                Loading activity…
              </p>
            ) : auditError ? (
              <p className="text-sm text-destructive" data-testid="ticket-recent-activity-error">
                {auditError}
              </p>
            ) : auditRows.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="ticket-recent-activity-empty">
                No recent audit activity for this ticket
              </p>
            ) : (
              <div className="space-y-2" data-testid="ticket-recent-activity-list">
                {auditRows.map((log) => (
                  <Link
                    key={log.id}
                    href={`/admin/audit-log?entityType=ticket&expand=${log.id}`}
                    data-testid={`ticket-audit-link-${log.id}`}
                  >
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer">
                      <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{log.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className="text-[10px]">{log.actionType}</Badge>
                          {log.actorEmail && (
                            <span className="text-[10px] text-muted-foreground truncate">{log.actorEmail}</span>
                          )}
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {log.createdAt ? format(new Date(log.createdAt), "MMM d, h:mm a") : ""}
                          </span>
                        </div>
                      </div>
                      <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {ticket.status !== "closed" && (
          <Card className="mt-8 overflow-hidden border-border focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all">
            {isInternal && (
              <div className="bg-yellow-100 border-b border-yellow-200 px-4 py-2 flex items-center gap-2 text-sm text-yellow-800">
                <EyeOff className="w-4 h-4" />
                <span className="font-medium">Internal note — not visible to the member</span>
              </div>
            )}
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              className={cn(
                "w-full p-4 border-none outline-none resize-none bg-transparent min-h-[120px]",
                isInternal && "bg-yellow-50/50"
              )}
              placeholder={isInternal ? "Write an internal note..." : "Type your reply here..."}
            />
            <div className="bg-secondary/50 p-3 border-t border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => setShowCannedPicker(true)}>
                  <MessageSquareText className="w-4 h-4 mr-2" /> Canned Response
                </Button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsInternal(!isInternal)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                      isInternal
                        ? "bg-yellow-200 text-yellow-800"
                        : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                    )}
                  >
                    {isInternal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {isInternal ? "Internal Note" : "Public Reply"}
                  </button>
                </div>
              </div>
              <Button disabled={!reply.trim()}>
                <Send className="w-4 h-4 mr-2" /> {isInternal ? "Save Note" : "Send Reply"}
              </Button>
            </div>
          </Card>
        )}

        <CannedResponsePicker
          open={showCannedPicker}
          onClose={() => setShowCannedPicker(false)}
          onInsert={handleInsertCanned}
          ticket={ticket}
        />

        <MergeDialog
          open={showMergeDialog}
          onClose={() => setShowMergeDialog(false)}
          currentTicket={ticket}
          onMerged={() => {
            loadTicket();
            loadAuditHistory();
          }}
        />
      </div>
    </AdminLayout>
  );
}
