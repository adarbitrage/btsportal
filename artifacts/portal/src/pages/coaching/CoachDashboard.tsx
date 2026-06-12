import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusPill } from "@/components/coaching/StatusPill";
import {
  useGetCoachDashboardSummary,
  useListCoachMentees,
  type CoachMenteeRow,
  type MenteeStatus,
  type ListCoachMenteesStatus,
} from "@workspace/api-client-react";
import { useUnreadCount, useThreads } from "@/hooks/use-dm";
import { Users, AlertTriangle, Moon, Zap, ChevronUp, ChevronDown, Search, X, Loader2, MessageSquare } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterStatus = MenteeStatus | "all";
type SortKey = "name" | "tier" | "joined_at" | "last_active" | "current_section" | "completion_pct" | "daily_streak" | "status";

// ---------------------------------------------------------------------------
// Summary tiles
// ---------------------------------------------------------------------------

interface SummaryTileProps {
  title: string;
  value: number | string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
  onClick?: () => void;
  active?: boolean;
}

function SummaryTile({ title, value, sub, icon: Icon, accent = "text-primary", onClick, active }: SummaryTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-5 flex flex-col gap-2 transition-all shadow-sm
        ${onClick ? "cursor-pointer hover:shadow-md" : "cursor-default"}
        ${active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "bg-white border-border"}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold tracking-widest text-muted-foreground uppercase">{title}</span>
        <Icon className={`w-5 h-5 ${accent} opacity-70`} />
      </div>
      <span className={`text-3xl font-bold ${accent}`}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

const FILTERS: { label: string; value: FilterStatus }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Stuck", value: "stuck" },
  { label: "Dormant", value: "dormant" },
  { label: "New", value: "new" },
  { label: "Completed", value: "completed" },
];

// ---------------------------------------------------------------------------
// Column config
// ---------------------------------------------------------------------------

interface ColConfig {
  key: SortKey;
  label: string;
  sortable: boolean;
  className?: string;
}

const COLUMNS: ColConfig[] = [
  { key: "name",            label: "Name",         sortable: true,  className: "w-[220px]" },
  { key: "tier",            label: "Tier",         sortable: true,  className: "w-[110px]" },
  { key: "joined_at",       label: "Joined",       sortable: true,  className: "w-[100px]" },
  { key: "last_active",     label: "Last Active",  sortable: true,  className: "w-[120px]" },
  { key: "current_section", label: "Current Step", sortable: true,  className: "flex-1 min-w-[160px]" },
  { key: "completion_pct",  label: "Completion",   sortable: true,  className: "w-[130px]" },
  { key: "daily_streak",    label: "Streak",       sortable: true,  className: "w-[80px]" },
  { key: "status",          label: "Status",       sortable: true,  className: "w-[110px]" },
];

// ---------------------------------------------------------------------------
// Sort helpers — map UI SortKey to API sort param
// ---------------------------------------------------------------------------

function toApiSort(key: SortKey, asc: boolean): string {
  const MAP: Partial<Record<SortKey, string>> = {
    last_active:    "last_active",
    completion_pct: "completion_pct",
    daily_streak:   "daily_streak",
    joined_at:      "joined_at",
  };
  const base = MAP[key] ?? "last_active";
  return asc ? `-${base}` : base;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CoachDashboard() {
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortAsc, setSortAsc] = useState(false);

  // Accumulated mentees for load-more pagination
  const [allMentees, setAllMentees] = useState<CoachMenteeRow[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const { data: summary } = useGetCoachDashboardSummary();

  const apiSort = (sortKey === "status" || sortKey === "name" || sortKey === "tier" || sortKey === "current_section")
    ? "last_active"
    : toApiSort(sortKey, sortAsc);

  const listParams = {
    status: filter !== "all" ? filter as ListCoachMenteesStatus : undefined,
    search: debouncedSearch || undefined,
    sort: apiSort,
    cursor,
    limit: 100,
  };

  const { data: listData, isLoading: listLoading, isError } = useListCoachMentees(listParams);

  // Accumulate pages when data arrives
  useEffect(() => {
    if (!listData) return;
    if (cursor === undefined) {
      setAllMentees(listData.mentees);
    } else {
      setAllMentees(prev => [...prev, ...listData.mentees]);
    }
    setTotal(listData.total);
    setNextCursor(listData.next_cursor ?? null);
    setIsLoadingMore(false);
  }, [listData]);

  // Reset on filter/search/sort change
  useEffect(() => {
    setAllMentees([]);
    setCursor(undefined);
    setNextCursor(null);
    setTotal(null);
  }, [filter, debouncedSearch, apiSort]);

  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedSearch(val), 300);
  }, []);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(a => !a);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  function handleLoadMore() {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    setCursor(nextCursor);
  }

  // Client-side sort for columns not handled server-side
  const sorted = [...allMentees].sort((a, b) => {
    if (sortKey === "name") {
      return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    }
    if (sortKey === "tier") {
      return sortAsc ? a.tier.localeCompare(b.tier) : b.tier.localeCompare(a.tier);
    }
    if (sortKey === "status") {
      const ORDER: Record<MenteeStatus, number> = { stuck: 0, active: 1, new: 2, dormant: 3, completed: 4 };
      const diff = (ORDER[a.status] ?? 5) - (ORDER[b.status] ?? 5);
      if (diff !== 0) return sortAsc ? -diff : diff;
      const aTime = a.last_active_at ? new Date(a.last_active_at).getTime() : 0;
      const bTime = b.last_active_at ? new Date(b.last_active_at).getTime() : 0;
      return bTime - aTime;
    }
    if (sortKey === "current_section") {
      const aStep = a.current_section?.id ?? 0;
      const bStep = b.current_section?.id ?? 0;
      return sortAsc ? aStep - bStep : bStep - aStep;
    }
    return 0;
  });

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronUp className="w-3 h-3 opacity-20" />;
    return sortAsc
      ? <ChevronUp className="w-3 h-3 text-primary" />
      : <ChevronDown className="w-3 h-3 text-primary" />;
  }

  const isFirstPageLoading = listLoading && cursor === undefined && allMentees.length === 0;

  const { data: unreadData } = useUnreadCount();
  const { data: threads } = useThreads();
  const unreadCount = unreadData?.unreadCount ?? 0;
  const recentThreads = (threads ?? []).slice(0, 3);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Coach Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Blitz progress overview for all mentees</p>
        </div>

        {/* Messages inbox strip */}
        <Card className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">
                  Messages
                  {unreadCount > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-[10px] font-bold bg-destructive text-destructive-foreground">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {recentThreads.length > 0
                    ? `${recentThreads.length} conversation${recentThreads.length !== 1 ? "s" : ""}${unreadCount > 0 ? ` · ${unreadCount} unread` : ""}`
                    : "No conversations yet"}
                </p>
              </div>
            </div>
            <Link href="/coach/messages">
              <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                <MessageSquare className="w-4 h-4" />
                Open Inbox
              </Button>
            </Link>
          </div>
          {recentThreads.length > 0 && (
            <div className="mt-3 divide-y border rounded-lg overflow-hidden">
              {recentThreads.map((t) => (
                <Link key={t.id} href={`/coach/messages/${t.id}`}>
                  <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold shrink-0">
                      {t.otherParty.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs font-${t.unreadCount > 0 ? "semibold" : "medium"} truncate block`}>
                        {t.otherParty.name}
                      </span>
                      {t.lastMessagePreview && (
                        <span className="text-[11px] text-muted-foreground truncate block">
                          {t.lastMessagePreview}
                        </span>
                      )}
                    </div>
                    {t.unreadCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full text-[10px] font-semibold bg-destructive text-destructive-foreground shrink-0">
                        {t.unreadCount}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryTile
            title="Total Mentees"
            value={summary?.total_mentees ?? "—"}
            sub={summary ? `Median ${summary.median_completion_pct}% complete` : undefined}
            icon={Users}
            onClick={() => setFilter("all")}
            active={filter === "all"}
          />
          <SummaryTile
            title="Active"
            value={summary?.by_status.active ?? "—"}
            sub="Activity in last 7 days"
            icon={Zap}
            accent="text-green-600"
            onClick={() => setFilter("active")}
            active={filter === "active"}
          />
          <SummaryTile
            title="Stuck · Needs Attention"
            value={summary?.by_status.stuck ?? "—"}
            sub="Logged in but no recent blitz"
            icon={AlertTriangle}
            accent="text-amber-600"
            onClick={() => setFilter("stuck")}
            active={filter === "stuck"}
          />
          <SummaryTile
            title="Dormant"
            value={summary?.by_status.dormant ?? "—"}
            sub="No login in 14+ days"
            icon={Moon}
            accent="text-gray-500"
            onClick={() => setFilter("dormant")}
            active={filter === "dormant"}
          />
        </div>

        {/* Filters + search */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(f => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors
                  ${filter === f.value
                    ? "bg-primary text-white border-primary"
                    : "bg-white text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"}`}
              >
                {f.label}
                {f.value !== "all" && summary ? ` (${summary.by_status[f.value as MenteeStatus] ?? 0})` : ""}
              </button>
            ))}
          </div>

          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search name or email…"
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(""); setDebouncedSearch(""); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      className={`text-left px-4 py-3 text-xs font-bold tracking-wider text-muted-foreground uppercase select-none ${col.className ?? ""}
                        ${col.sortable ? "cursor-pointer hover:text-foreground" : ""}`}
                      onClick={col.sortable ? () => handleSort(col.key) : undefined}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        {col.sortable && <SortIcon col={col.key} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isFirstPageLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {COLUMNS.map(col => (
                        <td key={col.key} className="px-4 py-4">
                          <div className="h-4 bg-secondary rounded w-3/4" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : isError ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-muted-foreground">
                      Failed to load mentees. Please refresh.
                    </td>
                  </tr>
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-2">
                        {filter === "stuck" && <AlertTriangle className="w-8 h-8 text-amber-400" />}
                        {filter === "dormant" && <Moon className="w-8 h-8 text-gray-400" />}
                        {filter === "active" && <Zap className="w-8 h-8 text-green-400" />}
                        {(filter === "all" || filter === "new" || filter === "completed") && (
                          <Users className="w-8 h-8 text-muted-foreground/40" />
                        )}
                        <p className="text-muted-foreground font-medium">
                          {debouncedSearch
                            ? `No mentees match "${debouncedSearch}"`
                            : filter === "all"
                              ? "No mentees found"
                              : `No ${filter} mentees right now`}
                        </p>
                        {filter !== "all" && (
                          <Button variant="ghost" size="sm" onClick={() => setFilter("all")}>
                            View all mentees
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  sorted.map(mentee => (
                    <tr
                      key={mentee.user_id}
                      className="hover:bg-secondary/40 cursor-pointer transition-colors"
                      onClick={() => navigate(`/coach/mentees/${mentee.user_id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-foreground leading-tight">{mentee.name}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">{mentee.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-secondary border border-border rounded px-1.5 py-0.5 font-mono">
                          {mentee.tier_name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {format(new Date(mentee.joined_at), "MMM d, yyyy")}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {mentee.last_active_at
                          ? formatDistanceToNow(new Date(mentee.last_active_at), { addSuffix: true })
                          : <span className="italic">Never</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-foreground">
                        {mentee.current_section
                          ? <span className="line-clamp-2">{mentee.current_section.name}</span>
                          : <span className="text-muted-foreground italic">Not started</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Progress value={mentee.blitz_completion_pct} className="h-1.5 w-16 flex-shrink-0" />
                          <span className="text-xs font-semibold text-foreground w-8 text-right">
                            {mentee.blitz_completion_pct}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold text-foreground">
                        {mentee.daily_streak > 0 ? `${mentee.daily_streak}d` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={mentee.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer: count + load more */}
          {!isFirstPageLoading && !isError && total !== null && (
            <div className="px-4 py-3 border-t border-border bg-secondary/30 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing {sorted.length} of {total} mentee{total !== 1 ? "s" : ""}
              </span>
              {nextCursor && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="h-7 text-xs"
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Loading…
                    </>
                  ) : (
                    `Load more (${total - sorted.length} remaining)`
                  )}
                </Button>
              )}
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
