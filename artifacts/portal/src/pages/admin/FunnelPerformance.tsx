import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { RefreshCw, Filter } from "lucide-react";
import { useFunnelPerformance } from "@/lib/revenue-api";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { RevenueSubNav } from "./RevenueDashboard";

const chartConfig: ChartConfig = {
  purchases: { label: "Purchases", color: "#3b82f6" },
  revenue: { label: "Revenue ($)", color: "#10b981" },
  avgLtv: { label: "Avg LTV ($)", color: "#8b5cf6" },
};

function formatCurrency(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export default function FunnelPerformance() {
  const { data, isLoading, error } = useFunnelPerformance();
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/revenue/funnels"] });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Funnel Performance</h1>
            <p className="text-muted-foreground mt-1">
              Compare front-end funnel performance side by side
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>

        <RevenueSubNav active="/admin/revenue/funnels" />

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading funnel data...</div>
        ) : error ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">
                Funnel data is not yet available. The metrics engine backend needs to be configured.
              </p>
              <Button variant="outline" className="mt-4" onClick={handleRefresh}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : data?.funnels ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Filter className="w-4 h-4" />
                  Funnel Comparison
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Funnel</TableHead>
                        <TableHead className="text-right">Purchases</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">Refund Rate</TableHead>
                        <TableHead className="text-right">Upgrade Rate</TableHead>
                        <TableHead className="text-right">Avg LTV</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.funnels.map((funnel) => (
                        <TableRow key={funnel.funnelName}>
                          <TableCell className="font-medium">{funnel.funnelName}</TableCell>
                          <TableCell className="text-right">{funnel.purchases.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(funnel.revenue)}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn(
                              "font-medium",
                              funnel.refundRate > 10 ? "text-red-600" : funnel.refundRate > 5 ? "text-yellow-600" : "text-green-600"
                            )}>
                              {funnel.refundRate.toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={cn(
                              "font-medium",
                              funnel.upgradeRate >= 30 ? "text-green-600" : funnel.upgradeRate >= 15 ? "text-yellow-600" : "text-red-600"
                            )}>
                              {funnel.upgradeRate.toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(funnel.avgLtv)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Funnel Metrics Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[350px]">
                  <BarChart data={data.funnels}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="funnelName" />
                    <YAxis yAxisId="left" tickFormatter={(v) => v.toLocaleString()} />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => formatCurrency(v)} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="purchases" fill="var(--color-purchases)" radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="right" dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="right" dataKey="avgLtv" fill="var(--color-avgLtv)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </AppLayout>
  );
}
