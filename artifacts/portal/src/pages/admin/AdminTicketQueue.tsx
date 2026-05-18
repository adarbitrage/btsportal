import { useState, useMemo, useEffect } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import { format } from "date-fns";
import { Search, X } from "lucide-react";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { cn } from "@/lib/utils";

type AdminTicket = Awaited<ReturnType<typeof adminPanelApi.getAdminTickets>>[number];
type TicketPriority = AdminTicket["priority"];
type TicketStatus = AdminTicket["status"];

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
  const priorityOrder: Record<TicketPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  return [...tickets].sort((a, b) => {
    const pri = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pri !== 0) return pri;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "open",
  in_progress: "in progress",
  awaiting_response: "awaiting response",
  resolved: "resolved",
  closed: "closed",
};

export default function AdminTicketQueue() {
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminPanelApi
      .getAdminTickets()
      .then((data) => {
        if (cancelled) return;
        setTickets(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load tickets");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const agents = useMemo(() => {
    const names = new Set<string>();
    for (const t of tickets) {
      if (t.assignee?.name) names.add(t.assignee.name);
    }
    return Array.from(names).sort();
  }, [tickets]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const t of tickets) cats.add(t.category);
    return Array.from(cats).sort();
  }, [tickets]);

  const filtered = useMemo(() => {
    let result = tickets;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t) =>
        t.subject.toLowerCase().includes(q) ||
        t.ticketNumber.toLowerCase().includes(q) ||
        (t.member?.name?.toLowerCase().includes(q) ?? false)
      );
    }
    if (statusFilter !== "all") result = result.filter((t) => t.status === statusFilter);
    if (categoryFilter !== "all") result = result.filter((t) => t.category === categoryFilter);
    if (priorityFilter !== "all") result = result.filter((t) => t.priority === priorityFilter);
    if (agentFilter !== "all") {
      if (agentFilter === "__unassigned") {
        result = result.filter((t) => !t.assignee);
      } else {
        result = result.filter((t) => t.assignee?.name === agentFilter);
      }
    }
    return sortTickets(result);
  }, [tickets, searchQuery, statusFilter, categoryFilter, priorityFilter, agentFilter]);

  const clearFilters = () => {
    setStatusFilter("all");
    setCategoryFilter("all");
    setPriorityFilter("all");
    setAgentFilter("all");
    setSearchQuery("");
  };

  const hasFilters =
    statusFilter !== "all" ||
    categoryFilter !== "all" ||
    priorityFilter !== "all" ||
    agentFilter !== "all" ||
    searchQuery !== "";

  const stats = useMemo(() => ({
    total: tickets.length,
    open: tickets.filter((t) => t.status === "open").length,
    inProgress: tickets.filter((t) => t.status === "in_progress").length,
    unassigned: tickets.filter((t) => !t.assignee).length,
  }), [tickets]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Ticket Queue</h1>
          <p className="text-muted-foreground">Manage support tickets</p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-sm text-muted-foreground">Total Tickets</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl font-bold">{stats.open}</div>
            <div className="text-sm text-muted-foreground">Open</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl font-bold">{stats.inProgress}</div>
            <div className="text-sm text-muted-foreground">In Progress</div>
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
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Priority" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="Agent" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Agents</SelectItem>
                  <SelectItem value="__unassigned">Unassigned</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                  <X className="w-4 h-4 mr-1" /> Clear
                </Button>
              )}
            </div>
          </div>

          <div className="divide-y divide-border">
            <div className="grid grid-cols-[1fr_100px_140px_160px_140px] gap-2 px-4 py-2.5 bg-secondary/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <div>Ticket</div>
              <div>Priority</div>
              <div>Status</div>
              <div>Agent</div>
              <div>Updated</div>
            </div>
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading tickets…</div>
            ) : error ? (
              <div className="p-8 text-center text-red-600">{error}</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {tickets.length === 0 ? "No tickets yet." : "No tickets match the current filters."}
              </div>
            ) : (
              filtered.map((ticket) => (
                <Link key={ticket.id} href={`/admin/tickets/${ticket.id}`}>
                  <div className="grid grid-cols-[1fr_100px_140px_160px_140px] gap-2 px-4 py-3 hover:bg-secondary/20 transition-colors items-center cursor-pointer">
                    <div className="group">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
                        {ticket.member?.name && (
                          <span className="text-xs text-muted-foreground">· {ticket.member.name}</span>
                        )}
                      </div>
                      <h4 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">{ticket.subject}</h4>
                    </div>
                    <div><PriorityBadge priority={ticket.priority} /></div>
                    <div>
                      <Badge
                        variant={ticket.status === "open" ? "warning" : ticket.status === "resolved" ? "success" : "secondary"}
                        className="text-[10px]"
                      >
                        {STATUS_LABELS[ticket.status] ?? ticket.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {ticket.assignee?.name ?? <span className="text-orange-600 font-medium">Unassigned</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(ticket.updatedAt), "MMM d, h:mm a")}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>
    </AdminLayout>
  );
}
