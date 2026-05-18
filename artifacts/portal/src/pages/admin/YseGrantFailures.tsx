import { useEffect, useState, useCallback } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  RefreshCw,
  Loader2,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type PendingGrant = Awaited<
  ReturnType<typeof adminPanelApi.getYsePendingGrants>
>["items"][number];
type RetryStatus = Awaited<
  ReturnType<typeof adminPanelApi.getYsePendingGrants>
>["status"];

export default function YseGrantFailures() {
  const [items, setItems] = useState<PendingGrant[]>([]);
  const [status, setStatus] = useState<RetryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      // Request the backend's maximum so the page reflects the full
      // backlog rather than the default 100. The endpoint caps at 500.
      const data = await adminPanelApi.getYsePendingGrants(500);
      setItems(data.items);
      setStatus(data.status);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRetry = async (id: number) => {
    setRetryingId(id);
    try {
      await adminPanelApi.retryYseGrant(id);
      toast({ title: "Retry succeeded" });
      await load();
    } catch (err: any) {
      toast({
        title: "Retry failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setRetryingId(null);
    }
  };

  const terminalCount = items.filter((i) => i.terminal).length;
  const pendingCount = items.length - terminalCount;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1
              className="text-2xl font-bold flex items-center gap-2"
              data-testid="heading-yse-grant-failures"
            >
              <AlertTriangle className="w-6 h-6" /> YSE Grant Failures
            </h1>
            <p className="text-muted-foreground mt-1">
              Paying customers whose YSE grant delivery is still pending or has
              exhausted automatic retries.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            data-testid="button-yse-failures-refresh"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-1" />
            )}
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card data-testid="card-yse-pending-count">
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Pending (will retry)
              </div>
              <div className="text-2xl font-bold mt-1">{pendingCount}</div>
            </CardContent>
          </Card>
          <Card data-testid="card-yse-terminal-count">
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Terminal (retries exhausted)
              </div>
              <div
                className={`text-2xl font-bold mt-1 ${terminalCount > 0 ? "text-red-600" : ""}`}
              >
                {terminalCount}
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-yse-last-sweep">
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Last sweep
              </div>
              <div className="text-sm font-medium mt-2">
                {status?.lastRanAt
                  ? format(new Date(status.lastRanAt), "MMM d, h:mm:ss a")
                  : "Never"}
              </div>
              {status && (
                <div className="text-xs text-muted-foreground mt-1">
                  {status.lastSucceeded} succeeded, {status.lastFailed} failed
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Undelivered grants</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading...
              </div>
            ) : items.length === 0 ? (
              <div
                className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2"
                data-testid="text-yse-failures-empty"
              >
                <CheckCircle2 className="w-8 h-8 text-green-600" />
                All YSE grants have been delivered.
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-3 text-xs font-medium text-muted-foreground">
                      Customer
                    </th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">
                      Order
                    </th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">
                      Products
                    </th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">
                      Attempts
                    </th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">
                      Last error
                    </th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">
                      Next retry
                    </th>
                    <th className="p-3 text-xs font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((g) => (
                    <tr
                      key={g.id}
                      className="hover:bg-muted/30 transition-colors align-top"
                      data-testid={`row-yse-grant-${g.id}`}
                    >
                      <td className="p-3 text-sm">
                        {g.customerEmail || (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 text-sm font-mono">
                        <div>{g.externalOrderId || g.externalId}</div>
                        {g.externalSource && (
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                            {g.externalSource}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-sm">
                        <div className="flex flex-wrap gap-1">
                          {g.productSlugs.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            g.productSlugs.map((slug) => (
                              <Badge
                                key={slug}
                                variant="outline"
                                className="text-[10px]"
                              >
                                {slug}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-sm whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              g.terminal ? "text-red-600 font-medium" : ""
                            }
                            data-testid={`text-yse-attempts-${g.id}`}
                          >
                            {g.attempts} / {g.maxAttempts}
                          </span>
                          {g.terminal && (
                            <Badge
                              className="text-[10px] bg-red-100 text-red-800 border-transparent"
                              data-testid={`badge-yse-terminal-${g.id}`}
                            >
                              Terminal
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground max-w-xs">
                        {g.errorMessage ? (
                          <span
                            className="break-words"
                            title={g.errorMessage}
                          >
                            {g.errorMessage}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {g.terminal ? (
                          <span>Will not auto-retry</span>
                        ) : g.nextRetryAt ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {format(new Date(g.nextRetryAt), "MMM d, h:mm a")}
                          </span>
                        ) : (
                          "ASAP"
                        )}
                      </td>
                      <td className="p-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRetry(g.id)}
                          disabled={retryingId === g.id}
                          data-testid={`button-retry-yse-${g.id}`}
                        >
                          {retryingId === g.id ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3 mr-1" />
                          )}
                          Retry now
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
