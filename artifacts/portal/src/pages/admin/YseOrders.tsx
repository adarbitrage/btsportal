import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ShoppingBag,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  Download,
  Loader2,
  AlertTriangle,
  RefreshCw,
  FileText,
} from "lucide-react";
import {
  adminPanelApi,
  saveBlobAsFile,
  type StreamDownloadProgress,
} from "@/lib/admin-panel-api";
import { formatDownloadProgress } from "@/lib/download-progress";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type YseOrder = Awaited<
  ReturnType<typeof adminPanelApi.getYseOrders>
>["orders"][number];

type PendingGrant = Awaited<
  ReturnType<typeof adminPanelApi.getYsePendingGrants>
>["items"][number];

type RetryStatus = Awaited<
  ReturnType<typeof adminPanelApi.getYsePendingGrants>
>["status"];

type SourceFilter = "yse" | "machine" | "any";

const SOURCE_LABELS: Record<string, string> = {
  yse: "YSE",
  machine: "Machine",
};

function sourceBadgeVariant(
  source: string,
): "default" | "secondary" | "outline" | "warning" {
  if (source === "machine") return "warning";
  if (source === "yse") return "default";
  return "secondary";
}

export default function YseOrders() {
  const [location] = useLocation();
  // Source is driven by the URL: /admin/integrations/machine → "machine",
  // /admin/integrations/yse → "yse". Keep them as separate routes so the
  // sidebar entry can deep-link and bookmarks stay stable, while reusing
  // the same component + endpoint behind the scenes.
  const initialSource: SourceFilter = useMemo(() => {
    if (location.startsWith("/admin/integrations/machine")) return "machine";
    return "yse";
  }, [location]);

  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(initialSource);
  const [btsRef, setBtsRef] = useState("");

  const [orders, setOrders] = useState<YseOrder[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  // Tracks an in-flight CSV export. Set to a progress sample for the
  // duration of the download so the button can flip to "Exporting…" and
  // disable itself, matching the Members / Audit Log / Comms Log
  // streaming-export pattern.
  const [exportProgress, setExportProgress] =
    useState<StreamDownloadProgress | null>(null);

  const [pending, setPending] = useState<PendingGrant[]>([]);
  const [retryStatus, setRetryStatus] = useState<RetryStatus | null>(null);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const { toast } = useToast();

  const errorMessage = (err: unknown, fallback: string): string => {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return fallback;
  };

  const load = async (page = 1) => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getYseOrders({
        page,
        search: search.trim() || undefined,
        source: sourceFilter,
        btsRef: btsRef.trim() || undefined,
      });
      setOrders(data.orders);
      setPagination(data.pagination);
    } catch (err: unknown) {
      toast({
        title: "Error",
        description: errorMessage(err, "Failed to load orders"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadPending = async () => {
    try {
      setPendingLoading(true);
      setPendingError(null);
      const data = await adminPanelApi.getYsePendingGrants(100);
      setPending(data.items);
      setRetryStatus(data.status);
    } catch (err: unknown) {
      setPendingError(errorMessage(err, "Failed to load failed grants"));
    } finally {
      setPendingLoading(false);
    }
  };

  const handleRetry = async (id: number) => {
    setRetryingId(id);
    try {
      await adminPanelApi.retryYseGrant(id);
      toast({ title: "Retry succeeded", description: "Grant was replayed." });
      await Promise.all([loadPending(), load(pagination.page)]);
    } catch (err: unknown) {
      toast({
        title: "Retry failed",
        description: errorMessage(err, "Unknown error"),
        variant: "destructive",
      });
    } finally {
      setRetryingId(null);
    }
  };

  const handleExport = async () => {
    // Belt-and-braces: the button is also disabled while an export runs,
    // but a stale Enter / double-tap could still re-enter this handler
    // before the disabled state has re-rendered.
    if (exportProgress) return;
    setExportProgress({ bytesReceived: 0, rowsReceived: null });
    try {
      const { blob } = await adminPanelApi.exportYseOrders(
        {
          search: search.trim() || undefined,
          source: sourceFilter,
          btsRef: btsRef.trim() || undefined,
        },
        (progress) => setExportProgress(progress),
      );
      const filenameSource = sourceFilter === "any" ? "external" : sourceFilter;
      saveBlobAsFile(blob, `${filenameSource}-orders-export.csv`);
      toast({ title: "Export complete" });
    } catch (err: unknown) {
      toast({
        title: "Export failed",
        description: errorMessage(err, "Unknown error"),
        variant: "destructive",
      });
    } finally {
      setExportProgress(null);
    }
  };

  useEffect(() => {
    setSourceFilter(initialSource);
  }, [initialSource]);

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter]);

  useEffect(() => {
    loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => load(1);

  const failedCount = pending.length;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1
              className="text-2xl font-bold flex items-center gap-2"
              data-testid="heading-yse-orders"
            >
              <ShoppingBag className="w-6 h-6" />{" "}
              {sourceFilter === "machine"
                ? "Machine Order History"
                : sourceFilter === "any"
                  ? "External Order History"
                  : "YSE Order History"}
            </h1>
            <p className="text-muted-foreground mt-1">
              {sourceFilter === "machine"
                ? "Grants provisioned through the Machine (getthemachine.com) integration, most recent first."
                : sourceFilter === "any"
                  ? "Grants from every external integration, most recent first."
                  : "Grants provisioned through the YSE integration, most recent first."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {exportProgress && (
              <span
                className="text-xs text-muted-foreground tabular-nums"
                aria-live="polite"
                data-testid="text-yse-export-progress"
              >
                {formatDownloadProgress({
                  bytesReceived: exportProgress.bytesReceived,
                  rowsReceived: exportProgress.rowsReceived,
                })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!!exportProgress}
              data-testid="button-export-yse-orders"
            >
              {exportProgress ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-1" />
              )}
              {exportProgress ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="granted" className="space-y-6">
          <TabsList>
            <TabsTrigger value="granted" data-testid="tab-yse-granted">
              Granted
            </TabsTrigger>
            <TabsTrigger
              value="failed"
              data-testid="tab-yse-failed"
              className="gap-2"
            >
              Failed / Stuck
              {failedCount > 0 && (
                <Badge
                  variant="warning"
                  className="text-[10px]"
                  data-testid="badge-yse-failed-count"
                >
                  {failedCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="granted" className="space-y-6">
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-3">
                  <div className="relative flex-1 min-w-[240px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      placeholder="Search by order ID or email..."
                      className="pl-10"
                      data-testid="input-yse-search"
                    />
                  </div>
                  <Input
                    value={btsRef}
                    onChange={(e) => setBtsRef(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder="Affiliate code (bts_ref)…"
                    className="w-56"
                    data-testid="input-yse-bts-ref"
                  />
                  <select
                    value={sourceFilter}
                    onChange={(e) =>
                      setSourceFilter(e.target.value as SourceFilter)
                    }
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    data-testid="select-yse-source"
                  >
                    <option value="yse">Source: YSE</option>
                    <option value="machine">Source: Machine</option>
                    <option value="any">Source: All</option>
                  </select>
                  <Button onClick={handleSearch} data-testid="button-yse-search">
                    Search
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-8 text-center text-muted-foreground">
                    Loading...
                  </div>
                ) : orders.length === 0 ? (
                  <div
                    className="p-8 text-center text-muted-foreground"
                    data-testid="text-yse-empty"
                  >
                    No orders found
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          Order ID
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          Source
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          Customer
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          Products
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          Affiliate / Funnel
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          Granted
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          New user?
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {orders.map((o) => (
                        <tr
                          key={`${o.externalSource}:${o.externalOrderId}:${o.userId}`}
                          className="hover:bg-muted/30 transition-colors"
                          data-testid={`row-yse-order-${o.externalOrderId}`}
                        >
                          <td className="p-4 text-sm font-mono">
                            {o.externalOrderId}
                          </td>
                          <td className="p-4">
                            <Badge
                              variant={sourceBadgeVariant(o.externalSource)}
                              className="text-[10px]"
                              data-testid={`badge-source-${o.externalOrderId}`}
                            >
                              {SOURCE_LABELS[o.externalSource] ||
                                o.externalSource}
                            </Badge>
                          </td>
                          <td className="p-4 text-sm">
                            <div className="font-medium">
                              {o.userName || "—"}
                            </div>
                            <div className="text-muted-foreground text-xs">
                              {o.userEmail}
                            </div>
                          </td>
                          <td className="p-4 text-sm">
                            <div className="flex flex-wrap gap-1">
                              {o.products.map((p) => (
                                <Badge
                                  key={p.slug || p.name}
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  {p.name}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="p-4 text-xs">
                            {o.btsRef ? (
                              <div
                                className="font-mono"
                                data-testid={`text-bts-ref-${o.externalOrderId}`}
                              >
                                {o.btsRef}
                              </div>
                            ) : (
                              <div className="text-muted-foreground">—</div>
                            )}
                            {o.funnelSlug && (
                              <div
                                className="text-muted-foreground mt-1"
                                data-testid={`text-funnel-slug-${o.externalOrderId}`}
                              >
                                {o.funnelSlug}
                              </div>
                            )}
                          </td>
                          <td className="p-4 text-sm text-muted-foreground">
                            {o.grantedAt
                              ? format(
                                  new Date(o.grantedAt),
                                  "MMM d, yyyy h:mm a",
                                )
                              : "—"}
                          </td>
                          <td className="p-4">
                            {o.wasNewUser ? (
                              <Badge className="text-[10px]">New</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">
                                Existing
                              </Badge>
                            )}
                          </td>
                          <td className="p-4">
                            <Link href={`/admin/members/${o.userId}`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                data-testid={`button-view-member-${o.userId}`}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {pagination.page} of {pagination.totalPages} (
                  {pagination.total} total)
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page <= 1}
                    onClick={() => load(pagination.page - 1)}
                    data-testid="button-yse-prev"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => load(pagination.page + 1)}
                    data-testid="button-yse-next"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="failed" className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-muted-foreground max-w-2xl">
                External grant attempts that haven't been provisioned yet —
                either retrying on backoff, or stuck after exhausting{" "}
                {retryStatus?.maxAttempts ?? 5} automatic attempts. Use "Retry
                now" to force a replay.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={loadPending}
                disabled={pendingLoading}
                data-testid="button-yse-failed-refresh"
              >
                <RefreshCw className="w-4 h-4 mr-1" /> Refresh
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                {pendingLoading ? (
                  <div className="p-8 text-center text-muted-foreground">
                    Loading...
                  </div>
                ) : pendingError ? (
                  <div
                    className="p-8 text-center text-destructive"
                    data-testid="text-yse-failed-error"
                  >
                    {pendingError}
                  </div>
                ) : pending.length === 0 ? (
                  <div
                    className="p-8 text-center text-muted-foreground"
                    data-testid="text-yse-failed-empty"
                  >
                    No failed or stuck grants — every external order has been
                    provisioned.
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          Order ID
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          Email
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          Status
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          Attempts
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          Last attempt
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          Next retry
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground">
                          Error
                        </th>
                        <th className="p-4 text-xs font-medium text-muted-foreground"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {pending.map((g) => (
                        <tr
                          key={g.id}
                          className="hover:bg-muted/30 transition-colors align-top"
                          data-testid={`row-yse-failed-${g.id}`}
                        >
                          <td className="p-4 text-sm font-mono">
                            <div>{g.externalOrderId || g.externalId}</div>
                            {g.productSlugs.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {g.productSlugs.map((s) => (
                                  <Badge
                                    key={s}
                                    variant="outline"
                                    className="text-[10px]"
                                  >
                                    {s}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="p-4 text-sm">
                            {g.customerEmail || "—"}
                          </td>
                          <td className="p-4 text-sm">
                            {g.terminal ? (
                              <Badge
                                variant="warning"
                                className="text-[10px] gap-1"
                              >
                                <AlertTriangle className="w-3 h-3" />
                                Needs review
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {g.status}
                              </Badge>
                            )}
                          </td>
                          <td className="p-4 text-sm text-muted-foreground">
                            {g.attempts} / {g.maxAttempts}
                          </td>
                          <td className="p-4 text-sm text-muted-foreground">
                            {g.lastAttemptAt
                              ? format(
                                  new Date(g.lastAttemptAt),
                                  "MMM d, yyyy h:mm a",
                                )
                              : "—"}
                          </td>
                          <td className="p-4 text-sm text-muted-foreground">
                            {g.terminal
                              ? "—"
                              : g.nextRetryAt
                                ? format(
                                    new Date(g.nextRetryAt),
                                    "MMM d, yyyy h:mm a",
                                  )
                                : "Pending"}
                          </td>
                          <td className="p-4 text-xs text-muted-foreground max-w-sm">
                            <div
                              className="break-words whitespace-pre-wrap line-clamp-3"
                              data-testid={`text-yse-failed-error-${g.id}`}
                              title={g.errorMessage || ""}
                            >
                              {g.errorMessage || "—"}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleRetry(g.id)}
                                disabled={retryingId === g.id}
                                data-testid={`button-yse-retry-${g.id}`}
                              >
                                <RefreshCw
                                  className={`w-4 h-4 mr-1 ${
                                    retryingId === g.id ? "animate-spin" : ""
                                  }`}
                                />
                                Retry now
                              </Button>
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    data-testid={`button-yse-payload-${g.id}`}
                                  >
                                    <FileText className="w-4 h-4 mr-1" />
                                    View payload
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl">
                                  <DialogHeader>
                                    <DialogTitle>
                                      Webhook log #{g.id} ·{" "}
                                      {g.externalOrderId || g.externalId}
                                    </DialogTitle>
                                  </DialogHeader>
                                  <div className="space-y-3">
                                    <div>
                                      <div className="text-xs font-medium text-muted-foreground mb-1">
                                        Error message
                                      </div>
                                      <pre
                                        className="text-xs bg-muted p-3 rounded whitespace-pre-wrap break-words"
                                        data-testid={`text-yse-dialog-error-${g.id}`}
                                      >
                                        {g.errorMessage || "—"}
                                      </pre>
                                    </div>
                                    <div>
                                      <div className="text-xs font-medium text-muted-foreground mb-1">
                                        Payload (PII-redacted, truncated to 2KB)
                                      </div>
                                      <pre
                                        className="text-xs bg-muted p-3 rounded whitespace-pre-wrap break-words max-h-96 overflow-auto"
                                        data-testid={`text-yse-payload-${g.id}`}
                                      >
                                        {g.payloadPreview || "—"}
                                      </pre>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      Full raw log entry: <code>GET /api/admin/webhook-logs/{g.id}</code>
                                    </p>
                                  </div>
                                </DialogContent>
                              </Dialog>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            {retryStatus && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="text-yse-retry-status"
              >
                Auto-retry sweep runs every{" "}
                {Math.round(retryStatus.intervalMs / 1000)}s
                {retryStatus.lastRanAt && (
                  <>
                    {" "}· last run{" "}
                    {format(
                      new Date(retryStatus.lastRanAt),
                      "MMM d, yyyy h:mm a",
                    )}{" "}
                    ({retryStatus.lastSucceeded} succeeded,{" "}
                    {retryStatus.lastFailed} failed)
                  </>
                )}
                {retryStatus.lastError && (
                  <>
                    {" "}· last error: {retryStatus.lastError.message}
                  </>
                )}
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
