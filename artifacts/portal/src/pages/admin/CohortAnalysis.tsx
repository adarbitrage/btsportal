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
import { RefreshCw } from "lucide-react";
import { useCohortAnalysis } from "@/lib/revenue-api";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { RevenueSubNav } from "./RevenueDashboard";

const metrics = [
  { value: "revenue", label: "Revenue" },
  { value: "retention", label: "Retention %" },
  { value: "upgrade", label: "Upgrade %" },
  { value: "active", label: "Active Members" },
];

const dimensions = [
  { value: "signup_month", label: "Signup Month" },
  { value: "source_funnel", label: "Source Funnel" },
  { value: "first_product", label: "First Product" },
  { value: "experience_level", label: "Experience Level" },
];

function getHeatmapColor(value: number | null, metric: string): string {
  if (value === null) return "bg-gray-50 text-gray-300";
  let intensity: number;
  if (metric === "retention" || metric === "upgrade") {
    intensity = value / 100;
  } else if (metric === "revenue") {
    intensity = Math.min(value / 5000, 1);
  } else {
    intensity = Math.min(value / 50, 1);
  }

  if (intensity >= 0.8) return "bg-green-600 text-white";
  if (intensity >= 0.6) return "bg-green-400 text-white";
  if (intensity >= 0.4) return "bg-yellow-400 text-gray-900";
  if (intensity >= 0.2) return "bg-orange-300 text-gray-900";
  return "bg-red-200 text-gray-700";
}

function formatCellValue(value: number | null, metric: string): string {
  if (value === null) return "—";
  if (metric === "retention" || metric === "upgrade") return `${value.toFixed(0)}%`;
  if (metric === "revenue") return `$${value.toFixed(0)}`;
  return value.toFixed(0);
}

export default function CohortAnalysis() {
  const [metric, setMetric] = useState("retention");
  const [dimension, setDimension] = useState("signup_month");
  const { data, isLoading, error } = useCohortAnalysis(metric, dimension);
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/revenue/cohorts"] });
  };

  const monthHeaders = Array.from({ length: 13 }, (_, i) => `M${i}`);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Cohort Analysis</h1>
            <p className="text-muted-foreground mt-1">
              Analyze member retention and revenue by cohort
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>

        <RevenueSubNav active="/admin/revenue/cohorts" />

        <div className="flex items-center gap-4">
          <div className="flex gap-1 p-1 bg-muted/50 rounded-lg">
            {metrics.map((m) => (
              <button
                key={m.value}
                onClick={() => setMetric(m.value)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  metric === m.value
                    ? "bg-white text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          <Select value={dimension} onValueChange={setDimension}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dimensions.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading cohort data...</div>
        ) : error ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">
                Cohort data is not yet available. The metrics engine backend needs to be configured.
              </p>
              <Button variant="outline" className="mt-4" onClick={handleRefresh}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : data?.cohorts ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Cohort Heatmap — {metrics.find((m) => m.value === metric)?.label} by{" "}
                {dimensions.find((d) => d.value === dimension)?.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-32">
                        Cohort
                      </th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-16">
                        Size
                      </th>
                      {monthHeaders.map((h) => (
                        <th key={h} className="px-1 py-2 text-center text-xs font-medium text-muted-foreground w-14">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.cohorts.map((row) => (
                      <tr key={row.cohort} className="border-t border-border/30">
                        <td className="px-3 py-1 text-sm font-medium">{row.cohort}</td>
                        <td className="px-3 py-1 text-sm text-center text-muted-foreground">{row.size}</td>
                        {monthHeaders.map((_, i) => {
                          const val = i < row.months.length ? row.months[i] : null;
                          return (
                            <td key={i} className="px-1 py-1 text-center">
                              <div
                                className={cn(
                                  "w-12 h-8 rounded flex items-center justify-center text-xs font-medium mx-auto",
                                  getHeatmapColor(val, metric)
                                )}
                              >
                                {formatCellValue(val, metric)}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-4 mt-6 pt-4 border-t">
                <span className="text-xs text-muted-foreground">Legend:</span>
                <div className="flex items-center gap-2">
                  {[
                    { color: "bg-red-200", label: "Low" },
                    { color: "bg-orange-300", label: "" },
                    { color: "bg-yellow-400", label: "Mid" },
                    { color: "bg-green-400", label: "" },
                    { color: "bg-green-600", label: "High" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <div className={cn("w-4 h-4 rounded", item.color)} />
                      {item.label && <span className="text-xs text-muted-foreground">{item.label}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppLayout>
  );
}
