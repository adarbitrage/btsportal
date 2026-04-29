import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, Download, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, AlertTriangle, CalendarSearch, Loader2, X } from "lucide-react";
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
// Allow-list mirrored from the server's `AlertDeliveryOutcome` union — used
// both to defend a deep-linked `?outcome=` value and to render the Select.
const ALERT_OUTCOME_OPTIONS = ["sent", "failed", "throttled", "skipped"] as const;
type AlertOutcomeFilter = "" | typeof ALERT_OUTCOME_OPTIONS[number];

function normaliseOutcome(raw: string | null): AlertOutcomeFilter {
  if (!raw) return "";
  return (ALERT_OUTCOME_OPTIONS as readonly string[]).includes(raw) ? (raw as AlertOutcomeFilter) : "";
}

// Parse a `?jumpTo=` query value into a normalized ISO string. We accept any
// `Date`-parseable input (so `2026-04-22T12:00:00Z`, `2026-04-22T12:00`, etc.
// all work when an admin hand-edits the URL) but always normalize to an ISO
// string before threading it through state — that's what the server expects
// and what we want back in the URL after the user clicks Jump.
function normaliseJumpTo(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Convert an ISO timestamp into the `YYYY-MM-DDTHH:mm` shape that an
// `<input type="datetime-local">` expects. The picker is always rendered in
// the admin's local timezone, so we read the local fields off the Date.
function isoToDateTimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function readUrlParams() {
  if (typeof window === "undefined") {
    return { actionType: "", entityType: "", startDate: "", endDate: "", outcome: "" as AlertOutcomeFilter, expand: null as number | null, jumpTo: null as string | null };
  }
  const sp = new URLSearchParams(window.location.search);
  const expandRaw = sp.get("expand");
  const expand = expandRaw && /^\d+$/.test(expandRaw) ? Number.parseInt(expandRaw, 10) : null;
  return {
    actionType: sp.get("actionType") ?? "",
    entityType: sp.get("entityType") ?? "",
    startDate: sp.get("startDate") ?? "",
    endDate: sp.get("endDate") ?? "",
    outcome: normaliseOutcome(sp.get("outcome")),
    expand,
    jumpTo: normaliseJumpTo(sp.get("jumpTo")),
  };
}

// Update `?jumpTo=` in the current URL without triggering a navigation. We
// use replaceState (not pushState) so the back button doesn't accumulate one
// history entry per Jump click — the URL is meant for sharing the current
// view, not browsing through past jumps. We also drop `?expand=` because
// the user has explicitly signaled intent to jump to a time rather than
// pin a specific row, and expand wins over jumpTo in load() — leaving
// both in the URL would mean a freshly-shared link landed on the row
// instead of the jump instant the admin just chose.
function writeJumpToToUrl(iso: string | null) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (iso) {
    params.set("jumpTo", iso);
    params.delete("expand");
  } else {
    params.delete("jumpTo");
  }
  const qs = params.toString();
  const cleanUrl = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
  window.history.replaceState({}, "", cleanUrl);
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
  const [filters, setFilters] = useState<{
    actionType: string;
    entityType: string;
    startDate: string;
    endDate: string;
    outcome: AlertOutcomeFilter;
  }>({
    actionType: initialParams.actionType,
    entityType: initialParams.entityType,
    startDate: initialParams.startDate,
    endDate: initialParams.endDate,
    outcome: initialParams.outcome,
  });
  const [expandedId, setExpandedId] = useState<number | null>(initialParams.expand);
  const [loading, setLoading] = useState(true);
  const pendingExpandRef = useRef<number | null>(initialParams.expand);
  // Held only for the very first fetch — once the API has returned the
  // window centered on the deep-linked row we don't want to keep relocating
  // on every filter change or paginate click.
  const initialExpandRef = useRef<number | null>(initialParams.expand);
  // "Jump to date/time" control. The input is a `datetime-local` value
  // (browser-local "YYYY-MM-DDTHH:mm"); on submit we convert to an ISO
  // string and stash it in pendingJumpRef so the very next load() seeks
  // that timestamp on the server. The ref is cleared after dispatch so
  // subsequent Newer/Older clicks paginate normally via cursors.
  // When the page loads with `?jumpTo=<iso>` in the URL we pre-fill the
  // picker (rendered in the admin's local timezone) and prime the ref so
  // the very first fetch seeks to that instant — that's what makes the
  // shared deep-link land on the moment under discussion. We skip the
  // pre-prime when `?expand=` is also present because expand wins in
  // load() and we don't want to leak a stale jumpTo ref into a later call.
  const [jumpToValue, setJumpToValue] = useState(() =>
    isoToDateTimeLocalValue(initialParams.jumpTo),
  );
  const pendingJumpRef = useRef<string | null>(
    initialParams.expand == null ? initialParams.jumpTo : null,
  );
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  // Tracks an in-flight export so we can disable the buttons (no double
  // submits) and surface a streamed bytes/rows hint while a year-long
  // download is being pulled down. `null` whenever no export is running.
  const [exportProgress, setExportProgress] = useState<{
    fmt: "csv" | "json";
    bytesReceived: number;
    rowsReceived: number | null;
  } | null>(null);
  // Tracks the AbortController for the in-flight export so the Cancel
  // button can tear down the streaming fetch (and the reader loop) when
  // the admin realises the filters are wrong mid-download. Held in a ref
  // — not state — because we only need to call .abort() on it; nothing
  // about the controller itself drives rendering.
  const exportAbortRef = useRef<AbortController | null>(null);
  // Disambiguates "the user cancelled" from "the network blew up" when
  // the streaming fetch rejects with AbortError, so the catch block can
  // surface the right (neutral) toast.
  const exportCancelledRef = useRef(false);
  const { toast } = useToast();

  const load = async (opts?: { cursor?: string; direction?: "forward" | "backward" }) => {
    try {
      setLoading(true);
      const expand = initialExpandRef.current;
      const jumpTo = pendingJumpRef.current;
      // Three pinned modes for the request, in order of priority:
      // 1) `expand=<id>` deep-link — server returns a window centered on
      //    the row (O(log n) lookup).
      // 2) `jumpTo=<iso>` — server seeks the first matching row at-or-before
      //    the chosen instant via the (created_at, id) index.
      // 3) `cursor=…` — normal Newer/Older paging. With nothing set we get
      //    the default newest-first page.
      // expand and jumpTo are one-shot: cleared after dispatch so follow-up
      // paginate clicks navigate by cursor and don't keep re-jumping.
      const data = await adminPanelApi.getAuditLog({
        ...filters,
        limit: PAGE_LIMIT,
        ...(expand != null
          ? { expand }
          : jumpTo != null
            ? { jumpTo }
            : opts?.cursor
              ? { cursor: opts.cursor, direction: opts.direction ?? "forward" }
              : {}),
      });
      setLogs(data.logs);
      setCursors(data.cursors ?? { next: null, prev: null });
      // The API only returns `total` on filter-changing fetches (initial
      // load, deep-link `expand=`, and `jumpTo=`) — cursor pagination skips
      // it to stay O(log n + page_size). Keep the prior count when it's
      // null so the UI doesn't flicker as the user clicks Newer/Older.
      const apiTotal = data.pagination?.total;
      if (typeof apiTotal === "number") setTotalMatching(apiTotal);
      if (typeof data.exportCap === "number") setExportCap(data.exportCap);
      if (expand != null) initialExpandRef.current = null;
      if (jumpTo != null) {
        pendingJumpRef.current = null;
        if (data.jumpTo && data.jumpTo.found === false) {
          toast({
            title: "No entries at-or-before that time",
            description: "Use Newer to step forward from the chosen instant, or pick an earlier date.",
          });
        }
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Triggered by the "Jump to date/time" control. Converts the browser-local
  // datetime-local value into an ISO string (the server side uses `new Date`
  // and seeks the (created_at, id) index from there) and re-runs load().
  const handleJump = async () => {
    if (!jumpToValue) return;
    const parsed = new Date(jumpToValue);
    if (Number.isNaN(parsed.getTime())) {
      toast({ title: "Invalid date/time", description: "Pick a valid moment to jump to.", variant: "destructive" });
      return;
    }
    const iso = parsed.toISOString();
    pendingJumpRef.current = iso;
    // Reflect the chosen instant in the URL so an investigator can paste
    // their browser bar into chat and have the next person land on the
    // same moment. `?jumpTo=` lives alongside the other deep-link params
    // (?actionType, ?entityType, ?startDate, ?endDate, ?expand) — see
    // writeJumpToToUrl, which preserves any params already in the URL.
    writeJumpToToUrl(iso);
    await load();
  };

  // Format a Date as the browser-local "YYYY-MM-DDTHH:mm" string that an
  // <input type="datetime-local"> expects. We can't use `toISOString()` here
  // because that returns UTC — the picker would then display the wrong wall
  // time for any admin not in UTC.
  const toDateTimeLocalValue = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Used by the preset chips. Mirrors handleJump but takes a Date directly
  // so we don't have to round-trip through state (setJumpToValue would not
  // be visible inside the same tick, so we'd otherwise jump using the *prior*
  // value).
  const handleJumpToDate = async (d: Date) => {
    setJumpToValue(toDateTimeLocalValue(d));
    pendingJumpRef.current = d.toISOString();
    await load();
  };

  // Preset shortcuts for the most common incident-response jumps. All
  // computed against the admin's local clock at click-time so e.g. "Today
  // 9am" really means 9am today in their timezone.
  const jumpPresets: { label: string; compute: () => Date }[] = [
    { label: "1 hour ago", compute: () => new Date(Date.now() - 60 * 60 * 1000) },
    { label: "24 hours ago", compute: () => new Date(Date.now() - 24 * 60 * 60 * 1000) },
    {
      label: "Today 9am",
      compute: () => {
        const d = new Date();
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
    {
      label: "Yesterday 9am",
      compute: () => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
    { label: "1 week ago", compute: () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  ];

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

  const handleExport = async (fmt: "csv" | "json") => {
    // Belt-and-braces: the buttons are also disabled while an export runs,
    // but a stale Enter key / double-tap could still re-enter this handler
    // before React re-renders the disabled state.
    if (exportProgress) return;
    const controller = new AbortController();
    exportAbortRef.current = controller;
    exportCancelledRef.current = false;
    setExportProgress({ fmt, bytesReceived: 0, rowsReceived: null });
    try {
      // The server streams the full result set in chunks and no longer
      // computes an upfront `count(*)` for the export header — that count
      // was the dominant cost on multi-million-row audit logs. We read
      // the body as a stream so we can surface a "downloading…" hint
      // during the multi-second pull on large queries; the helper only
      // resolves once every byte has arrived, so by the time we show the
      // toast the download really is complete. The matched count for the
      // toast comes from the read endpoint's `totalMatching` (already in
      // state for the "N matching rows" display) so the toast still
      // surfaces an authoritative row count.
      const { blob } = await adminPanelApi.exportAuditLog(
        fmt,
        filters,
        (progress) => {
          setExportProgress({ fmt, ...progress });
        },
        controller.signal,
      );
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
      // The streaming fetch rejects with AbortError both when the user
      // hits Cancel (exportCancelledRef set) and when the page is
      // navigated away. Either way, treat it as a neutral cancellation
      // rather than a destructive "Export failed" toast.
      const isAbort =
        err?.name === "AbortError" ||
        controller.signal.aborted ||
        exportCancelledRef.current;
      if (isAbort) {
        toast({ title: "Export cancelled" });
      } else {
        toast({ title: "Export failed", description: err.message, variant: "destructive" });
      }
    } finally {
      exportAbortRef.current = null;
      exportCancelledRef.current = false;
      setExportProgress(null);
    }
  };

  // Wired to the Cancel button next to the in-flight progress hint.
  // Aborts the streaming fetch (which collapses the reader loop in the
  // API helper), and the server's `res.on("close")` handler then stops
  // walking batches and shuts the response down cleanly.
  const handleCancelExport = () => {
    if (!exportAbortRef.current) return;
    exportCancelledRef.current = true;
    exportAbortRef.current.abort();
  };

  // Human-readable size formatter for the in-flight progress hint. We don't
  // need TB precision — audit log exports cap out well under that.
  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
              <div className="flex flex-col items-end gap-1">
                <div className="flex gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExport("csv")}
                        disabled={exportProgress !== null}
                        aria-busy={exportProgress?.fmt === "csv"}
                        data-testid="audit-export-csv"
                      >
                        {exportProgress?.fmt === "csv" ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4 mr-1" />
                        )}
                        {exportProgress?.fmt === "csv"
                          ? "Exporting…"
                          : `CSV${exportRowCount != null ? ` (${exportRowCount.toLocaleString()})` : ""}`}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {exportProgress?.fmt === "csv"
                        ? "Streaming the export — please don't close the tab."
                        : exportTooltip}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExport("json")}
                        disabled={exportProgress !== null}
                        aria-busy={exportProgress?.fmt === "json"}
                        data-testid="audit-export-json"
                      >
                        {exportProgress?.fmt === "json" ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4 mr-1" />
                        )}
                        {exportProgress?.fmt === "json"
                          ? "Exporting…"
                          : `JSON${exportRowCount != null ? ` (${exportRowCount.toLocaleString()})` : ""}`}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {exportProgress?.fmt === "json"
                        ? "Streaming the export — please don't close the tab."
                        : exportTooltip}
                    </TooltipContent>
                  </Tooltip>
                </div>
                {exportProgress && (
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs text-muted-foreground"
                      role="status"
                      aria-live="polite"
                      data-testid="audit-export-progress"
                    >
                      Downloading…{" "}
                      {exportProgress.rowsReceived != null && exportProgress.rowsReceived > 0
                        ? `${exportProgress.rowsReceived.toLocaleString()} rows · `
                        : ""}
                      {formatBytes(exportProgress.bytesReceived)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={handleCancelExport}
                      data-testid="audit-export-cancel"
                      aria-label="Cancel export"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Cancel
                    </Button>
                  </div>
                )}
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
                  <SelectItem value="signup_notice_suppressed">Signup notice suppressed</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filters.outcome === "" ? "all" : filters.outcome}
                onValueChange={(v) =>
                  setFilters({
                    ...filters,
                    outcome: v === "all" ? "" : (v as AlertOutcomeFilter),
                  })
                }
              >
                <SelectTrigger
                  className="w-40"
                  data-testid="audit-filter-outcome"
                  title="Filter alert rows by delivery outcome (queue_fallback_alert)"
                >
                  <SelectValue placeholder="Alert Outcome" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Outcomes</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="throttled">Throttled</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
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
                  <SelectItem value="auth_signup_notice_suppression">Signup notice suppression</SelectItem>
                  <SelectItem value="oncall_destinations">On-call destinations</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" className="w-40" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} placeholder="Start Date" />
              <Input type="date" className="w-40" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} placeholder="End Date" />
              <div className="flex flex-col items-end gap-1 ml-auto">
                <div
                  className="flex items-center gap-2"
                  data-testid="audit-jump-to-control"
                >
                  <label
                    htmlFor="audit-jump-to-input"
                    className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1"
                    title="Seek the first audit entry at-or-before the chosen date/time"
                  >
                    <CalendarSearch className="w-3.5 h-3.5" />
                    Jump to:
                  </label>
                  <Input
                    id="audit-jump-to-input"
                    type="datetime-local"
                    className="w-56"
                    value={jumpToValue}
                    onChange={(e) => setJumpToValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleJump();
                      }
                    }}
                    data-testid="audit-jump-to-input"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!jumpToValue || loading}
                    onClick={handleJump}
                    data-testid="audit-jump-to-button"
                  >
                    Jump
                  </Button>
                </div>
                <div
                  className="flex flex-wrap items-center justify-end gap-1"
                  data-testid="audit-jump-presets"
                >
                  <span className="text-xs text-muted-foreground mr-1">
                    Quick jump:
                  </span>
                  {jumpPresets.map((preset) => (
                    <Button
                      key={preset.label}
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={loading}
                      onClick={() => void handleJumpToDate(preset.compute())}
                      data-testid={`audit-jump-preset-${preset.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
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
                          {log.actionType === "cancel_email_change" && (
                            <>
                              {/* Structured snapshot of the cancelled email-change attempt.
                                  Member email and the cancelled target address are PII —
                                  the audit-log endpoint strips them from `metadata` for
                                  viewers without `members:pii`, so we surface "redacted"
                                  in their place rather than guessing or omitting the row.
                                  `before.pendingEmail` is the same value as
                                  `previousPendingEmail` and is shown as a fallback for
                                  legacy rows written before the structured field landed.
                                  Cancelled-at is the audit log's own createdAt. */}
                              <div data-testid={`cancel-email-member-${log.id}`}>
                                <span className="text-muted-foreground">Member:</span>{" "}
                                {log.metadata?.memberEmail || (
                                  <span className="text-muted-foreground italic">redacted</span>
                                )}
                              </div>
                              <div data-testid={`cancel-email-target-${log.id}`}>
                                <span className="text-muted-foreground">Cancelled target:</span>{" "}
                                {log.metadata?.previousPendingEmail ||
                                  log.metadata?.before?.pendingEmail || (
                                    <span className="text-muted-foreground italic">redacted</span>
                                  )}
                              </div>
                              <div data-testid={`cancel-email-cancelled-at-${log.id}`}>
                                <span className="text-muted-foreground">Cancelled at:</span>{" "}
                                {log.createdAt
                                  ? format(new Date(log.createdAt), "MMM d, yyyy h:mm a")
                                  : "N/A"}
                              </div>
                              <div data-testid={`cancel-email-cancelled-by-${log.id}`}>
                                <span className="text-muted-foreground">Cancelled by:</span>{" "}
                                {log.actorEmail || (log.actorId ? `admin #${log.actorId}` : "an admin")}
                              </div>
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
                              {/* Fallback frequency context — the same recent / 1h / 24h
                                  counts that the on-call email/Slack/PagerDuty alert
                                  carries. Lets admins reading the audit row see *how
                                  bad* the incident was without bouncing back to
                                  System Health. `recentWindowMs` is rounded to whole
                                  minutes (matching the alerter's `Math.round(ms/60000)`
                                  in queue-fallback-alerter.ts) and then floored to 1m
                                  so a sub-minute window never displays as the
                                  nonsensical "in last 0m". All five fields are
                                  written together by `recordDeliveryAttempt`, so
                                  if any are missing this is a legacy row from before
                                  task #188 — render nothing rather than confusing
                                  the admin with "0 in last 0m". */}
                              {(() => {
                                const m = log.metadata ?? {};
                                const hasFreq =
                                  typeof m.recentCount === "number" &&
                                  typeof m.hourCount === "number" &&
                                  typeof m.dayCount === "number" &&
                                  typeof m.recentWindowMs === "number";
                                if (!hasFreq) return null;
                                const recentMinutes = Math.max(1, Math.round(m.recentWindowMs / 60000));
                                const lastAt = m.lastAt
                                  ? (() => {
                                      const d = new Date(m.lastAt);
                                      return Number.isNaN(d.getTime())
                                        ? String(m.lastAt)
                                        : format(d, "MMM d, yyyy h:mm a");
                                    })()
                                  : "n/a";
                                return (
                                  <div
                                    className="col-span-2"
                                    data-testid={`alert-frequency-${log.id}`}
                                  >
                                    <span className="text-muted-foreground">Frequency:</span>{" "}
                                    Recent: {m.recentCount.toLocaleString()} in last {recentMinutes}m
                                    {" · "}1h: {m.hourCount.toLocaleString()}
                                    {" · "}24h: {m.dayCount.toLocaleString()}
                                    {" · "}Last: {lastAt}
                                  </div>
                                );
                              })()}
                            </>
                          )}
                        </div>
                        {log.changeDiff && (
                          <div className="mt-3">
                            <p className="text-xs text-muted-foreground mb-1">Changes:</p>
                            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(log.changeDiff, null, 2)}</pre>
                          </div>
                        )}
                        {log.metadata && log.actionType !== "queue_fallback" && log.actionType !== "queue_fallback_alert" && log.actionType !== "cancel_email_change" && (
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
