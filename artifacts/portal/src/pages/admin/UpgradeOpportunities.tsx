import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ArrowUpRight,
  RefreshCw,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { useUpgradeOpportunities } from "@/lib/revenue-api";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { RevenueSubNav } from "./RevenueDashboard";

const funnelConfig: ChartConfig = {
  count: { label: "Members", color: "#3b82f6" },
  conversionRate: { label: "Conversion %", color: "#10b981" },
};

export default function UpgradeOpportunities() {
  const { data, isLoading, error } = useUpgradeOpportunities();
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/revenue/upgrade-opportunities"] });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Upgrade Opportunities</h1>
            <p className="text-muted-foreground mt-1">
              Identify members most likely to upgrade their membership
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>

        <RevenueSubNav active="/admin/revenue/upgrade-opportunities" />

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading upgrade data...</div>
        ) : error ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">
                Upgrade data is not yet available. The metrics engine backend needs to be configured.
              </p>
              <Button variant="outline" className="mt-4" onClick={handleRefresh}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : data ? (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Top Upgrade Candidates
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Member</TableHead>
                          <TableHead>Current Product</TableHead>
                          <TableHead>Upgrade Prob.</TableHead>
                          <TableHead>Training</TableHead>
                          <TableHead>Last Active</TableHead>
                          <TableHead>Suggested</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.candidates.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>
                              <div>
                                <p className="text-sm font-medium">{c.name}</p>
                                <p className="text-xs text-muted-foreground">{c.email}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{c.currentProduct}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="w-12 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className={cn(
                                      "h-full rounded-full",
                                      c.upgradeProbability >= 70 ? "bg-green-500" : c.upgradeProbability >= 40 ? "bg-yellow-500" : "bg-gray-400"
                                    )}
                                    style={{ width: `${c.upgradeProbability}%` }}
                                  />
                                </div>
                                <span className={cn(
                                  "text-sm font-semibold",
                                  c.upgradeProbability >= 70 ? "text-green-600" : c.upgradeProbability >= 40 ? "text-yellow-600" : "text-gray-500"
                                )}>
                                  {c.upgradeProbability}%
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Progress value={c.trainingProgress} className="w-16 h-2" />
                                <span className="text-xs text-muted-foreground">{c.trainingProgress}%</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {format(new Date(c.lastActiveDate), "MMM d")}
                            </TableCell>
                            <TableCell>
                              <Badge className="text-xs bg-primary/10 text-primary hover:bg-primary/10">
                                <ArrowUpRight className="w-3 h-3 mr-1" />
                                {c.suggestedUpgrade}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                        {data.candidates.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                              No upgrade candidates found.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Upgrade Funnel
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.funnelMetrics.length > 0 ? (
                    <div className="space-y-4">
                      {data.funnelMetrics.map((stage, i) => (
                        <div key={stage.stage} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">{stage.stage}</span>
                            <span className="text-muted-foreground">{stage.count}</span>
                          </div>
                          <div className="w-full h-8 bg-gray-100 rounded relative overflow-hidden">
                            <div
                              className="h-full bg-primary/20 rounded flex items-center px-2"
                              style={{
                                width: `${i === 0 ? 100 : (stage.count / data.funnelMetrics[0].count) * 100}%`,
                              }}
                            >
                              <span className="text-xs font-medium text-primary">
                                {stage.conversionRate}%
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">No funnel data available.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </AppLayout>
  );
}
