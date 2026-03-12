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
} from "recharts";
import { ArrowLeft, MousePointerClick, Users } from "lucide-react";
import { useAdminToolUsage } from "@/lib/admin-api";
import { useLocation, useParams } from "wouter";

const dailyConfig: ChartConfig = {
  count: { label: "Usage", color: "#3b82f6" },
};

const actionConfig: ChartConfig = {
  count: { label: "Count", color: "#10b981" },
};

export default function ToolUsageDetail() {
  const params = useParams<{ id: string }>();
  const toolId = parseInt(params.id || "0", 10);
  const { data, isLoading } = useAdminToolUsage(toolId);
  const [, navigate] = useLocation();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto py-12 text-center text-muted-foreground">Loading usage data...</div>
      </AppLayout>
    );
  }

  if (!data) {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto py-12 text-center text-muted-foreground">Tool not found</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/tools/analytics")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Analytics
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{data.tool.name}</h1>
            <p className="text-muted-foreground">Usage details for the last 30 days</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <MousePointerClick className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-bold">{data.totalOpensAllTime}</div>
                <div className="text-xs text-muted-foreground">Total Opens (All Time)</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-bold">{data.uniqueUsers}</div>
                <div className="text-xs text-muted-foreground">Unique Users (30d)</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm font-medium mb-1">Tool Info</div>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline">{data.tool.type}</Badge>
                <Badge variant="secondary">{data.tool.requiredEntitlement}</Badge>
                <Badge variant={data.tool.status === "active" ? "default" : "secondary"}>
                  {data.tool.status}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily Usage (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {data.dailyUsage.length > 0 ? (
              <ChartContainer config={dailyConfig} className="h-[300px]">
                <LineChart data={data.dailyUsage}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ChartContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">No usage data for this period</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Action Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {data.actionBreakdown.length > 0 ? (
              <ChartContainer config={actionConfig} className="h-[250px]">
                <BarChart data={data.actionBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="action" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">No action data for this period</div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
