import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Heart,
  Eye,
  Mail,
  ClipboardList,
  User,
  RefreshCw,
  ArrowUpDown,
  ShieldAlert,
  ShieldCheck,
  Shield,
  Activity,
} from "lucide-react";
import { useAtRiskMembers, useSendRetentionEmail, useCreateGhlTask } from "@/lib/revenue-api";
import type { AtRiskMember } from "@/lib/revenue-api";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { RevenueSubNav } from "./RevenueDashboard";
import { format } from "date-fns";

type SortField = "healthScore" | "daysInactive" | "churnProbability" | "name";
type SortDir = "asc" | "desc";

function HealthBadge({ score }: { score: number }) {
  if (score <= 25) return <Badge className="text-xs bg-red-100 text-red-800 hover:bg-red-100">Critical</Badge>;
  if (score <= 50) return <Badge className="text-xs bg-orange-100 text-orange-800 hover:bg-orange-100">At Risk</Badge>;
  if (score <= 75) return <Badge className="text-xs bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Watch</Badge>;
  return <Badge className="text-xs bg-green-100 text-green-800 hover:bg-green-100">Healthy</Badge>;
}

function TrendIndicator({ trend }: { trend: AtRiskMember["trend"] }) {
  if (trend === "declining") return <span className="text-red-500 text-xs font-medium flex items-center gap-1"><Activity className="w-3 h-3" />Declining</span>;
  if (trend === "improving") return <span className="text-green-500 text-xs font-medium flex items-center gap-1"><Activity className="w-3 h-3" />Improving</span>;
  return <span className="text-gray-500 text-xs font-medium flex items-center gap-1"><Activity className="w-3 h-3" />Stable</span>;
}

function HealthScoreBar({ score }: { score: number }) {
  const color = score <= 25 ? "bg-red-500" : score <= 50 ? "bg-orange-500" : score <= 75 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm font-medium w-8">{score}</span>
    </div>
  );
}

export default function AtRiskMembers() {
  const [sortField, setSortField] = useState<SortField>("churnProbability");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const { data, isLoading, error } = useAtRiskMembers();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sendEmail = useSendRetentionEmail();
  const createTask = useCreateGhlTask();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/revenue/at-risk"] });
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortedMembers = data?.members
    ? [...data.members].sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        if (sortField === "name") return dir * a.name.localeCompare(b.name);
        return dir * (a[sortField] - b[sortField]);
      })
    : [];

  const handleSendEmail = (memberId: number) => {
    sendEmail.mutate(memberId, {
      onSuccess: () => toast({ title: "Retention email sent" }),
      onError: (err: Error) => toast({ title: "Failed to send email", description: err.message, variant: "destructive" }),
    });
  };

  const handleCreateTask = (memberId: number) => {
    createTask.mutate(memberId, {
      onSuccess: () => toast({ title: "GHL task created" }),
      onError: (err: Error) => toast({ title: "Failed to create task", description: err.message, variant: "destructive" }),
    });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">At-Risk Members</h1>
            <p className="text-muted-foreground mt-1">
              Monitor member health scores and prevent churn
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>

        <RevenueSubNav active="/admin/revenue/at-risk" />

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading at-risk data...</div>
        ) : error ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">
                At-risk data is not yet available. The metrics engine backend needs to be configured.
              </p>
              <Button variant="outline" className="mt-4" onClick={handleRefresh}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                      <ShieldAlert className="w-5 h-5 text-red-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{data.distribution.critical}</p>
                      <p className="text-xs text-muted-foreground">Critical</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{data.distribution.atRisk}</p>
                      <p className="text-xs text-muted-foreground">At Risk</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center">
                      <Eye className="w-5 h-5 text-yellow-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{data.distribution.watch}</p>
                      <p className="text-xs text-muted-foreground">Watch</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                      <ShieldCheck className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{data.distribution.healthy}</p>
                      <p className="text-xs text-muted-foreground">Healthy</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Member Health Scores</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="cursor-pointer" onClick={() => toggleSort("name")}>
                          <div className="flex items-center gap-1">Member <ArrowUpDown className="w-3 h-3" /></div>
                        </TableHead>
                        <TableHead className="cursor-pointer" onClick={() => toggleSort("healthScore")}>
                          <div className="flex items-center gap-1">Health Score <ArrowUpDown className="w-3 h-3" /></div>
                        </TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Trend</TableHead>
                        <TableHead className="cursor-pointer" onClick={() => toggleSort("daysInactive")}>
                          <div className="flex items-center gap-1">Days Inactive <ArrowUpDown className="w-3 h-3" /></div>
                        </TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Expiration</TableHead>
                        <TableHead className="cursor-pointer" onClick={() => toggleSort("churnProbability")}>
                          <div className="flex items-center gap-1">Churn Prob. <ArrowUpDown className="w-3 h-3" /></div>
                        </TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedMembers.map((member) => (
                        <TableRow key={member.id}>
                          <TableCell>
                            <div>
                              <p className="text-sm font-medium">{member.name}</p>
                              <p className="text-xs text-muted-foreground">{member.email}</p>
                            </div>
                          </TableCell>
                          <TableCell><HealthScoreBar score={member.healthScore} /></TableCell>
                          <TableCell><HealthBadge score={member.healthScore} /></TableCell>
                          <TableCell><TrendIndicator trend={member.trend} /></TableCell>
                          <TableCell className="text-sm">{member.daysInactive}d</TableCell>
                          <TableCell className="text-sm">{member.currentProduct}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(member.expirationDate), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell>
                            <div className={cn(
                              "text-sm font-semibold",
                              member.churnProbability >= 70 ? "text-red-600" : member.churnProbability >= 40 ? "text-orange-600" : "text-green-600"
                            )}>
                              {member.churnProbability}%
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                title="Send retention email"
                                onClick={() => handleSendEmail(member.id)}
                                disabled={sendEmail.isPending}
                              >
                                <Mail className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                title="Create GHL task"
                                onClick={() => handleCreateTask(member.id)}
                                disabled={createTask.isPending}
                              >
                                <ClipboardList className="w-3.5 h-3.5" />
                              </Button>
                              <a
                                href={`/community/members/${member.id}`}
                                className="inline-flex items-center justify-center h-7 w-7 p-0 rounded-md hover:bg-accent hover:text-accent-foreground"
                                title="View profile"
                              >
                                <User className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {sortedMembers.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                            No at-risk members found.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </AppLayout>
  );
}
