import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Ticket, CheckCircle2, Star, TrendingUp } from "lucide-react";
import { mockAnalyticsData } from "@/lib/admin-mock-data";
import { cn } from "@/lib/utils";

const volumeConfig: ChartConfig = {
  opened: { label: "Opened", color: "#3b82f6" },
  closed: { label: "Closed", color: "#10b981" },
};

const statusConfig: ChartConfig = {
  count: { label: "Tickets", color: "#3b82f6" },
};

const slaConfig: ChartConfig = {
  compliance: { label: "Compliance %", color: "#3b82f6" },
  target: { label: "Target %", color: "#ef4444" },
};

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#6b7280"];

const satisfactionConfig: ChartConfig = {
  count: { label: "Responses", color: "#f59e0b" },
};

function StatCard({ icon: Icon, label, value, trend, trendUp }: { icon: any; label: string; value: string | number; trend?: string; trendUp?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
          {trend && (
            <div className={cn("text-xs font-medium flex items-center gap-0.5", trendUp ? "text-green-600" : "text-red-600")}>
              <TrendingUp className={cn("w-3 h-3", !trendUp && "rotate-180")} />
              {trend}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HeatmapCell({ value, maxValue }: { value: number; maxValue: number }) {
  const intensity = maxValue > 0 ? value / maxValue : 0;
  const bg = intensity === 0
    ? "bg-gray-50"
    : intensity < 0.25
    ? "bg-blue-100"
    : intensity < 0.5
    ? "bg-blue-200"
    : intensity < 0.75
    ? "bg-blue-400 text-white"
    : "bg-blue-600 text-white";

  return (
    <div className={cn("w-10 h-10 rounded flex items-center justify-center text-xs font-medium", bg)}>
      {value > 0 ? value : ""}
    </div>
  );
}

export default function SupportAnalytics() {
  const totalTickets = mockAnalyticsData.ticketsByStatus.reduce((sum, s) => sum + s.count, 0);
  const avgSla = (mockAnalyticsData.slaByTier.reduce((sum, t) => sum + t.compliance, 0) / mockAnalyticsData.slaByTier.length).toFixed(1);
  const totalSatisfaction = mockAnalyticsData.satisfactionDistribution.reduce((sum, s) => sum + s.count, 0);
  const avgSatisfaction = totalSatisfaction > 0
    ? ((mockAnalyticsData.satisfactionDistribution[0].count * 5 + mockAnalyticsData.satisfactionDistribution[1].count * 4 + mockAnalyticsData.satisfactionDistribution[2].count * 3 + mockAnalyticsData.satisfactionDistribution[3].count * 2 + mockAnalyticsData.satisfactionDistribution[4].count * 1) / totalSatisfaction).toFixed(1)
    : "0";

  const maxHeatVal = Math.max(...mockAnalyticsData.busyHours.flatMap((h) => [h.mon, h.tue, h.wed, h.thu, h.fri, h.sat, h.sun]));
  const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Support Analytics</h1>
          <p className="text-muted-foreground">Overview of support performance and ticket trends</p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <StatCard icon={Ticket} label="Total Tickets" value={totalTickets} trend="+12%" trendUp={true} />
          <StatCard icon={CheckCircle2} label="Avg SLA Compliance" value={`${avgSla}%`} trend="+2.1%" trendUp={true} />
          <StatCard icon={Star} label="Avg Satisfaction" value={`${avgSatisfaction}/5`} trend="+0.2" trendUp={true} />
          <StatCard icon={TrendingUp} label="Open Tickets" value={mockAnalyticsData.ticketsByStatus[0].count + mockAnalyticsData.ticketsByStatus[1].count} trend="-5%" trendUp={false} />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ticket Volume Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={volumeConfig} className="h-[280px]">
                <LineChart data={mockAnalyticsData.volumeTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="opened" stroke="var(--color-opened)" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="closed" stroke="var(--color-closed)" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tickets by Status</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={statusConfig} className="h-[280px]">
                <BarChart data={mockAnalyticsData.ticketsByStatus}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="status" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SLA Compliance by Tier</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={slaConfig} className="h-[280px]">
                <BarChart data={mockAnalyticsData.slaByTier} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[70, 100]} />
                  <YAxis dataKey="tier" type="category" width={80} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="compliance" fill="var(--color-compliance)" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="target" fill="var(--color-target)" radius={[0, 4, 4, 0]} fillOpacity={0.3} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Category Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center">
              <ChartContainer config={statusConfig} className="h-[280px] w-full">
                <PieChart>
                  <Pie
                    data={mockAnalyticsData.categoryBreakdown}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="count"
                    nameKey="category"
                    label={({ category, percentage }) => `${category} ${percentage}%`}
                  >
                    {mockAnalyticsData.categoryBreakdown.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent nameKey="category" />} />
                </PieChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Satisfaction Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={satisfactionConfig} className="h-[280px]">
                <BarChart data={mockAnalyticsData.satisfactionDistribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="rating" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Busiest Hours Heatmap</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="inline-grid gap-1">
                  <div className="grid grid-cols-[60px_repeat(7,40px)] gap-1 mb-1">
                    <div></div>
                    {dayLabels.map((d) => (
                      <div key={d} className="text-center text-xs font-medium text-muted-foreground">{d}</div>
                    ))}
                  </div>
                  {mockAnalyticsData.busyHours.map((row) => (
                    <div key={row.hour} className="grid grid-cols-[60px_repeat(7,40px)] gap-1">
                      <div className="flex items-center text-xs text-muted-foreground font-medium">{row.hour}</div>
                      {dayKeys.map((day) => (
                        <HeatmapCell key={day} value={row[day]} maxValue={maxHeatVal} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
