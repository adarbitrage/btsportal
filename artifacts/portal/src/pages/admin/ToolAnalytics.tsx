import { useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
  PieChart, Pie, Cell,
} from "recharts";
import {
  MousePointerClick, TrendingUp, Users, Cpu,
  DollarSign, ArrowLeft, Crown,
} from "lucide-react";
import { useAdminToolAnalytics } from "@/lib/admin-api";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

const dailyConfig: ChartConfig = {
  count: { label: "Usage", color: "#3b82f6" },
};

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#6b7280"];
const LINE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

function TrendBadge({ trend }: { trend: number }) {
  if (trend === 0) return null;
  const isUp = trend > 0;
  return (
    <span className={cn(
      "inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
      isUp ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
    )}>
      {isUp ? "+" : ""}{trend}%
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sub, trend }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; sub?: string; trend?: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold">{value}</div>
              {trend !== undefined && <TrendBadge trend={trend} />}
            </div>
            <div className="text-xs text-muted-foreground">{label}</div>
            {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ToolAnalytics() {
  const { data: analytics, isLoading } = useAdminToolAnalytics();
  const [, navigate] = useLocation();

  const perToolChartData = useMemo(() => {
    if (!analytics?.perToolDailyUsage?.length) return { data: [] as Record<string, string | number>[], toolNames: [] as string[] };

    const toolNames = [...new Set(analytics.perToolDailyUsage.map(r => r.toolName))];
    const dateMap = new Map<string, Record<string, string | number>>();

    for (const row of analytics.perToolDailyUsage) {
      if (!dateMap.has(row.date)) {
        dateMap.set(row.date, { date: row.date });
      }
      const entry = dateMap.get(row.date)!;
      entry[row.toolName] = row.count;
    }

    return {
      data: Array.from(dateMap.values()).sort((a, b) => (a.date as string).localeCompare(b.date as string)),
      toolNames,
    };
  }, [analytics?.perToolDailyUsage]);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-6xl mx-auto py-12 text-center text-muted-foreground">Loading analytics...</div>
      </AppLayout>
    );
  }

  if (!analytics) {
    return (
      <AppLayout>
        <div className="max-w-6xl mx-auto py-12 text-center text-muted-foreground">Failed to load analytics</div>
      </AppLayout>
    );
  }

  const costDollars = (analytics.aiStats.totalCostCents / 100).toFixed(2);

  const perToolConfig: ChartConfig = {};
  perToolChartData.toolNames.forEach((name, i) => {
    perToolConfig[name] = { label: name, color: LINE_COLORS[i % LINE_COLORS.length] };
  });

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/tools")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Tools
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Tool Analytics</h1>
            <p className="text-muted-foreground">Usage statistics and trends for all tools</p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <StatCard
            icon={MousePointerClick}
            label="Opens Today"
            value={analytics.totalOpens.today}
            trend={analytics.totalOpens.todayTrend}
            sub={`${analytics.totalOpens.week} this week`}
          />
          <StatCard
            icon={TrendingUp}
            label="Opens This Month"
            value={analytics.totalOpens.month}
            trend={analytics.totalOpens.monthTrend}
          />
          <StatCard
            icon={Cpu}
            label="AI Generations (30d)"
            value={analytics.aiStats.totalGenerations}
            sub={`${analytics.aiStats.totalTokens.toLocaleString()} tokens`}
          />
          <StatCard
            icon={DollarSign}
            label="Estimated AI Cost (30d)"
            value={`$${costDollars}`}
          />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Overall Daily Usage (30 days)</CardTitle>
            </CardHeader>
            <CardContent>
              {analytics.dailyUsage.length > 0 ? (
                <ChartContainer config={dailyConfig} className="h-[280px]">
                  <LineChart data={analytics.dailyUsage}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ChartContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground">No usage data yet</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Usage by Entitlement Tier</CardTitle>
            </CardHeader>
            <CardContent>
              {analytics.usageByTier.length > 0 ? (
                <ChartContainer config={{ count: { label: "Count", color: "#3b82f6" } }} className="h-[280px]">
                  <PieChart>
                    <Pie
                      data={analytics.usageByTier.map(t => ({ name: t.entitlementTier || "Unknown", value: t.count }))}
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      dataKey="value"
                      label={({ name, value }: { name: string; value: number }) => `${name}: ${value}`}
                    >
                      {analytics.usageByTier.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </PieChart>
                </ChartContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground">No tier data yet</div>
              )}
            </CardContent>
          </Card>
        </div>

        {perToolChartData.toolNames.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per-Tool Daily Usage (30 days)</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={perToolConfig} className="h-[350px]">
                <LineChart data={perToolChartData.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {perToolChartData.toolNames.map((name, i) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={LINE_COLORS[i % LINE_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Crown className="w-4 h-4 text-yellow-500" />
                Most Popular Tools
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analytics.popularTools.length > 0 ? (
                <div className="space-y-3">
                  {analytics.popularTools.map((tool, i) => (
                    <div key={tool.toolId} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                          i === 0 ? "bg-yellow-100 text-yellow-700" :
                          i === 1 ? "bg-gray-100 text-gray-600" :
                          i === 2 ? "bg-orange-100 text-orange-700" :
                          "bg-muted text-muted-foreground"
                        )}>
                          {i + 1}
                        </div>
                        <div>
                          <div className="font-medium text-sm">{tool.toolName}</div>
                          <div className="text-xs text-muted-foreground">{tool.toolSlug}</div>
                        </div>
                      </div>
                      <Badge variant="secondary">{tool.opens} opens</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">No usage data yet</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4" />
                Tool Adoption (30 days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analytics.toolAdoption.length > 0 ? (
                <div className="space-y-3">
                  {analytics.toolAdoption.map((tool) => (
                    <div key={tool.toolId} className="flex items-center justify-between">
                      <div className="font-medium text-sm">{tool.toolName}</div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{tool.uniqueUsers} users</Badge>
                        <Badge variant="secondary">{tool.adoptionRate}%</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">No adoption data yet</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
