import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Bar, BarChart, XAxis, YAxis, CartesianGrid } from "recharts";
import { ChevronLeft, ChevronRight, Clock, CheckCircle2, DollarSign, XCircle } from "lucide-react";
import { useEarnings } from "@/lib/commission-api";
import type { ChartConfig } from "@/components/ui/chart";

const PERIOD_OPTIONS = [
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "last_90_days", label: "Last 90 Days" },
  { value: "all_time", label: "All Time" },
];

const chartConfig: ChartConfig = {
  pending: { label: "Pending", color: "#f59e0b" },
  approved: { label: "Approved", color: "#3b82f6" },
  paid: { label: "Paid", color: "#22c55e" },
};

const statusConfig: Record<string, { icon: typeof Clock; className: string; label: string }> = {
  pending: { icon: Clock, className: "text-amber-500", label: "Pending" },
  approved: { icon: CheckCircle2, className: "text-blue-500", label: "Approved" },
  paid: { icon: DollarSign, className: "text-green-500", label: "Paid" },
  rejected: { icon: XCircle, className: "text-red-500", label: "Rejected" },
};

export function EarningsTab() {
  const [period, setPeriod] = useState("this_month");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useEarnings(period, page);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-12 bg-card rounded-xl animate-pulse" />
        <div className="h-64 bg-card rounded-xl animate-pulse" />
        <div className="h-48 bg-card rounded-xl animate-pulse" />
      </div>
    );
  }

  const totalPages = data ? Math.ceil(data.totalRecords / data.pageSize) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Select value={period} onValueChange={(v) => { setPeriod(v); setPage(1); }}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-4 text-sm">
          <div className="text-muted-foreground">
            Total: <span className="font-bold text-foreground">${data?.totalEarnings.toFixed(2) ?? "0.00"}</span>
          </div>
          <div className="text-muted-foreground">
            Avg: <span className="font-bold text-foreground">${data?.averageCommission.toFixed(2) ?? "0.00"}</span>
          </div>
        </div>
      </div>

      {data?.chart && data.chart.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <p className="text-sm font-semibold text-muted-foreground">Earnings Overview</p>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <BarChart data={data.chart} accessibilityLayer>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="period" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => `$${v}`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="pending" fill="var(--color-pending)" radius={[4, 4, 0, 0]} stackId="stack" />
                <Bar dataKey="approved" fill="var(--color-approved)" radius={[0, 0, 0, 0]} stackId="stack" />
                <Bar dataKey="paid" fill="var(--color-paid)" radius={[4, 4, 0, 0]} stackId="stack" />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Referred</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Sale</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.records && data.records.length > 0 ? (
                data.records.map((record) => {
                  const status = statusConfig[record.status] || statusConfig.pending;
                  const StatusIcon = status.icon;
                  return (
                    <TableRow key={record.id}>
                      <TableCell className="text-sm">
                        {new Date(record.date).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {record.referredFirstName} {record.referredLastInitial}.
                      </TableCell>
                      <TableCell className="text-sm">{record.productName}</TableCell>
                      <TableCell className="text-sm text-right">
                        ${record.saleAmount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-sm text-right font-medium">
                        ${record.commissionAmount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <StatusIcon className={`w-4 h-4 ${status.className}`} />
                          <span className={`text-xs ${status.className}`}>{status.label}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No commission records for this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages} ({data?.totalRecords} records)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
