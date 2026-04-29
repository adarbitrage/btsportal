import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Users,
  Target,
  Zap,
} from "lucide-react";
import { useRevenueDashboard } from "@/lib/revenue-api";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

const trendConfig: ChartConfig = {
  mrr: { label: "MRR", color: "#3b82f6" },
  newRevenue: { label: "New Revenue", color: "#10b981" },
  expansion: { label: "Expansion", color: "#8b5cf6" },
  churned: { label: "Churned", color: "#ef4444" },
};

const productConfig: ChartConfig = {
  revenue: { label: "Revenue", color: "#3b82f6" },
};

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

interface KpiCardProps {
  title: string;
  value: string;
  change: number;
  icon: React.ElementType;
  iconColor: string;
}

function KpiCard({ title, value, change, icon: Icon, iconColor }: KpiCardProps) {
  const isPositive = change > 0;
  const isChurn = title === "Churned Revenue";
  const trendGood = isChurn ? !isPositive : isPositive;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p className="text-xl font-bold">{value}</p>
          </div>
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", iconColor)}>
            <Icon className="w-4 h-4 text-white" />
          </div>
        </div>
        <div className={cn("flex items-center gap-1 mt-2 text-xs font-medium", trendGood ? "text-green-600" : "text-red-600")}>
          {trendGood ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {formatPercent(change)} vs last period
        </div>
      </CardContent>
    </Card>
  );
}

const subNavItems = [
  { href: "/admin/revenue", label: "Overview" },
  { href: "/admin/revenue/cohorts", label: "Cohorts" },
  { href: "/admin/revenue/at-risk", label: "At-Risk" },
  { href: "/admin/revenue/upgrade-opportunities", label: "Upgrades" },
  { href: "/admin/revenue/funnels", label: "Funnels" },
  { href: "/admin/revenue/upgrade-prompts", label: "Upgrade Prompts" },
  { href: "/admin/revenue/ltv", label: "LTV" },
  { href: "/admin/revenue/forecast", label: "Forecast" },
];

export function RevenueSubNav({ active }: { active: string }) {
  return (
    <div className="flex gap-1 p-1 bg-muted/50 rounded-lg w-fit">
      {subNavItems.map((item) => (
        <Link key={item.href} href={item.href}>
          <button
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              active === item.href
                ? "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </button>
        </Link>
      ))}
    </div>
  );
}

export default function RevenueDashboard() {
  const [period, setPeriod] = useState("30d");
  const { data, isLoading, error } = useRevenueDashboard(period);
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/revenue/dashboard"] });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Revenue Intelligence</h1>
            <p className="text-muted-foreground mt-1">
              Track revenue metrics, trends, and opportunities
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="12m">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          </div>
        </div>

        <RevenueSubNav active="/admin/revenue" />

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading revenue data...</div>
        ) : error ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">
                Revenue data is not yet available. The metrics engine backend needs to be configured.
              </p>
              <Button variant="outline" className="mt-4" onClick={handleRefresh}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard title="MRR" value={formatCurrency(data.kpis.mrr)} change={data.kpis.mrrChange} icon={DollarSign} iconColor="bg-blue-500" />
              <KpiCard title="New Revenue" value={formatCurrency(data.kpis.newRevenue)} change={data.kpis.newRevenueChange} icon={TrendingUp} iconColor="bg-green-500" />
              <KpiCard title="Expansion Revenue" value={formatCurrency(data.kpis.expansion)} change={data.kpis.expansionChange} icon={Zap} iconColor="bg-purple-500" />
              <KpiCard title="Churned Revenue" value={formatCurrency(data.kpis.churned)} change={data.kpis.churnedChange} icon={TrendingDown} iconColor="bg-red-500" />
              <KpiCard title="ARR" value={formatCurrency(data.kpis.arr)} change={data.kpis.arrChange} icon={DollarSign} iconColor="bg-indigo-500" />
              <KpiCard title="Avg LTV" value={formatCurrency(data.kpis.avgLtv)} change={data.kpis.avgLtvChange} icon={Users} iconColor="bg-teal-500" />
              <KpiCard title="CAC" value={formatCurrency(data.kpis.cac)} change={data.kpis.cacChange} icon={Target} iconColor="bg-orange-500" />
              <KpiCard title="LTV:CAC Ratio" value={`${data.kpis.ltvCacRatio.toFixed(1)}x`} change={data.kpis.ltvCacRatioChange} icon={ArrowUpRight} iconColor="bg-cyan-500" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Revenue Trend (12 months)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={trendConfig} className="h-[320px]">
                    <AreaChart data={data.trend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={(v) => formatCurrency(v)} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="mrr" stroke="var(--color-mrr)" fill="var(--color-mrr)" fillOpacity={0.1} strokeWidth={2} />
                      <Area type="monotone" dataKey="newRevenue" stroke="var(--color-newRevenue)" fill="var(--color-newRevenue)" fillOpacity={0.1} strokeWidth={2} />
                      <Area type="monotone" dataKey="expansion" stroke="var(--color-expansion)" fill="var(--color-expansion)" fillOpacity={0.1} strokeWidth={2} />
                    </AreaChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Revenue by Product</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={productConfig} className="h-[320px]">
                    <BarChart data={data.byProduct} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => formatCurrency(v)} />
                      <YAxis dataKey="product" type="category" width={100} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </AppLayout>
  );
}
