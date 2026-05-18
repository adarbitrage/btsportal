import { useState, useEffect } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Search, ChevronLeft, ChevronRight, Eye, Download, Loader2 } from "lucide-react";
import { adminPanelApi, saveBlobAsFile, type StreamDownloadProgress } from "@/lib/admin-panel-api";
import { formatDownloadProgress } from "@/lib/download-progress";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const SOURCE_ANY = "any";
const SOURCE_DIRECT = "direct";

function formatSourceLabel(source: string): string {
  if (source === SOURCE_ANY) return "Any source";
  if (source === SOURCE_DIRECT) return "Direct";
  return source.toUpperCase();
}

export default function AdminMembers() {
  const [members, setMembers] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [search, setSearch] = useState("");
  const [externalSource, setExternalSource] = useState<string>(SOURCE_ANY);
  const [externalOrderId, setExternalOrderId] = useState("");
  const [availableSources, setAvailableSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Tracks an in-flight export so we can disable the button (no double
  // submits) and surface a streamed bytes/rows hint while a wide member
  // export is being pulled down. `null` whenever no export is running.
  const [exportProgress, setExportProgress] = useState<StreamDownloadProgress | null>(null);
  const { toast } = useToast();

  const load = async (page = 1) => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getMembers({
        page,
        search: search || undefined,
        externalSource: externalSource && externalSource !== SOURCE_ANY ? externalSource : undefined,
        externalOrderId: externalOrderId || undefined,
      });
      setMembers(data.members);
      setPagination(data.pagination);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    // Best-effort populate of the source-filter dropdown. The endpoint
    // is read-only and the filter still works (the value is sent through
    // either way) if the request fails, so we just log and move on.
    adminPanelApi
      .getMemberExternalSources()
      .then((data) => setAvailableSources(data.sources ?? []))
      .catch(() => setAvailableSources([]));
  }, []);

  const handleSearch = () => { load(1); };

  const handleExport = async () => {
    // Belt-and-braces: the button is also disabled while an export runs,
    // but a stale Enter key / double-tap could still re-enter this handler
    // before React re-renders the disabled state.
    if (exportProgress) return;
    setExportProgress({ bytesReceived: 0, rowsReceived: null });
    try {
      const { blob } = await adminPanelApi.exportData(
        "members",
        "csv",
        undefined,
        undefined,
        (progress) => setExportProgress(progress),
      );
      saveBlobAsFile(blob, "members-export.csv");
      toast({ title: "Export complete" });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExportProgress(null);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="w-6 h-6" /> Members</h1>
            <p className="text-muted-foreground mt-1">Manage all platform members</p>
          </div>
          <div className="flex items-center gap-3">
            {exportProgress && (
              <span
                className="text-xs text-muted-foreground tabular-nums"
                aria-live="polite"
                data-testid="text-export-progress"
              >
                {formatDownloadProgress({
                  bytesReceived: exportProgress.bytesReceived,
                  rowsReceived: exportProgress.rowsReceived,
                })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!!exportProgress}
              data-testid="button-export-members"
            >
              {exportProgress ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-1" />
              )}
              {exportProgress ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} placeholder="Search by name or email..." className="pl-10" data-testid="input-search-members" />
              </div>
              <Button onClick={handleSearch} data-testid="button-search-members">Search</Button>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="sm:w-48">
                <Select value={externalSource} onValueChange={setExternalSource}>
                  <SelectTrigger data-testid="select-external-source">
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SOURCE_ANY}>{formatSourceLabel(SOURCE_ANY)}</SelectItem>
                    <SelectItem value={SOURCE_DIRECT}>{formatSourceLabel(SOURCE_DIRECT)}</SelectItem>
                    {availableSources.map((s) => (
                      <SelectItem key={s} value={s}>{formatSourceLabel(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="relative flex-1">
                <Input
                  value={externalOrderId}
                  onChange={(e) => setExternalOrderId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Find by external order ID (e.g. YSE order ABC-123)"
                  data-testid="input-external-order-id"
                />
              </div>
              <Button variant="outline" onClick={handleSearch} data-testid="button-apply-filters">Apply</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : members.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No members found</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-4 text-xs font-medium text-muted-foreground">Name</th>
                    <th className="p-4 text-xs font-medium text-muted-foreground">Email</th>
                    <th className="p-4 text-xs font-medium text-muted-foreground">Role</th>
                    <th className="p-4 text-xs font-medium text-muted-foreground">Source</th>
                    <th className="p-4 text-xs font-medium text-muted-foreground">Joined</th>
                    <th className="p-4 text-xs font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {members.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-4 text-sm font-medium">{m.name}</td>
                      <td className="p-4 text-sm text-muted-foreground">{m.email}</td>
                      <td className="p-4"><Badge variant="outline" className="text-[10px]">{m.role}</Badge></td>
                      <td className="p-4 text-sm text-muted-foreground">{m.sourceProduct || "N/A"}</td>
                      <td className="p-4 text-sm text-muted-foreground">{m.memberSince ? format(new Date(m.memberSince), "MMM d, yyyy") : ""}</td>
                      <td className="p-4">
                        <Link href={`/admin/members/${m.id}`}>
                          <Button variant="ghost" size="sm"><Eye className="w-4 h-4" /></Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</p>
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
