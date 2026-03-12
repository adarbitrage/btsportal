import { useState, useMemo } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  Search,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Users,
  X,
  Tag,
} from "lucide-react";
import { mockTickets, type AdminTicket } from "@/lib/admin-mock-data";
import { cn } from "@/lib/utils";

type SlaStatus = AdminTicket["slaStatus"];
type TicketPriority = AdminTicket["priority"];
type TicketStatus = AdminTicket["status"];
type TicketTier = AdminTicket["tier"];

function getSlaRowClass(slaStatus: SlaStatus) {
  switch (slaStatus) {
    case "breached": return "bg-red-50 border-l-4 border-l-red-500";
    case "approaching": return "bg-orange-50 border-l-4 border-l-orange-500";
    case "within": return "bg-green-50/30 border-l-4 border-l-green-500";
    default: return "";
  }
}

function SlaBadge({ status }: { status: SlaStatus }) {
  switch (status) {
    case "breached":
      return <Badge className="bg-red-600 hover:bg-red-700 text-white gap-1"><AlertTriangle className="w-3 h-3" />Breached</Badge>;
    case "approaching":
      return <Badge className="bg-orange-500 hover:bg-orange-600 gap-1"><Clock className="w-3 h-3" />Approaching</Badge>;
    case "within":
      return <Badge className="bg-green-600 hover:bg-green-700 gap-1"><CheckCircle2 className="w-3 h-3" />Within SLA</Badge>;
    default:
      return null;
  }
}

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const colors: Record<TicketPriority, string> = {
    urgent: "bg-red-100 text-red-800 border-red-200",
    high: "bg-orange-100 text-orange-800 border-orange-200",
    normal: "bg-blue-100 text-blue-800 border-blue-200",
    low: "bg-gray-100 text-gray-800 border-gray-200",
  };
  return <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded border", colors[priority])}>{priority}</span>;
}

function sortTickets(tickets: AdminTicket[]): AdminTicket[] {
  const slaOrder: Record<SlaStatus, number> = { breached: 0, approaching: 1, within: 2 };
  const priorityOrder: Record<TicketPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const tierOrder: Record<TicketTier, number> = { vip: 0, premium: 1, standard: 2, basic: 3 };

  return [...tickets].sort((a, b) => {
    const sla = slaOrder[a.slaStatus] - slaOrder[b.slaStatus];
    if (sla !== 0) return sla;
    const tier = tierOrder[a.tier] - tierOrder[b.tier];
    if (tier !== 0) return tier;
    const pri = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pri !== 0) return pri;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

const AGENTS = ["Sarah Chen", "Mike Johnson", "Lisa Wang", "James Rodriguez"];
const CATEGORIES: AdminTicket["category"][] = ["billing", "technical", "training", "account", "other"];

export default function AdminTicketQueue() {
  const [tickets, setTickets] = useState<AdminTicket[]>(mockTickets);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [slaFilter, setSlaFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showCategorizeDialog, setShowCategorizeDialog] = useState(false);
  const [bulkAssignAgent, setBulkAssignAgent] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");

  const agents = useMemo(() => [...new Set(tickets.map(t => t.assignedAgent).filter(Boolean) as string[])], [tickets]);

  const filtered = useMemo(() => {
    let result = tickets;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        t.subject.toLowerCase().includes(q) ||
        t.ticketNumber.toLowerCase().includes(q) ||
        t.memberName.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") result = result.filter(t => t.status === statusFilter);
    if (categoryFilter !== "all") result = result.filter(t => t.category === categoryFilter);
    if (agentFilter !== "all") result = result.filter(t => t.assignedAgent === agentFilter);
    if (tierFilter !== "all") result = result.filter(t => t.tier === tierFilter);
    if (slaFilter !== "all") result = result.filter(t => t.slaStatus === slaFilter);
    return sortTickets(result);
  }, [tickets, searchQuery, statusFilter, categoryFilter, agentFilter, tierFilter, slaFilter]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(t => t.id)));
    }
  };

  const bulkClose = () => {
    setTickets(prev => prev.map(t =>
      selectedIds.has(t.id) ? { ...t, status: "closed" as TicketStatus } : t
    ));
    setSelectedIds(new Set());
  };

  const bulkAssign = () => {
    if (!bulkAssignAgent) return;
    setTickets(prev => prev.map(t =>
      selectedIds.has(t.id) ? { ...t, assignedAgent: bulkAssignAgent } : t
    ));
    setSelectedIds(new Set());
    setShowAssignDialog(false);
    setBulkAssignAgent("");
  };

  const bulkCategorize = () => {
    if (!bulkCategory) return;
    setTickets(prev => prev.map(t =>
      selectedIds.has(t.id) ? { ...t, category: bulkCategory } : t
    ));
    setSelectedIds(new Set());
    setShowCategorizeDialog(false);
    setBulkCategory("");
  };

  const clearFilters = () => {
    setStatusFilter("all");
    setCategoryFilter("all");
    setAgentFilter("all");
    setTierFilter("all");
    setSlaFilter("all");
    setSearchQuery("");
  };

  const hasFilters = statusFilter !== "all" || categoryFilter !== "all" || agentFilter !== "all" || tierFilter !== "all" || slaFilter !== "all";

  const stats = useMemo(() => ({
    total: tickets.length,
    breached: tickets.filter(t => t.slaStatus === "breached").length,
    approaching: tickets.filter(t => t.slaStatus === "approaching").length,
    unassigned: tickets.filter(t => !t.assignedAgent).length,
  }), [tickets]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Ticket Queue</h1>
          <p className="text-muted-foreground">Manage support tickets sorted by SLA urgency</p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-sm text-muted-foreground">Total Tickets</div>
          </Card>
          <Card className="p-4 border-red-200 bg-red-50/50">
            <div className="text-2xl font-bold text-red-700">{stats.breached}</div>
            <div className="text-sm text-red-600">SLA Breached</div>
          </Card>
          <Card className="p-4 border-orange-200 bg-orange-50/50">
            <div className="text-2xl font-bold text-orange-700">{stats.approaching}</div>
            <div className="text-sm text-orange-600">Approaching SLA</div>
          </Card>
          <Card className="p-4 border-blue-200 bg-blue-50/50">
            <div className="text-2xl font-bold text-blue-700">{stats.unassigned}</div>
            <div className="text-sm text-blue-600">Unassigned</div>
          </Card>
        </div>

        <Card>
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex gap-3 items-center flex-wrap">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search tickets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border rounded-md bg-white"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="awaiting_response">Awaiting Response</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="billing">Billing</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="training">Training</SelectItem>
                  <SelectItem value="account">Account</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="Agent" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Agents</SelectItem>
                  {agents.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={tierFilter} onValueChange={setTierFilter}>
                <SelectTrigger className="w-[130px]"><SelectValue placeholder="Tier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tiers</SelectItem>
                  <SelectItem value="vip">VIP</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="basic">Basic</SelectItem>
                </SelectContent>
              </Select>
              <Select value={slaFilter} onValueChange={setSlaFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="SLA" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All SLA</SelectItem>
                  <SelectItem value="breached">Breached</SelectItem>
                  <SelectItem value="approaching">Approaching</SelectItem>
                  <SelectItem value="within">Within SLA</SelectItem>
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                  <X className="w-4 h-4 mr-1" /> Clear
                </Button>
              )}
            </div>

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-3 bg-primary/5 p-3 rounded-lg border border-primary/20">
                <span className="text-sm font-medium">{selectedIds.size} ticket(s) selected</span>
                <Button size="sm" variant="outline" onClick={() => setShowAssignDialog(true)}>
                  <Users className="w-3 h-3 mr-1" /> Assign
                </Button>
                <Button size="sm" variant="outline" onClick={bulkClose}>Close Selected</Button>
                <Button size="sm" variant="outline" onClick={() => setShowCategorizeDialog(true)}>
                  <Tag className="w-3 h-3 mr-1" /> Categorize
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                  <X className="w-3 h-3 mr-1" /> Deselect
                </Button>
              </div>
            )}
          </div>

          <div className="divide-y divide-border">
            <div className="grid grid-cols-[40px_1fr_100px_100px_100px_120px_120px_100px] gap-2 px-4 py-2.5 bg-secondary/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <div className="flex items-center">
                <Checkbox
                  checked={selectedIds.size === filtered.length && filtered.length > 0}
                  onCheckedChange={toggleAll}
                />
              </div>
              <div>Ticket</div>
              <div>Priority</div>
              <div>Status</div>
              <div>Tier</div>
              <div>Agent</div>
              <div>SLA</div>
              <div>Updated</div>
            </div>
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No tickets match the current filters.</div>
            ) : (
              filtered.map(ticket => (
                <div key={ticket.id} className={cn("grid grid-cols-[40px_1fr_100px_100px_100px_120px_120px_100px] gap-2 px-4 py-3 hover:bg-secondary/20 transition-colors items-center", getSlaRowClass(ticket.slaStatus))}>
                  <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(ticket.id)}
                      onCheckedChange={() => toggleSelect(ticket.id)}
                    />
                  </div>
                  <Link href={`/admin/tickets/${ticket.id}`}>
                    <div className="cursor-pointer group">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
                        <span className="text-xs text-muted-foreground">· {ticket.memberName}</span>
                      </div>
                      <h4 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">{ticket.subject}</h4>
                    </div>
                  </Link>
                  <div><PriorityBadge priority={ticket.priority} /></div>
                  <div>
                    <Badge variant={ticket.status === "open" ? "warning" : ticket.status === "resolved" ? "success" : "secondary"} className="text-[10px]">
                      {ticket.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <div>
                    <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded", ticket.tier === "vip" ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-700")}>{ticket.tier}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{ticket.assignedAgent || <span className="text-orange-600 font-medium">Unassigned</span>}</div>
                  <div><SlaBadge status={ticket.slaStatus} /></div>
                  <div className="text-xs text-muted-foreground">{format(new Date(ticket.updatedAt), "MMM d, h:mm a")}</div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Bulk Assign</DialogTitle>
              <DialogDescription>Assign {selectedIds.size} ticket(s) to an agent.</DialogDescription>
            </DialogHeader>
            <Select value={bulkAssignAgent} onValueChange={setBulkAssignAgent}>
              <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
              <SelectContent>
                {AGENTS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
              <Button onClick={bulkAssign} disabled={!bulkAssignAgent}>Assign</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showCategorizeDialog} onOpenChange={setShowCategorizeDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Bulk Categorize</DialogTitle>
              <DialogDescription>Set category for {selectedIds.size} ticket(s).</DialogDescription>
            </DialogHeader>
            <Select value={bulkCategory} onValueChange={setBulkCategory}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowCategorizeDialog(false)}>Cancel</Button>
              <Button onClick={bulkCategorize} disabled={!bulkCategory}>Categorize</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
