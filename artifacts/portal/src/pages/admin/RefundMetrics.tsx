import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts";
import { RefreshCw, Save } from "lucide-react";
import {
  useRefundRateBaseline,
  useSetRefundRateBaseline,
  useRefundCohortTrend,
  usePollerStatus,
  usePollNow,
} from "@/lib/refund-metrics-api";

const trendConfig: ChartConfig = {
  ratePercent: { label: "Partnered Cohort Rate", color: "#3b82f6" },
};

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}%`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

export default function RefundMetrics() {
  const [months, setMonths] = useState(12);
  const { data: baselineData, isLoading: baselineLoading } = useRefundRateBaseline();
  const { data: trendData, isLoading: trendLoading, refetch: refetchTrend } = useRefundCohortTrend(months);
  const { data: pollerStatus, refetch: refetchPollerStatus } = usePollerStatus();
  const setBaseline = useSetRefundRateBaseline();
  const pollNow = usePollNow();

  const [baselineInput, setBaselineInput] = useState("");

  useEffect(() => {
    if (baselineData?.baseline.baselinePercent !== null && baselineData?.baseline.baselinePercent !== undefined) {
      setBaselineInput(String(baselineData.baseline.baselinePercent));
    }
  }, [baselineData?.baseline.baselinePercent]);

  const handleSaveBaseline = () => {
    const parsed = parseFloat(baselineInput);
    if (Number.isNaN(parsed)) return;
    setBaseline.mutate(parsed);
  };

  const handlePollNow = async () => {
    await pollNow.mutateAsync();
    refetchTrend();
    refetchPollerStatus();
  };

  const latest = trendData?.trend[trendData.trend.length - 1];
  const baselinePercent = trendData?.baseline.baselinePercent ?? null;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Refund & Chargeback Metrics</h1>
            <p className="text-sm text-muted-foreground">
              Partnered-cohort refund/chargeback rate vs. baseline, sourced from a daily NMI poll.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handlePollNow} disabled={pollNow.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${pollNow.isPending ? "animate-spin" : ""}`} />
            Poll NMI Now
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Partnered Cohort Rate (latest month)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{formatPercent(latest?.ratePercent ?? null)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {trendData?.cohortAvailable
                  ? `${latest?.membersWithEvent ?? 0} of ${latest?.cohortSize ?? 0} partnered members`
                  : "No partnered cohort yet"}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Baseline Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={100}
                  value={baselineInput}
                  onChange={(e) => setBaselineInput(e.target.value)}
                  disabled={baselineLoading}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">%</span>
                <Button size="sm" onClick={handleSaveBaseline} disabled={setBaseline.isPending}>
                  <Save className="h-4 w-4" />
                </Button>
              </div>
              {baselineData?.baseline.updatedAt && (
                <div className="text-xs text-muted-foreground mt-1">
                  Updated {formatDate(baselineData.baseline.updatedAt)}
                  {baselineData.baseline.updatedBy ? ` by ${baselineData.baseline.updatedBy}` : ""}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Last Poll</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm">{formatDate(pollerStatus?.lastRanAt ?? null)}</div>
              {pollerStatus?.lastResult && (
                <div className="text-xs text-muted-foreground mt-1">
                  {pollerStatus.lastResult.eventsMatched} matched, {pollerStatus.lastResult.eventsUnmatched} unmatched
                </div>
              )}
              {pollerStatus?.lastError && (
                <Badge variant="destructive" className="mt-2">
                  Error: {pollerStatus.lastError.message}
                </Badge>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Monthly Trend</CardTitle>
            <div className="flex gap-1">
              {[6, 12, 24].map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={months === m ? "default" : "outline"}
                  onClick={() => setMonths(m)}
                >
                  {m}mo
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {!trendLoading && trendData && !trendData.cohortAvailable && (
              <p className="text-sm text-muted-foreground mb-4">
                No partnered members are assigned yet, so the cohort trend is empty. Once partner assignment is live,
                this chart will populate automatically.
              </p>
            )}
            <ChartContainer config={trendConfig} className="h-[300px] w-full">
              <LineChart data={trendData?.trend ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} unit="%" />
                <ChartTooltip content={<ChartTooltipContent />} />
                {baselinePercent !== null && (
                  <ReferenceLine
                    y={baselinePercent}
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                    label={{ value: "Baseline", position: "insideTopRight", fill: "#ef4444", fontSize: 11 }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="ratePercent"
                  stroke="var(--color-ratePercent)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
