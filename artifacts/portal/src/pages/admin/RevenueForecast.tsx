import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  TrendingUp,
  RefreshCw,
  Save,
  Info,
  Calendar,
  DollarSign,
} from "lucide-react";
import { useRevenueForecast, useSubmitManualData } from "@/lib/revenue-api";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { RevenueSubNav } from "./RevenueDashboard";

const forecastConfig: ChartConfig = {
  projected: { label: "Projected MRR", color: "#3b82f6" },
  actual: { label: "Actual MRR", color: "#10b981" },
  upper: { label: "Upper Bound", color: "#93c5fd" },
  lower: { label: "Lower Bound", color: "#93c5fd" },
};

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export default function RevenueForecast() {
  const { data, isLoading, error } = useRevenueForecast();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const submitManualData = useSubmitManualData();

  const [month, setMonth] = useState("");
  const [adSpend, setAdSpend] = useState("");
  const [leadCount, setLeadCount] = useState("");
  const [conversionRate, setConversionRate] = useState("");

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/revenue/forecast"] });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!month || !adSpend) {
      toast({ title: "Month and Ad Spend are required", variant: "destructive" });
      return;
    }
    submitManualData.mutate(
      {
        month,
        adSpend: parseFloat(adSpend),
        otherMetrics: {
          ...(leadCount ? { leadCount: parseFloat(leadCount) } : {}),
          ...(conversionRate ? { conversionRate: parseFloat(conversionRate) } : {}),
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Data submitted successfully" });
          setMonth("");
          setAdSpend("");
          setLeadCount("");
          setConversionRate("");
          queryClient.invalidateQueries({ queryKey: ["/api/admin/revenue"] });
        },
        onError: (err: Error) => {
          toast({ title: "Failed to submit data", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const chartData = data?.forecast.map((point) => ({
    ...point,
    confidenceRange: [point.lower, point.upper],
  }));

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Revenue Forecast</h1>
            <p className="text-muted-foreground mt-1">
              Projected MRR with confidence intervals and manual data input
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>

        <RevenueSubNav active="/admin/revenue/forecast" />

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading forecast data...</div>
        ) : error ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">
                Forecast data is not yet available. The metrics engine backend needs to be configured.
              </p>
              <Button variant="outline" className="mt-4" onClick={handleRefresh}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : data ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  MRR Forecast with Confidence Interval
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={forecastConfig} className="h-[400px]">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={(v) => formatCurrency(v)} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="upper"
                      stroke="none"
                      fill="var(--color-upper)"
                      fillOpacity={0.15}
                    />
                    <Area
                      type="monotone"
                      dataKey="lower"
                      stroke="none"
                      fill="#ffffff"
                      fillOpacity={1}
                    />
                    <Line
                      type="monotone"
                      dataKey="projected"
                      stroke="var(--color-projected)"
                      strokeWidth={2}
                      dot={false}
                      strokeDasharray="6 3"
                    />
                    <Line
                      type="monotone"
                      dataKey="actual"
                      stroke="var(--color-actual)"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Info className="w-4 h-4" />
                    Key Assumptions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Monthly Churn Rate</span>
                      <span className="text-sm font-medium">{(data.assumptions.churnRate * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Monthly Growth Rate</span>
                      <span className="text-sm font-medium">{(data.assumptions.growthRate * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm text-muted-foreground">Avg Revenue Per Member</span>
                      <span className="text-sm font-medium">{formatCurrency(data.assumptions.avgRevenuePerMember)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    Manual Data Input
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="month">Month</Label>
                        <Input
                          id="month"
                          type="month"
                          value={month}
                          onChange={(e) => setMonth(e.target.value)}
                          placeholder="2026-03"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="adSpend">Ad Spend ($)</Label>
                        <Input
                          id="adSpend"
                          type="number"
                          value={adSpend}
                          onChange={(e) => setAdSpend(e.target.value)}
                          placeholder="5000"
                          min="0"
                          step="0.01"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="leadCount">Lead Count (optional)</Label>
                        <Input
                          id="leadCount"
                          type="number"
                          value={leadCount}
                          onChange={(e) => setLeadCount(e.target.value)}
                          placeholder="150"
                          min="0"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="conversionRate">Conversion Rate % (optional)</Label>
                        <Input
                          id="conversionRate"
                          type="number"
                          value={conversionRate}
                          onChange={(e) => setConversionRate(e.target.value)}
                          placeholder="3.5"
                          min="0"
                          max="100"
                          step="0.1"
                        />
                      </div>
                    </div>
                    <Button type="submit" disabled={submitManualData.isPending} className="w-full">
                      <Save className="w-4 h-4 mr-2" />
                      {submitManualData.isPending ? "Submitting..." : "Submit Data"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </AppLayout>
  );
}
