import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend } from "recharts";
import { Star, Clock, CheckCircle2, Ticket } from "lucide-react";
import { mockAgentMetrics } from "@/lib/admin-mock-data";
import { cn } from "@/lib/utils";

const barChartConfig: ChartConfig = {
  ticketsHandled: { label: "Tickets Handled", color: "#3b82f6" },
  openTickets: { label: "Open Tickets", color: "#f59e0b" },
};

const radarChartConfig: ChartConfig = {
  value: { label: "Score", color: "#3b82f6" },
};

function StatCard({ icon: Icon, label, value, subtext, className }: { icon: any; label: string; value: string | number; subtext?: string; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
            {subtext && <div className="text-[10px] text-muted-foreground">{subtext}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AgentPerformance() {
  const totalTickets = mockAgentMetrics.reduce((sum, a) => sum + a.ticketsHandled, 0);
  const avgSla = (mockAgentMetrics.reduce((sum, a) => sum + a.slaCompliance, 0) / mockAgentMetrics.length).toFixed(1);
  const avgSatisfaction = (mockAgentMetrics.reduce((sum, a) => sum + a.satisfactionRating, 0) / mockAgentMetrics.length).toFixed(1);
  const avgResponseTime = (mockAgentMetrics.reduce((sum, a) => sum + a.avgResponseTime, 0) / mockAgentMetrics.length).toFixed(1);

  const ticketBarData = mockAgentMetrics.map((a) => ({
    name: a.name.split(" ")[0],
    ticketsHandled: a.ticketsHandled,
    openTickets: a.openTickets,
  }));

  const radarData = [
    { metric: "Response Time", ...Object.fromEntries(mockAgentMetrics.map((a) => [a.name.split(" ")[0], Math.max(0, 100 - a.avgResponseTime * 20)])) },
    { metric: "Resolution Time", ...Object.fromEntries(mockAgentMetrics.map((a) => [a.name.split(" ")[0], Math.max(0, 100 - a.avgResolutionTime * 2)])) },
    { metric: "SLA Compliance", ...Object.fromEntries(mockAgentMetrics.map((a) => [a.name.split(" ")[0], a.slaCompliance])) },
    { metric: "Satisfaction", ...Object.fromEntries(mockAgentMetrics.map((a) => [a.name.split(" ")[0], a.satisfactionRating * 20])) },
    { metric: "Volume", ...Object.fromEntries(mockAgentMetrics.map((a) => [a.name.split(" ")[0], (a.ticketsHandled / 178) * 100])) },
  ];

  const radarColors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Agent Performance</h1>
          <p className="text-muted-foreground">Track individual agent metrics and team performance</p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <StatCard icon={Ticket} label="Total Handled" value={totalTickets} subtext="Last 30 days" />
          <StatCard icon={CheckCircle2} label="Avg SLA Compliance" value={`${avgSla}%`} />
          <StatCard icon={Star} label="Avg Satisfaction" value={`${avgSatisfaction}/5`} />
          <StatCard icon={Clock} label="Avg Response Time" value={`${avgResponseTime}h`} />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tickets by Agent</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={barChartConfig} className="h-[300px]">
                <BarChart data={ticketBarData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="ticketsHandled" fill="var(--color-ticketsHandled)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="openTickets" fill="var(--color-openTickets)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Performance Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={radarChartConfig} className="h-[300px]">
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="metric" className="text-xs" />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
                  {mockAgentMetrics.map((agent, i) => (
                    <Radar
                      key={agent.name}
                      name={agent.name.split(" ")[0]}
                      dataKey={agent.name.split(" ")[0]}
                      stroke={radarColors[i]}
                      fill={radarColors[i]}
                      fillOpacity={0.1}
                    />
                  ))}
                  <Legend />
                </RadarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agent Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              <div className="grid grid-cols-[200px_100px_120px_120px_120px_100px_80px] gap-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <div>Agent</div>
                <div>Handled</div>
                <div>Avg Response</div>
                <div>Avg Resolution</div>
                <div>SLA Compliance</div>
                <div>Satisfaction</div>
                <div>Open</div>
              </div>
              {mockAgentMetrics.map((agent) => (
                <div key={agent.name} className="grid grid-cols-[200px_100px_120px_120px_120px_100px_80px] gap-3 py-3 items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                      {agent.avatar}
                    </div>
                    <span className="font-medium text-sm">{agent.name}</span>
                  </div>
                  <div className="text-sm font-medium">{agent.ticketsHandled}</div>
                  <div className="text-sm">{agent.avgResponseTime}h</div>
                  <div className="text-sm">{agent.avgResolutionTime}h</div>
                  <div>
                    <span
                      className={cn(
                        "text-sm font-medium",
                        agent.slaCompliance >= 95 ? "text-green-700" : agent.slaCompliance >= 85 ? "text-orange-700" : "text-red-700"
                      )}
                    >
                      {agent.slaCompliance}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                    <span className="text-sm font-medium">{agent.satisfactionRating}</span>
                  </div>
                  <div>
                    <Badge variant="secondary" className={cn("text-[10px]", agent.openTickets > 10 && "bg-red-100 text-red-800 border-red-200")}>
                      {agent.openTickets}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
