import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, Download, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";

/**
 * Read filter + deep-link params from `window.location.search`. Used so other
 * admin pages (notably System Health) can deep-link into a specific audit row
 * — e.g. `/admin/audit-log?actionType=queue_fallback&expand=42` opens the page
 * pre-filtered to queue_fallback rows and auto-expands row #42.
 */
function readUrlParams() {
  if (typeof window === "undefined") {
    return { actionType: "", entityType: "", startDate: "", endDate: "", expand: null as number | null };
  }
  const sp = new URLSearchParams(window.location.search);
  const expandRaw = sp.get("expand");
  const expand = expandRaw && /^\d+$/.test(expandRaw) ? Number.parseInt(expandRaw, 10) : null;
  return {
    actionType: sp.get("actionType") ?? "",
    entityType: sp.get("entityType") ?? "",
    startDate: sp.get("startDate") ?? "",
    endDate: sp.get("endDate") ?? "",
    expand,
  };
}

const PAGE_LIMIT = 50;

export default function AuditLog() {
  const initialParams = readUrlParams();
  const [logs, setLogs] = useState<any[]>([]);
  // Keyset cursors returned by the API. `next` walks toward older rows,
  // `prev` walks toward newer rows. Either can be null at the boundaries.
  const [cursors, setCursors] = useState<{ next: string | null; prev: string | null }>({ next: null, prev: null });
  // Total rows matching the active filters and the server-enforced export
  // cap. Both come from the API on filter changes (the cursor-paginated
  // calls intentionally skip the COUNT(*) so paging stays cheap), so we
  // hold the most recent values across pagination here.
  const [totalMatching, setTotalMatching] = useState<number | null>(null);
  const [exportCap, setExportCap] = useState<number>(10000);
  const [filters, setFilters] = useState({
    actionType: initialParams.actionType,
    entityType: initialParams.entityType,
    startDate: initialParams.startDate,
    endDate: initialParams.endDate,
  });
  const [expandedId, setExpandedId] = useState<number | null>(initialParams.expand);
  const [loading, setLoading] = useState(true);
  const pendingExpandRef = useRef<number | null>(initialParams.expand);
  // Held only for the very first fetch — once the API has returned the
  // window centered on the deep-linked row we don't want to keep relocating
  // on every filter change or paginate click.
  const initialExpandRef = useRef<number | null>(initialParams.expand);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const { toast } = useToast();

  const load = async (opts?: { cursor?: string; direction?: "forward" | "backward" }) => {
    try {
      setLoading(true);
      const expand = initialExpandRef.current;
      // When deep-linked via `?expand=<id>`, ask the API for the window that
      // contains the row (O(log n) lookup) instead of paging through the
      // filtered view by hand. After the first load we drop the expand id
      // so subsequent paginate clicks navigate normally.
      const data = await adminPanelApi.getAuditLog({
        ...filters,
        limit: PAGE_LIMIT,
        ...(expand != null
          ? { expand }
          : opts?.cursor
            ? { cursor: opts.cursor, direction: opts.direction ?? "forward" }
            : {}),
      });
      setLogs(data.logs);
      setCursors(data.cursors ?? { next: null, prev: null });
      // The API only returns `total` on filter-changing fetches (initial
      // load and the deep-link `expand=` path) — cursor pagination skips it
      // to stay O(log n + page_size). Keep the prior count when it's null
      // so the UI doesn't flicker as the user clicks Newer/Older.
      const apiTotal = data.pagination?.total;
      if (typeof apiTotal === "number") setTotalMatching(apiTotal);
      if (typeof data.exportCap === "number") setExportCap(data.exportCap);
      if (expand != null) initialExpandRef.current = null;
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Filter changes always restart at the newest page (cursors are filter-
  // specific, so a stale cursor would be meaningless under new filters).
  useEffect(() => { load(); }, [filters]);

  // After the logs render, scroll the deep-linked row into view (one-shot —
  // we don't want to keep auto-scrolling every time the user clicks a row).
  useEffect(() => {
    const target = pendingExpandRef.current;
    if (target == null || loading) return;
    const node = rowRefs.current[target];
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      pendingExpandRef.current = null;
    }
  }, [loading, logs]);

  const handleExport = async (fmt: string) => {
    try {
      const res = await adminPanelApi.exportAuditLog(fmt, filters);

      // The server streams the full result set in chunks and no longer
      // computes an upfront `count(*)` for the export header — that count
      // was the dominant cost on multi-million-row audit logs. The await
      // on res.blob() below only resolves once the entire stream has
      // arrived, so by the time we show the toast the download really
      // is complete; we pull the matched count from the read endpoint's
      // `totalMatching` (already in state for the "N matching rows"
      // display) so the toast still surfaces a row count without the
      // server having to recompute one per export.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);

      if (totalMatching != null && totalMatching > 0) {
        const cappedCount = Math.min(totalMatching, exportCap);
        toast({
          title: "Export complete",
          description: `Exported ${cappedCount.toLocaleString()} row${cappedCount === 1 ? "" : "s"}.`,
        });
      } else {
        toast({ title: "Export complete" });
      }
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  };

  const hasNewer = cursors.prev !== null;
  const hasOlder = cursors.next !== null;
  const willTruncate = totalMatching != null && totalMatching > exportCap;
  // Date-range hint for the current page. Logs are returned newest-first
  // (descending by createdAt), so logs[0] is the newest row in the visible
  // window and logs[last] is the oldest. Computing these client-side avoids
  // an extra server round-trip and naturally tracks filters + pagination.
  const pageRange = (() => {
    if (logs.length === 0) return null;
    const parse = (raw: any) => {
      if (!raw) return null;
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const newest = parse(logs[0]?.createdAt);
    const oldest = parse(logs[logs.length - 1]?.createdAt);
    if (!newest || !oldest) return null;
    return { newest, oldest };
  })();
  const formatRangeBoundary = (d: Date) => format(d, "MMM d, yyyy h:mm a");
  const pageRangeLabel = pageRange
    ? pageRange.newest.getTime() === pageRange.oldest.getTime()
      ? formatRangeBoundary(pageRange.newest)
      : `${formatRangeBoundary(pageRange.newest)} → ${formatRangeBoundary(pageRange.oldest)}`
    : null;
  const exportRowCount = totalMatching == null
    ? null
    : Math.min(totalMatching, exportCap);
  const exportTooltip = totalMatching == null
    ? "Loading row count…"
    : willTruncate
      ? `Your filters match ${totalMatching.toLocaleString()} rows, but exports are capped at ${exportCap.toLocaleString()}. Narrow the date range or add filters to capture all rows.`
      : `Exports all ${totalMatching.toLocaleString()} matching row${totalMatching === 1 ? "" : "s"}.`;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ScrollText className="w-6 h-6" /> Audit Log
            </h1>
            <p className="text-muted-foreground mt-1">Track all admin actions</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end text-right">
              <span
                className="text-sm font-medium text-foreground"
                data-testid="audit-total-matching"
              >
                {totalMatching == null
                  ? "Counting…"
                  : `${totalMatching.toLocaleString()} matching row${totalMatching === 1 ? "" : "s"}`}
              </span>
              {pageRangeLabel && (
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="audit-page-range"
                  title="Date range of the entries on this page"
                >
                  {pageRangeLabel}
                </span>
              )}
              {willTruncate && (
                <span
                  className="text-xs text-destructive flex items-center gap-1"
                  data-testid="audit-export-truncated-warning"
                >
                  <AlertTriangle className="w-3 h-3" />
                  Export will be capped at {exportCap.toLocaleString()}
                </span>
              )}
            </div>
            <TooltipProvider>
              <div className="flex gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExport("csv")}
                      data-testid="audit-export-csv"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      CSV{exportRowCount != null ? ` (${exportRowCount.toLocaleString()})` : ""}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{exportTooltip}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExport("json")}
                      data-testid="audit-export-json"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      JSON{exportRowCount != null ? ` (${exportRowCount.toLocaleString()})` : ""}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{exportTooltip}</TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3">
              <Select value={filters.actionType} onValueChange={(v) => setFilters({ ...filters, actionType: v === "all" ? "" : v })}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Action Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="create">Create</SelectItem>
                  <SelectItem value="update">Update</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="grant_product">Grant Product</SelectItem>
                  <SelectItem value="revoke_product">Revoke Product</SelectItem>
                  <SelectItem value="impersonate_start">Impersonation</SelectItem>
                  <SelectItem value="update_setting">Setting Change</SelectItem>
                  <SelectItem value="regenerate_password">Password regenerated</SelectItem>
                  <SelectItem value="notify_password">Password notification sent</SelectItem>
                  <SelectItem value="unlock_account">Unlock account</SelectItem>
                  <SelectItem value="queue_fallback">Queue fallback</SelectItem>
                  <SelectItem value="queue_fallback_alert">Queue fallback alert</SelectItem>
                  <SelectItem value="auth_rate_limit_blocked">Auth rate limit blocked</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filters.entityType} onValueChange={(v) => setFilters({ ...filters, entityType: v === "all" ? "" : v })}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Entity Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entities</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="ticket">Ticket</SelectItem>
                  <SelectItem value="admin_note">Admin Note</SelectItem>
                  <SelectItem value="system_setting">System Setting</SelectItem>
                  <SelectItem value="flexy_credentials">Flexy credentials</SelectItem>
                  <SelectItem value="communication">Communication</SelectItem>
                  <SelectItem value="queue">Queue</SelectItem>
                  <SelectItem value="alert">Alert</SelectItem>
                  <SelectItem value="auth_rate_limit">Auth rate limit</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" className="w-40" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} placeholder="Start Date" />
              <Input type="date" className="w-40" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} placeholder="End Date" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : logs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No audit log entries found</div>
            ) : (
              <div className="divide-y">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    ref={(node) => { rowRefs.current[log.id] = node; }}
                    className={initialParams.expand === log.id ? "ring-2 ring-primary/40 ring-inset" : undefined}
                    data-testid={`audit-row-${log.id}`}
                  >
                    <div className="flex items-center gap-4 p-4 hover:bg-muted/30 cursor-pointer transition-colors" onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{log.description}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[10px]">{log.actionType}</Badge>
                          <Badge variant="secondary" className="text-[10px]">{log.entityType}</Badge>
                          {log.actorEmail && <span className="text-[10px] text-muted-foreground">{log.actorEmail}</span>}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {log.createdAt ? format(new Date(log.createdAt), "MMM d, yyyy h:mm a") : ""}
                      </span>
                      {expandedId === log.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    {expandedId === log.id && (
                      <div className="px-4 pb-4 bg-muted/20">
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div><span className="text-muted-foreground">Entity ID:</span> {log.entityId || "N/A"}</div>
                          <div><span className="text-muted-foreground">IP Address:</span> {log.ipAddress || "N/A"}</div>
                          <div><span className="text-muted-foreground">User Agent:</span> <span className="truncate block max-w-md">{log.userAgent || "N/A"}</span></div>
                          <div><span className="text-muted-foreground">Actor ID:</span> {log.actorId || "N/A"}</div>
                          {log.actionType === "queue_fallback" && (
                            <>
                              <div><span className="text-muted-foreground">Channel:</span> {log.metadata?.channel || "N/A"}</div>
                              <div><span className="text-muted-foreground">Recipient:</span> {log.metadata?.recipient || "redacted"}</div>
                              {log.metadata?.reason && (
                                <div><span className="text-muted-foreground">Reason:</span> {log.metadata.reason}</div>
                              )}
                            </>
                          )}
                          {log.actionType === "queue_fallback_alert" && (
                            <>
                              <div data-testid={`alert-queue-channel-${log.id}`}>
                                <span className="text-muted-foreground">Queue Channel:</span>{" "}
                                {log.metadata?.queueChannel
                                  ? String(log.metadata.queueChannel).toUpperCase()
                                  : "N/A"}
                              </div>
                              <div data-testid={`alert-delivery-channel-${log.id}`}>
                                <span className="text-muted-foreground">Delivery Channel:</span>{" "}
                                {log.metadata?.deliveryChannel || "N/A"}
                              </div>
                              <div data-testid={`alert-kind-${log.id}`}>
                                <span className="text-muted-foreground">Kind:</span>{" "}
                                {log.metadata?.kind === "fire" ? (
                                  <Badge variant="warning" className="text-[10px] normal-case tracking-normal">Fire</Badge>
                                ) : log.metadata?.kind === "clear" ? (
                                  <Badge variant="success" className="text-[10px] normal-case tracking-normal">Clear</Badge>
                                ) : (
                                  "N/A"
                                )}
                              </div>
                              <div data-testid={`alert-outcome-${log.id}`}>
                                <span className="text-muted-foreground">Outcome:</span>{" "}
                                {log.metadata?.outcome === "sent" ? (
                                  <Badge variant="success" className="text-[10px] normal-case tracking-normal">Sent</Badge>
                                ) : log.metadata?.outcome === "failed" ? (
                                  <Badge className="text-[10px] normal-case tracking-normal border-transparent bg-red-100 text-red-800">Failed</Badge>
                                ) : log.metadata?.outcome === "throttled" ? (
                                  <Badge variant="warning" className="text-[10px] normal-case tracking-normal">Throttled</Badge>
                                ) : log.metadata?.outcome === "skipped" ? (
                                  <Badge variant="secondary" className="text-[10px] normal-case tracking-normal">Skipped</Badge>
                                ) : (
                                  "N/A"
                                )}
                              </div>
                              <div className="col-span-2" data-testid={`alert-reason-${log.id}`}>
                                <span className="text-muted-foreground">Reason:</span>{" "}
                                {log.metadata?.reason || <span className="text-muted-foreground italic">none</span>}
                              </div>
                            </>
                          )}
                        </div>
                        {log.changeDiff && (
                          <div className="mt-3">
                            <p className="text-xs text-muted-foreground mb-1">Changes:</p>
                            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(log.changeDiff, null, 2)}</pre>
                          </div>
                        )}
                        {log.metadata && log.actionType !== "queue_fallback" && log.actionType !== "queue_fallback_alert" && (
                          <div className="mt-3">
                            <p className="text-xs text-muted-foreground mb-1">Metadata:</p>
                            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(log.metadata, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {(hasNewer || hasOlder) && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <p className="text-sm text-muted-foreground">
                {logs.length > 0
                  ? totalMatching != null
                    ? `Showing ${logs.length.toLocaleString()} of ${totalMatching.toLocaleString()} entr${totalMatching === 1 ? "y" : "ies"}`
                    : `Showing ${logs.length.toLocaleString()} entr${logs.length === 1 ? "y" : "ies"}`
                  : ""}
              </p>
              {pageRangeLabel && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="audit-page-range-footer"
                >
                  {pageRangeLabel}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNewer || loading}
                onClick={() => cursors.prev && load({ cursor: cursors.prev, direction: "backward" })}
                data-testid="audit-page-newer"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />Newer
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasOlder || loading}
                onClick={() => cursors.next && load({ cursor: cursors.next, direction: "forward" })}
                data-testid="audit-page-older"
              >
                Older<ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
