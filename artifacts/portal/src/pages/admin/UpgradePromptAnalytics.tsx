import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, MousePointerClick, Eye, TrendingUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpgradePromptAnalytics } from "@/lib/revenue-api";
import { RevenueSubNav } from "./RevenueDashboard";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";

const dailyChartConfig: ChartConfig = {
  impressions: { label: "Impressions", color: "#3b82f6" },
  clicks: { label: "Clicks", color: "#10b981" },
  ctr: { label: "CTR (%)", color: "#f59e0b" },
};

function formatDayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: isoDateOnly(from), to: isoDateOnly(now) };
}

function formatVariant(variant: string): string {
  if (variant === "dashboard") return "Dashboard";
  if (variant === "sidebar") return "Sidebar";
  return variant;
}

function StatTile({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
          </div>
          <Icon className="w-8 h-8 text-primary opacity-60" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function UpgradePromptAnalytics() {
  const initial = useMemo(defaultRange, []);
  const [from, setFrom] = useState<string>(initial.from);
  const [to, setTo] = useState<string>(initial.to);
  const [appliedFrom, setAppliedFrom] = useState<string>(initial.from);
  const [appliedTo, setAppliedTo] = useState<string>(initial.to);

  const fromIso = useMemo(() => new Date(`${appliedFrom}T00:00:00.000Z`).toISOString(), [appliedFrom]);
  const toIso = useMemo(() => new Date(`${appliedTo}T23:59:59.999Z`).toISOString(), [appliedTo]);

  const { data, isLoading, error } = useUpgradePromptAnalytics(fromIso, toIso);
  const queryClient = useQueryClient();

  const handleApply = () => {
    setAppliedFrom(from);
    setAppliedTo(to);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/upgrade-prompts"] });
  };

  const totals = data?.totals ?? { impressions: 0, clicks: 0, ctr: 0 };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Upgrade Prompt Analytics</h1>
            <p className="text-muted-foreground mt-1">
              See which "What you'd unlock" prompts are converting members into upgrades.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} data-testid="button-refresh-upgrade-prompts">
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>

        <RevenueSubNav active="/admin/revenue/upgrade-prompts" />

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex flex-col gap-1">
                <Label htmlFor="upgrade-prompts-from">From</Label>
                <Input
                  id="upgrade-prompts-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-[180px]"
                  data-testid="input-upgrade-prompts-from"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="upgrade-prompts-to">To</Label>
                <Input
                  id="upgrade-prompts-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-[180px]"
                  data-testid="input-upgrade-prompts-to"
                />
              </div>
              <Button onClick={handleApply} data-testid="button-apply-upgrade-prompts-range">
                Apply
              </Button>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading analytics...</div>
        ) : error ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">
                Couldn't load upgrade prompt analytics. Please try again.
              </p>
              <Button variant="outline" className="mt-4" onClick={handleRefresh}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatTile
                label="Impressions"
                value={totals.impressions.toLocaleString()}
                icon={Eye}
                hint="Times the prompt was shown"
              />
              <StatTile
                label="Clicks"
                value={totals.clicks.toLocaleString()}
                icon={MousePointerClick}
                hint="CTA clicks recorded"
              />
              <StatTile
                label="Click-through rate"
                value={`${totals.ctr.toFixed(1)}%`}
                icon={TrendingUp}
                hint="Clicks ÷ impressions"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily trend</CardTitle>
              </CardHeader>
              <CardContent>
                {!data?.daily.length ? (
                  <p className="text-sm text-muted-foreground">No daily activity in this range yet.</p>
                ) : (
                  <div data-testid="chart-upgrade-prompts-daily">
                    <ChartContainer config={dailyChartConfig} className="h-[320px] w-full">
                      <ComposedChart data={data.daily}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="day"
                          tickFormatter={formatDayLabel}
                          minTickGap={24}
                        />
                        <YAxis yAxisId="left" allowDecimals={false} />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tickFormatter={(v: number) => `${v}%`}
                          domain={[0, "auto"]}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) =>
                                typeof value === "string" ? formatDayLabel(value) : String(value)
                              }
                            />
                          }
                        />
                        <Legend />
                        <Bar
                          yAxisId="left"
                          dataKey="impressions"
                          fill="var(--color-impressions)"
                          radius={[2, 2, 0, 0]}
                        />
                        <Bar
                          yAxisId="left"
                          dataKey="clicks"
                          fill="var(--color-clicks)"
                          radius={[2, 2, 0, 0]}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="ctr"
                          stroke="var(--color-ctr)"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      </ComposedChart>
                    </ChartContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">CTR by variant</CardTitle>
              </CardHeader>
              <CardContent>
                {!data?.byVariant.length ? (
                  <p className="text-sm text-muted-foreground">No prompt activity in this range yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Variant</TableHead>
                        <TableHead className="text-right">Impressions</TableHead>
                        <TableHead className="text-right">Clicks</TableHead>
                        <TableHead className="text-right">CTR</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byVariant.map((row) => (
                        <TableRow key={row.variant} data-testid={`row-variant-${row.variant}`}>
                          <TableCell className="font-medium">{formatVariant(row.variant)}</TableCell>
                          <TableCell className="text-right">{row.impressions.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{row.clicks.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-medium">{row.ctr.toFixed(1)}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Breakdown by source tier</CardTitle>
              </CardHeader>
              <CardContent>
                {!data?.byTier.length ? (
                  <p className="text-sm text-muted-foreground">No tier data in this range yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source tier</TableHead>
                        <TableHead className="text-right">Impressions</TableHead>
                        <TableHead className="text-right">Clicks</TableHead>
                        <TableHead className="text-right">CTR</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byTier.map((row) => (
                        <TableRow key={row.sourceTier} data-testid={`row-tier-${row.sourceTier}`}>
                          <TableCell className="font-medium">{row.sourceTier}</TableCell>
                          <TableCell className="text-right">{row.impressions.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{row.clicks.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-medium">{row.ctr.toFixed(1)}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top locked-feature combinations</CardTitle>
              </CardHeader>
              <CardContent>
                {!data?.topFeatureCombos.length ? (
                  <p className="text-sm text-muted-foreground">No feature combinations recorded yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Locked features</TableHead>
                        <TableHead className="text-right">Impressions</TableHead>
                        <TableHead className="text-right">Clicks</TableHead>
                        <TableHead className="text-right">CTR</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topFeatureCombos.map((row, idx) => (
                        <TableRow key={`${row.keys.join("|")}-${idx}`} data-testid={`row-combo-${idx}`}>
                          <TableCell>
                            {row.keys.length === 0 ? (
                              <span className="text-muted-foreground italic">(none)</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {row.keys.map((key) => (
                                  <Badge key={key} variant="secondary" className="font-mono text-xs">
                                    {key}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{row.impressions.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{row.clicks.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-medium">{row.ctr.toFixed(1)}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
