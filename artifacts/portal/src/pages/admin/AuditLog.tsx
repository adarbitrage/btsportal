import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, Download, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function AuditLog() {
  const [logs, setLogs] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [filters, setFilters] = useState({ actionType: "", entityType: "", startDate: "", endDate: "" });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const load = async (page = 1) => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getAuditLog({ page, ...filters });
      setLogs(data.logs);
      setPagination(data.pagination);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filters]);

  const handleExport = async (fmt: string) => {
    try {
      const res = await adminPanelApi.exportAuditLog(fmt, filters);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ScrollText className="w-6 h-6" /> Audit Log
            </h1>
            <p className="text-muted-foreground mt-1">Track all admin actions</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleExport("csv")}><Download className="w-4 h-4 mr-1" />CSV</Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("json")}><Download className="w-4 h-4 mr-1" />JSON</Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3">
              <Select value={filters.actionType} onValueChange={(v) => setFilters({ ...filters, actionType: v === "all" ? "" : v })}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Action Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="create">Create</SelectItem>
                  <SelectItem value="update">Update</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="grant_product">Grant Product</SelectItem>
                  <SelectItem value="revoke_product">Revoke Product</SelectItem>
                  <SelectItem value="impersonate_start">Impersonation</SelectItem>
                  <SelectItem value="update_setting">Setting Change</SelectItem>
                  <SelectItem value="regenerate_password">Password regenerated</SelectItem>
                  <SelectItem value="notify_password">Password notification sent</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filters.entityType} onValueChange={(v) => setFilters({ ...filters, entityType: v === "all" ? "" : v })}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Entity Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entities</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="ticket">Ticket</SelectItem>
                  <SelectItem value="admin_note">Admin Note</SelectItem>
                  <SelectItem value="system_setting">System Setting</SelectItem>
                  <SelectItem value="flexy_credentials">Flexy credentials</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" className="w-40" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} placeholder="Start Date" />
              <Input type="date" className="w-40" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} placeholder="End Date" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : logs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No audit log entries found</div>
            ) : (
              <div className="divide-y">
                {logs.map((log) => (
                  <div key={log.id}>
                    <div className="flex items-center gap-4 p-4 hover:bg-muted/30 cursor-pointer transition-colors" onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{log.description}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[10px]">{log.actionType}</Badge>
                          <Badge variant="secondary" className="text-[10px]">{log.entityType}</Badge>
                          {log.actorEmail && <span className="text-[10px] text-muted-foreground">{log.actorEmail}</span>}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {log.createdAt ? format(new Date(log.createdAt), "MMM d, yyyy h:mm a") : ""}
                      </span>
                      {expandedId === log.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    {expandedId === log.id && (
                      <div className="px-4 pb-4 bg-muted/20">
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div><span className="text-muted-foreground">Entity ID:</span> {log.entityId || "N/A"}</div>
                          <div><span className="text-muted-foreground">IP Address:</span> {log.ipAddress || "N/A"}</div>
                          <div><span className="text-muted-foreground">User Agent:</span> <span className="truncate block max-w-md">{log.userAgent || "N/A"}</span></div>
                          <div><span className="text-muted-foreground">Actor ID:</span> {log.actorId || "N/A"}</div>
                        </div>
                        {log.changeDiff && (
                          <div className="mt-3">
                            <p className="text-xs text-muted-foreground mb-1">Changes:</p>
                            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(log.changeDiff, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {((pagination.page - 1) * pagination.limit) + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => load(pagination.page - 1)}><ChevronLeft className="w-4 h-4" /></Button>
              <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => load(pagination.page + 1)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
