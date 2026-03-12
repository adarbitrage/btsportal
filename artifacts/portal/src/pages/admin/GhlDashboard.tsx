import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, CheckCircle, Clock, RefreshCw, Zap } from "lucide-react";
import { fetchGhlStatus, fetchGhlRecentActivity, fetchGhlFailedJobs, retryGhlJob } from "@/lib/admin-api";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { className: string; label: string }> = {
    completed: { className: "bg-green-100 text-green-800", label: "Completed" },
    success: { className: "bg-green-100 text-green-800", label: "Success" },
    failed: { className: "bg-red-100 text-red-800", label: "Failed" },
    pending: { className: "bg-yellow-100 text-yellow-800", label: "Pending" },
    queued: { className: "bg-yellow-100 text-yellow-800", label: "Queued" },
    retrying: { className: "bg-orange-100 text-orange-800", label: "Retrying" },
    processing: { className: "bg-blue-100 text-blue-800", label: "Processing" },
  };
  const v = variants[status] || { className: "bg-gray-100 text-gray-800", label: status };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${v.className}`}>{v.label}</span>;
}

export default function GhlDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["ghl-status"],
    queryFn: fetchGhlStatus,
    refetchInterval: 30000,
  });

  const { data: recentActivity, isLoading: activityLoading } = useQuery({
    queryKey: ["ghl-recent-activity"],
    queryFn: () => fetchGhlRecentActivity(50),
    refetchInterval: 30000,
  });

  const { data: failedJobs, isLoading: failedLoading } = useQuery({
    queryKey: ["ghl-failed-jobs"],
    queryFn: fetchGhlFailedJobs,
    refetchInterval: 30000,
  });

  const retryMutation = useMutation({
    mutationFn: retryGhlJob,
    onSuccess: () => {
      toast({ title: "Job queued for retry" });
      queryClient.invalidateQueries({ queryKey: ["ghl-failed-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["ghl-status"] });
      queryClient.invalidateQueries({ queryKey: ["ghl-recent-activity"] });
    },
    onError: (err: Error) => {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">GHL Sync Dashboard</h1>
          <p className="text-muted-foreground mt-1">Monitor GoHighLevel sync health and manage sync jobs.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Last Successful Sync</p>
                  <p className="text-lg font-semibold mt-1">
                    {statusLoading ? "..." : status?.lastSuccessfulSync
                      ? format(new Date(status.lastSuccessfulSync), "MMM d, h:mm a")
                      : "Never"}
                  </p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-500 opacity-60" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Queue Depth</p>
                  <p className="text-lg font-semibold mt-1">{statusLoading ? "..." : status?.queueDepth ?? 0}</p>
                </div>
                <Clock className="w-8 h-8 text-yellow-500 opacity-60" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Failed Jobs</p>
                  <p className="text-lg font-semibold mt-1">{statusLoading ? "..." : status?.failedJobCount ?? 0}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-red-500 opacity-60" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Sync Status</p>
                  <p className="text-lg font-semibold mt-1">
                    {statusLoading ? "..." : status?.syncEnabled ? (
                      <span className="text-green-600">Enabled</span>
                    ) : (
                      <span className="text-red-600">Disabled</span>
                    )}
                  </p>
                </div>
                <Zap className="w-8 h-8 text-primary opacity-60" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Recent Sync Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : !recentActivity?.length ? (
              <div className="text-center py-8 text-muted-foreground">No sync activity yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>User ID</TableHead>
                      <TableHead>GHL Contact</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentActivity.map((log: any) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-mono text-sm">{log.id}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {log.direction === "outbound" ? "→ Out" : "← In"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{log.action}</TableCell>
                        <TableCell><StatusBadge status={log.status} /></TableCell>
                        <TableCell className="text-sm">{log.userId || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{log.ghlContactId || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {log.createdAt ? format(new Date(log.createdAt), "MMM d, h:mm a") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Failed Sync Jobs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {failedLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : !failedJobs?.length ? (
              <div className="text-center py-8 text-muted-foreground">No failed jobs.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>User ID</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>Retries</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {failedJobs.map((job: any) => (
                      <TableRow key={job.id}>
                        <TableCell className="font-mono text-sm">{job.id}</TableCell>
                        <TableCell className="text-sm">{job.action}</TableCell>
                        <TableCell className="text-sm">{job.userId || "—"}</TableCell>
                        <TableCell className="text-sm text-red-600 max-w-xs truncate" title={job.errorMessage}>
                          {job.errorMessage || "Unknown error"}
                        </TableCell>
                        <TableCell className="text-sm">{job.attempts}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {job.createdAt ? format(new Date(job.createdAt), "MMM d, h:mm a") : "—"}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={retryMutation.isPending}
                            onClick={() => retryMutation.mutate(job.id)}
                          >
                            <RefreshCw className="w-3.5 h-3.5 mr-1" />
                            Retry
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
