import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, Download, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { useToast } from "@/hooks/use-toast";
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
      const truncated = res.headers.get("X-Audit-Log-Truncated") === "true";
      const totalCount = Number(res.headers.get("X-Audit-Log-Total-Count") || 0);
      const returnedCount = Number(res.headers.get("X-Audit-Log-Returned-Count") || 0);
      const cap = Number(res.headers.get("X-Audit-Log-Export-Cap") || 10000);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);

      if (truncated) {
        toast({
          title: "Export truncated",
          description: `Your filters matched ${totalCount.toLocaleString()} rows, but the export is capped at ${cap.toLocaleString()} (${returnedCount.toLocaleString()} included). Narrow the date range or add filters to capture all rows.`,
          variant: "destructive",
          duration: 10000,
        });
      } else if (totalCount > 0) {
        toast({
          title: "Export complete",
          description: `Exported ${returnedCount.toLocaleString()} row${returnedCount === 1 ? "" : "s"}.`,
        });
      }
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  };

  const hasNewer = cursors.prev !== null;
  const hasOlder = cursors.next !== null;

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
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleExport("csv")}><Download className="w-4 h-4 mr-1" />CSV</Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("json")}><Download className="w-4 h-4 mr-1" />JSON</Button>
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
                        </div>
                        {log.changeDiff && (
                          <div className="mt-3">
                            <p className="text-xs text-muted-foreground mb-1">Changes:</p>
                            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(log.changeDiff, null, 2)}</pre>
                          </div>
                        )}
                        {log.metadata && log.actionType !== "queue_fallback" && (
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
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {logs.length > 0 ? `Showing ${logs.length} entr${logs.length === 1 ? "y" : "ies"}` : ""}
            </p>
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
