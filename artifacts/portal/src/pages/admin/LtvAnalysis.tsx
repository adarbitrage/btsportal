import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { DollarSign, RefreshCw, Users } from "lucide-react";
import { useLtvAnalysis } from "@/lib/revenue-api";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { RevenueSubNav } from "./RevenueDashboard";

const segmentConfig: ChartConfig = {
  avgLtv: { label: "Avg LTV", color: "#3b82f6" },
};

const distributionConfig: ChartConfig = {
  count: { label: "Members", color: "#8b5cf6" },
};

function formatCurrency(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export default function LtvAnalysis() {
  const { data, isLoading, error } = useLtvAnalysis();
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/revenue/ltv"] });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">LTV Analysis</h1>
            <p className="text-muted-foreground mt-1">
              Understand lifetime value across segments and products
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>

        <RevenueSubNav active="/admin/revenue/ltv" />

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading LTV data...</div>
        ) : error ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">
                LTV data is not yet available. The metrics engine backend needs to be configured.
              </p>
              <Button variant="outline" className="mt-4" onClick={handleRefresh}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : data ? (
          <>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center">
                    <DollarSign className="w-7 h-7 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Overall Average LTV</p>
                    <p className="text-3xl font-bold">{formatCurrency(data.overallAvgLtv)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">LTV by First Product</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={segmentConfig} className="h-[300px]">
                    <BarChart data={data.byProduct} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => formatCurrency(v)} />
                      <YAxis dataKey="segment" type="category" width={120} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="avgLtv" fill="var(--color-avgLtv)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ChartContainer>
                  <div className="mt-4 space-y-2">
                    {data.byProduct.map((s) => (
                      <div key={s.segment} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{s.segment}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-medium">{formatCurrency(s.avgLtv)}</span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Users className="w-3 h-3" />{s.memberCount}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">LTV by Experience Level</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={segmentConfig} className="h-[300px]">
                    <BarChart data={data.byExperience} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => formatCurrency(v)} />
                      <YAxis dataKey="segment" type="category" width={120} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="avgLtv" fill="var(--color-avgLtv)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ChartContainer>
                  <div className="mt-4 space-y-2">
                    {data.byExperience.map((s) => (
                      <div key={s.segment} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{s.segment}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-medium">{formatCurrency(s.avgLtv)}</span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Users className="w-3 h-3" />{s.memberCount}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">LTV Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={distributionConfig} className="h-[300px]">
                  <BarChart data={data.distribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="range" />
                    <YAxis />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
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
