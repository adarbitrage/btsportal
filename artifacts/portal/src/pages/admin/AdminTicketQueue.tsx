import { useState, useMemo, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import { format } from "date-fns";
import { Search, X, MailX, AlertTriangle, RefreshCw, Phone } from "lucide-react";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { TICKET_CATEGORY_LABELS, formatTicketCategory } from "@workspace/support-config";

type AdminTicket = Awaited<ReturnType<typeof adminPanelApi.getAdminTickets>>[number];
type TicketPriority = AdminTicket["priority"];
type TicketStatus = AdminTicket["status"];
type SlaStatus = NonNullable<AdminTicket["slaStatus"]>;
type DeliveryStatus = AdminTicket["deliveryStatus"];
type Assignee = { id: number; name: string; email: string };

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const colors: Record<TicketPriority, string> = {
    urgent: "bg-red-100 text-red-800 border-red-200",
    high: "bg-orange-100 text-orange-800 border-orange-200",
    normal: "bg-blue-100 text-blue-800 border-blue-200",
    low: "bg-gray-100 text-gray-800 border-gray-200",
  };
  return <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded border", colors[priority])}>{priority}</span>;
}

// Visual ordering for SLA urgency (breached → approaching → within → none),
// also reused as the default queue sort precedence so the most urgent rows
// always surface at the top.
const SLA_RANK: Record<SlaStatus | "none", number> = {
  breached: 0,
  approaching: 1,
  within: 2,
  none: 3,
};

// Tier display + sort ordering. The slug list mirrors `getSlaTargetsForTier`
// on the server (best → worst SLA target). Anything we don't recognise
// sorts after all known tiers so unexpected slugs don't surface above
// known-paid customers.
const TIER_LABELS: Record<string, string> = {
  lifetime: "Lifetime",
  "1year": "1 Year",
  "6month": "6 Month",
  "3month": "3 Month",
  launchpad: "Launchpad",
  frontend: "Frontend",
  free: "Free",
};
const TIER_RANK: Record<string, number> = {
  lifetime: 0,
  "1year": 1,
  "6month": 2,
  "3month": 3,
  launchpad: 4,
  frontend: 5,
  free: 6,
};
function tierRank(tier: string | null): number {
  if (!tier) return 99;
  return TIER_RANK[tier] ?? 50;
}

function SlaBadge({ status }: { status: SlaStatus | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const styles: Record<SlaStatus, string> = {
    breached: "bg-red-100 text-red-800 border-red-200",
    approaching: "bg-amber-100 text-amber-800 border-amber-200",
    within: "bg-emerald-100 text-emerald-800 border-emerald-200",
  };
  const labels: Record<SlaStatus, string> = {
    breached: "Breached",
    approaching: "Approaching",
    within: "Within",
  };
  return (
    <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded border", styles[status])}>
      {labels[status]}
    </span>
  );
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-xs text-muted-foreground">—</span>;
  const label = TIER_LABELS[tier] ?? tier;
  return (
    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded border bg-secondary text-secondary-foreground border-border">
      {label}
    </span>
  );
}

// Inline delivery-failure flag for the queue. Only "failed" / "skipped"
// render anything — those mean the member was never reached, so agents need
// to spot them while scanning. "delivered" / "pending" are the happy/neutral
// path and stay silent to keep the row uncluttered.
function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  if (status === "failed") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border border-red-200 bg-red-100 text-red-800"
        title="Notification delivery failed"
        data-testid="queue-delivery-badge"
        data-delivery-status="failed"
      >
        <MailX className="w-3 h-3" />Delivery failed
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border border-orange-200 bg-orange-100 text-orange-800"
        title="Notification delivery skipped"
        data-testid="queue-delivery-badge"
        data-delivery-status="skipped"
      >
        <AlertTriangle className="w-3 h-3" />Delivery skipped
      </span>
    );
  }
  return null;
}

function sortTickets(tickets: AdminTicket[]): AdminTicket[] {
  // Default sort: SLA urgency → tier → priority → createdAt (newest first).
  // Triage needs the most-at-risk rows up top, then the highest-paying
  // tier, then the explicit priority, with createdAt as a stable
  // tiebreaker (newer first within a bucket).
  const priorityOrder: Record<TicketPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  return [...tickets].sort((a, b) => {
    const slaA = SLA_RANK[a.slaStatus ?? "none"];
    const slaB = SLA_RANK[b.slaStatus ?? "none"];
    if (slaA !== slaB) return slaA - slaB;
    const tierA = tierRank(a.tier);
    const tierB = tierRank(b.tier);
    if (tierA !== tierB) return tierA - tierB;
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

// Human-readable labels for ticket categories. The curated map and the
// snake_case fallback now live in a single shared source
// (`@workspace/support-config`) so the admin and member views can never drift
// apart. Re-exported here (under the names this page and its tests already use)
// so consumers keep working unchanged. The shared map is keyed by
// `TicketCategorySlug`, so a new backend category that lacks a curated label
// fails the portal typecheck; the companion test (categoryLabel.test.tsx) backs
// this up at runtime and cross-checks the generated API-client enum.
export const CATEGORY_LABELS = TICKET_CATEGORY_LABELS;

export const categoryLabel = formatTicketCategory;

// Row tint based on SLA status — keeps breached/approaching rows visually
// distinct in the queue so they pop without needing to scan the badge column.
function slaRowTint(status: SlaStatus | null): string {
  if (status === "breached") return "bg-red-50/60 hover:bg-red-50";
  if (status === "approaching") return "bg-amber-50/60 hover:bg-amber-50";
  return "hover:bg-secondary/20";
}

export default function AdminTicketQueue() {
  const { toast } = useToast();
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [slaFilter, setSlaFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [deliveryFilter, setDeliveryFilter] = useState("all");
  const [viewFilter, setViewFilter] = useState<"all" | "support" | "concierge_compliance">("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [bulkPending, setBulkPending] = useState(false);
  const [retryingIds, setRetryingIds] = useState<Set<number>>(new Set());

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminPanelApi.getAdminTickets();
      setTickets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    let cancelled = false;
    adminPanelApi
      .getTicketAssignees()
      .then((data) => {
        if (!cancelled) setAssignees(data);
      })
      .catch(() => {
        /* assignee dropdown will simply be empty */
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

  const tiers = useMemo(() => {
    const set = new Set<string>();
    for (const t of tickets) {
      if (t.tier) set.add(t.tier);
    }
    return Array.from(set).sort((a, b) => tierRank(a) - tierRank(b));
  }, [tickets]);

  const CC_CATEGORIES = ["concierge_task", "compliance_review"];
  const SUPPORT_CATEGORIES = ["billing", "technical", "training", "account", "other"];

  const filtered = useMemo(() => {
    let result = tickets;

    // Top-level view filter: scopes to support or concierge/compliance tickets
    if (viewFilter === "support") {
      result = result.filter((t) => SUPPORT_CATEGORIES.includes(t.category));
    } else if (viewFilter === "concierge_compliance") {
      result = result.filter((t) => CC_CATEGORIES.includes(t.category));
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t) =>
        t.subject.toLowerCase().includes(q) ||
        t.ticketNumber.toLowerCase().includes(q) ||
        (t.member?.name?.toLowerCase().includes(q) ?? false)
      );
    }
    if (statusFilter !== "all") result = result.filter((t) => t.status === statusFilter);
    // Category dropdown only active when viewing All (not scoped by viewFilter)
    if (viewFilter === "all" && categoryFilter !== "all") result = result.filter((t) => t.category === categoryFilter);
    if (priorityFilter !== "all") result = result.filter((t) => t.priority === priorityFilter);
    if (agentFilter !== "all") {
      if (agentFilter === "__unassigned") {
        result = result.filter((t) => !t.assignee);
      } else {
        result = result.filter((t) => t.assignee?.name === agentFilter);
      }
    }
    if (slaFilter !== "all") {
      if (slaFilter === "__none") {
        result = result.filter((t) => t.slaStatus == null);
      } else {
        result = result.filter((t) => t.slaStatus === slaFilter);
      }
    }
    if (tierFilter !== "all") {
      if (tierFilter === "__none") {
        result = result.filter((t) => t.tier == null);
      } else {
        result = result.filter((t) => t.tier === tierFilter);
      }
    }
    if (deliveryFilter !== "all") {
      result = result.filter((t) => t.deliveryStatus === deliveryFilter);
    }
    return sortTickets(result);
  }, [tickets, viewFilter, searchQuery, statusFilter, categoryFilter, priorityFilter, agentFilter, slaFilter, tierFilter, deliveryFilter]);

  const filteredIds = useMemo(() => filtered.map((t) => t.id), [filtered]);
  const selectedVisibleCount = useMemo(
    () => filteredIds.filter((id) => selectedIds.has(id)).length,
    [filteredIds, selectedIds],
  );
  const allVisibleSelected = filteredIds.length > 0 && selectedVisibleCount === filteredIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  const toggleRow = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const id of filteredIds) next.add(id);
      } else {
        for (const id of filteredIds) next.delete(id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const clearFilters = () => {
    setStatusFilter("all");
    setCategoryFilter("all");
    setPriorityFilter("all");
    setAgentFilter("all");
    setSlaFilter("all");
    setTierFilter("all");
    setDeliveryFilter("all");
    setSearchQuery("");
  };

  const hasFilters =
    statusFilter !== "all" ||
    categoryFilter !== "all" ||
    priorityFilter !== "all" ||
    agentFilter !== "all" ||
    slaFilter !== "all" ||
    tierFilter !== "all" ||
    deliveryFilter !== "all" ||
    searchQuery !== "";

  const ccCount = useMemo(() => tickets.filter((t) => CC_CATEGORIES.includes(t.category)).length, [tickets]);

  const stats = useMemo(() => ({
    total: tickets.length,
    open: tickets.filter((t) => t.status === "open").length,
    unassigned: tickets.filter((t) => !t.assignee).length,
    slaBreached: tickets.filter((t) => t.slaStatus === "breached").length,
    slaApproaching: tickets.filter((t) => t.slaStatus === "approaching").length,
  }), [tickets]);

  const runBulk = async (
    label: string,
    ids: number[],
    action: (id: number) => Promise<unknown>,
  ) => {
    setBulkPending(true);
    const results = await Promise.allSettled(ids.map(action));
    const failures = results.filter((r) => r.status === "rejected").length;
    const successes = ids.length - failures;
    await loadTickets();
    setBulkPending(false);
    if (failures === 0) {
      toast({ title: `${label} ${successes} ticket${successes === 1 ? "" : "s"}` });
      clearSelection();
    } else if (successes === 0) {
      toast({
        title: `Failed to ${label.toLowerCase()} tickets`,
        description: `${failures} ticket${failures === 1 ? "" : "s"} could not be updated.`,
        variant: "destructive",
      });
    } else {
      toast({
        title: `${label} ${successes} of ${ids.length} tickets`,
        description: `${failures} failed; selection kept so you can retry.`,
        variant: "destructive",
      });
      setSelectedIds(() => {
        const next = new Set<number>();
        results.forEach((r, i) => {
          if (r.status === "rejected") next.add(ids[i]);
        });
        return next;
      });
    }
  };

  const handleBulkAssign = (value: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const assignedTo = value === "__unassigned" ? null : Number(value);
    if (value !== "__unassigned" && Number.isNaN(assignedTo as number)) return;
    const assigneeName =
      assignedTo === null ? "Unassigned" : assignees.find((a) => a.id === assignedTo)?.name ?? "agent";
    void runBulk(`Assigned to ${assigneeName} —`, ids, (id) =>
      adminPanelApi.updateTicketAssignee(id, assignedTo as number | null),
    );
  };

  const handleBulkClose = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    void runBulk("Closed", ids, (id) => adminPanelApi.updateTicketStatus(id, "closed"));
  };

  // Selected tickets that are actually retryable (failed/skipped delivery).
  // The bulk "Retry delivery" button only acts on these so a mixed selection
  // doesn't fire no-op retries against already-delivered tickets.
  const selectedUndelivered = useMemo(
    () =>
      tickets
        .filter(
          (t) =>
            selectedIds.has(t.id) &&
            (t.deliveryStatus === "failed" || t.deliveryStatus === "skipped"),
        )
        .map((t) => t.id),
    [tickets, selectedIds],
  );

  const handleBulkRetry = () => {
    if (selectedUndelivered.length === 0) return;
    void runBulk("Retried delivery for", selectedUndelivered, (id) =>
      adminPanelApi.retryTicketDelivery(id),
    );
  };

  const handleRetryDelivery = async (id: number) => {
    setRetryingIds((prev) => new Set(prev).add(id));
    try {
      await adminPanelApi.retryTicketDelivery(id);
      toast({ title: "Delivery retry queued" });
      await loadTickets();
    } catch (err) {
      toast({
        title: "Failed to retry delivery",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Ticket Queue</h1>
          <p className="text-muted-foreground">Manage support tickets</p>
        </div>

        <div className="grid grid-cols-5 gap-4">
          <Card className="p-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-sm text-muted-foreground">Total Tickets</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl font-bold">{stats.open}</div>
            <div className="text-sm text-muted-foreground">Open</div>
          </Card>
          <Card className="p-4 border-red-200 bg-red-50/50">
            <div className="text-2xl font-bold text-red-700">{stats.slaBreached}</div>
            <div className="text-sm text-red-600">SLA Breached</div>
          </Card>
          <Card className="p-4 border-amber-200 bg-amber-50/50">
            <div className="text-2xl font-bold text-amber-700">{stats.slaApproaching}</div>
            <div className="text-sm text-amber-600">Approaching SLA</div>
          </Card>
          <Card className="p-4 border-blue-200 bg-blue-50/50">
            <div className="text-2xl font-bold text-blue-700">{stats.unassigned}</div>
            <div className="text-sm text-blue-600">Unassigned</div>
          </Card>
        </div>

        <Card>
          <div className="flex border-b border-border">
            {(
              [
                { key: "all", label: "All Tickets", count: tickets.length },
                { key: "support", label: "Support", count: tickets.filter((t) => SUPPORT_CATEGORIES.includes(t.category)).length },
                { key: "concierge_compliance", label: "Concierge & Compliance", count: ccCount },
              ] as const
            ).map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => { setViewFilter(key); setCategoryFilter("all"); }}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  viewFilter === key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`view-tab-${key}`}
              >
                {label}
                {count > 0 && (
                  <span className={`ml-2 text-xs rounded-full px-1.5 py-0.5 font-medium ${
                    viewFilter === key ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>
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
              <Select value={slaFilter} onValueChange={setSlaFilter}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="SLA" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All SLA</SelectItem>
                  <SelectItem value="breached">Breached</SelectItem>
                  <SelectItem value="approaching">Approaching</SelectItem>
                  <SelectItem value="within">Within</SelectItem>
                  <SelectItem value="__none">No SLA</SelectItem>
                </SelectContent>
              </Select>
              <Select value={tierFilter} onValueChange={setTierFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Tier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tiers</SelectItem>
                  {tiers.map((t) => (
                    <SelectItem key={t} value={t}>{TIER_LABELS[t] ?? t}</SelectItem>
                  ))}
                  <SelectItem value="__none">No tier</SelectItem>
                </SelectContent>
              </Select>
              <Select value={deliveryFilter} onValueChange={setDeliveryFilter}>
                <SelectTrigger className="w-[150px]" data-testid="delivery-filter"><SelectValue placeholder="Delivery" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Delivery</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
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
              {viewFilter === "all" && (
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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

          {selectedIds.size > 0 && (
            <div
              className="px-4 py-3 bg-blue-50 border-b border-blue-200 flex items-center gap-3 flex-wrap"
              data-testid="bulk-action-bar"
            >
              <span className="text-sm font-medium text-blue-900">
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                <Select
                  value=""
                  onValueChange={handleBulkAssign}
                  disabled={bulkPending}
                >
                  <SelectTrigger className="w-[200px] bg-white" data-testid="bulk-assign-trigger">
                    <SelectValue placeholder="Assign to…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned">Unassigned</SelectItem>
                    {assignees.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkClose}
                  disabled={bulkPending}
                  data-testid="bulk-close-button"
                >
                  Close
                </Button>
                {selectedUndelivered.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBulkRetry}
                    disabled={bulkPending}
                    data-testid="bulk-retry-delivery-button"
                  >
                    <RefreshCw className="w-4 h-4 mr-1" /> Retry delivery ({selectedUndelivered.length})
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                  disabled={bulkPending}
                  className="text-muted-foreground"
                >
                  <X className="w-4 h-4 mr-1" /> Clear selection
                </Button>
              </div>
            </div>
          )}

          <div className="divide-y divide-border">
            <div className="grid grid-cols-[36px_1fr_100px_120px_110px_140px_160px_140px] gap-2 px-4 py-2.5 bg-secondary/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider items-center">
              <div>
                <Checkbox
                  checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                  onCheckedChange={(v) => toggleAllVisible(v === true)}
                  disabled={filteredIds.length === 0 || bulkPending}
                  aria-label="Select all visible tickets"
                  data-testid="bulk-select-all"
                />
              </div>
              <div>Ticket</div>
              <div>Priority</div>
              <div>SLA</div>
              <div>Tier</div>
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
              filtered.map((ticket) => {
                const isSelected = selectedIds.has(ticket.id);
                return (
                  <Link key={ticket.id} href={`/admin/tickets/${ticket.id}`}>
                    <div
                      className={cn(
                        "grid grid-cols-[36px_1fr_100px_120px_110px_140px_160px_140px] gap-2 px-4 py-3 transition-colors items-center cursor-pointer",
                        slaRowTint(ticket.slaStatus),
                        isSelected && "bg-blue-50/40",
                      )}
                    >
                      <div
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(v) => toggleRow(ticket.id, v === true)}
                          disabled={bulkPending}
                          aria-label={`Select ticket ${ticket.ticketNumber}`}
                          data-testid={`bulk-select-row-${ticket.id}`}
                        />
                      </div>
                      <div className="group">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
                          {ticket.member?.name && (
                            <span className="text-xs text-muted-foreground">· {ticket.member.name}</span>
                          )}
                          {ticket.source === "voice_call" && (
                            // Voice-agent escalations arrive by phone, so the
                            // caller's number + question live in the body. The
                            // badge lets agents spot phone-origin tickets at a
                            // glance without opening each one.
                            <Badge
                              variant="outline"
                              className="gap-1 border-violet-300 bg-violet-50 text-violet-900 text-[10px]"
                              data-testid={`queue-voice-source-badge-${ticket.id}`}
                            >
                              <Phone className="w-3 h-3" />
                              Voice call
                            </Badge>
                          )}
                          <DeliveryBadge status={ticket.deliveryStatus} />
                          {(ticket.deliveryStatus === "failed" || ticket.deliveryStatus === "skipped") && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void handleRetryDelivery(ticket.id);
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              disabled={retryingIds.has(ticket.id) || bulkPending}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border border-border bg-white hover:bg-secondary/40 text-foreground disabled:opacity-50"
                              data-testid={`queue-retry-delivery-${ticket.id}`}
                              title="Retry notification delivery"
                            >
                              <RefreshCw className={cn("w-3 h-3", retryingIds.has(ticket.id) && "animate-spin")} />
                              {retryingIds.has(ticket.id) ? "Retrying…" : "Retry"}
                            </button>
                          )}
                          {(ticket.deliveryStatus === "failed" || ticket.deliveryStatus === "skipped") &&
                            ticket.deliveryLastError && (
                              <span
                                className="text-[10px] text-red-700 max-w-[24rem] truncate"
                                title={ticket.deliveryLastError}
                                data-testid={`queue-delivery-error-${ticket.id}`}
                              >
                                {ticket.deliveryLastError}
                              </span>
                            )}
                        </div>
                        <h4 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">{ticket.subject}</h4>
                      </div>
                      <div><PriorityBadge priority={ticket.priority} /></div>
                      <div><SlaBadge status={ticket.slaStatus} /></div>
                      <div><TierBadge tier={ticket.tier} /></div>
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
                );
              })
            )}
          </div>
        </Card>
      </div>
    </AdminLayout>
  );
}
