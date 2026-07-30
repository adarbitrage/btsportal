import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useAdSpendReconciliations,
  useResolveAdSpendReconciliation,
  type AdSpendReconciliationRow,
} from "@/lib/ad-spend-reconciliation-api";

function formatCents(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function AdSpendReconciliation() {
  const { toast } = useToast();
  const [includeResolved, setIncludeResolved] = useState(false);
  const { data, isLoading, isError, error, refetch, isFetching } =
    useAdSpendReconciliations(includeResolved);
  const resolve = useResolveAdSpendReconciliation();
  const [resolvingOrder, setResolvingOrder] = useState<string | null>(null);

  const handleResolve = async (row: AdSpendReconciliationRow) => {
    setResolvingOrder(row.orderNumber);
    try {
      const result = await resolve.mutateAsync(row.orderNumber);
      toast({
        title: "Deposit reconciled",
        description:
          `Order ${result.orderNumber}: credited ${formatCents(result.creditedCents)} ` +
          `(charged ${formatCents(result.chargedCents)} incl. ${formatCents(result.feeCents)} card fee). ` +
          (result.creditInserted
            ? "Ledger credit written and receipt queued."
            : "Credit already existed — marked resolved and receipt queued."),
      });
    } catch (err) {
      toast({
        title: "Resolve failed",
        description: err instanceof Error ? err.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setResolvingOrder(null);
    }
  };

  const rows = data?.reconciliations ?? [];

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-5xl">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Ad-Spend Reconciliation</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Deposits that were charged successfully but never confirmed — the ledger credit and
              receipt are still missing. Resolving writes the credit (idempotently) and sends the
              member&apos;s receipt exactly once.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIncludeResolved((v) => !v)}
            >
              {includeResolved ? "Hide resolved" : "Show resolved"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              Stuck deposits
              {data && (
                <Badge variant={data.openCount > 0 ? "destructive" : "secondary"} className="ml-2">
                  {data.openCount} open
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-4">Loading open reconciliations…</p>
            ) : isError ? (
              <div className="flex items-center gap-2 text-sm text-destructive py-4">
                <AlertTriangle className="h-4 w-4" />
                <span>{error instanceof Error ? error.message : "Failed to load reconciliations"}</span>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>No stuck ad-spend deposits — nothing needs reconciliation.</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Order</th>
                      <th className="py-2 pr-4 font-medium">Member</th>
                      <th className="py-2 pr-4 font-medium">Charged</th>
                      <th className="py-2 pr-4 font-medium">Created</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const resolved = row.resolvedAt !== null;
                      return (
                        <tr key={row.orderNumber} className="border-b last:border-0 align-top">
                          <td className="py-3 pr-4 font-mono text-xs">{row.orderNumber}</td>
                          <td className="py-3 pr-4">
                            <div>{row.name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{row.email ?? "no linked user"}</div>
                          </td>
                          <td className="py-3 pr-4">{formatCents(row.chargedCents)}</td>
                          <td className="py-3 pr-4 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                          <td className="py-3 pr-4">
                            {resolved ? (
                              <div>
                                <Badge variant="secondary">Resolved</Badge>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {formatDate(row.resolvedAt)}
                                  {row.resolvedBy ? ` by ${row.resolvedBy}` : ""}
                                  {row.creditedCents !== null
                                    ? ` · credited ${formatCents(row.creditedCents)}`
                                    : ""}
                                </div>
                              </div>
                            ) : (
                              <Badge variant="destructive">Needs reconciliation</Badge>
                            )}
                          </td>
                          <td className="py-3 text-right">
                            {!resolved && (
                              <Button
                                size="sm"
                                onClick={() => handleResolve(row)}
                                disabled={resolvingOrder !== null}
                              >
                                {resolvingOrder === row.orderNumber ? "Resolving…" : "Resolve"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
