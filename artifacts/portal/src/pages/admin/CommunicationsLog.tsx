import { useState, useEffect } from "react";
import { CommunicationsLayout } from "@/components/layout/CommunicationsLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { commsApi } from "@/lib/communications-api";
import { Search, ChevronLeft, ChevronRight, Mail, MessageSquare, Eye, ShieldAlert } from "lucide-react";
import { format } from "date-fns";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    queued: "bg-gray-100 text-gray-800",
    sent: "bg-blue-100 text-blue-800",
    delivered: "bg-green-100 text-green-800",
    opened: "bg-purple-100 text-purple-800",
    clicked: "bg-indigo-100 text-indigo-800",
    bounced: "bg-red-100 text-red-800",
    failed: "bg-red-100 text-red-800",
  };
  return <Badge className={colors[status] || "bg-gray-100 text-gray-800"}>{status}</Badge>;
}

export default function CommunicationsLog() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailEntry, setDetailEntry] = useState<any>(null);
  const [bouncesOpen, setBouncesOpen] = useState(false);
  const [bounces, setBounces] = useState<any[]>([]);

  async function load() {
    try {
      setLoading(true);
      const params: Record<string, string> = { page: page.toString(), limit: "50" };
      if (search) params.search = search;
      if (channel !== "all") params.channel = channel;
      if (status !== "all") params.status = status;
      const result = await commsApi.getLog(params);
      setLogs(result.data);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [page, channel, status]);

  function handleSearch() { setPage(1); load(); }

  async function viewDetail(id: number) {
    try {
      const entry = await commsApi.getLogEntry(id);
      setDetailEntry(entry);
      setDetailOpen(true);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function loadBounces() {
    try {
      const data = await commsApi.getBounces();
      setBounces(data);
      setBouncesOpen(true);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleUnsuppress(id: number) {
    try {
      await commsApi.unsuppressBounce(id);
      toast({ title: "Bounce unsuppressed" });
      setBounces(bounces.map(b => b.id === id ? { ...b, suppressed: false } : b));
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  return (
    <CommunicationsLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Communication Log</h1>
            <p className="text-sm text-muted-foreground mt-1">Search and filter all sent communications</p>
          </div>
          <Button variant="outline" onClick={loadBounces}>
            <ShieldAlert className="w-4 h-4 mr-2" />Bounces
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by email or subject..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              className="pl-10"
            />
          </div>
          <Select value={channel} onValueChange={v => { setChannel(v); setPage(1); }}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Channel" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Channels</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="opened">Opened</SelectItem>
              <SelectItem value="bounced">Bounced</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleSearch}>Search</Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No log entries found</div>
        ) : (
          <>
            <div className="text-sm text-muted-foreground">{total} total entries</div>
            <div className="space-y-2">
              {logs.map((entry: any) => (
                <Card
                  key={entry.log.id}
                  className="p-3 cursor-pointer hover:border-primary/30 transition-colors"
                  onClick={() => viewDetail(entry.log.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {entry.log.channel === "email" ? (
                        <Mail className="w-4 h-4 text-blue-500" />
                      ) : (
                        <MessageSquare className="w-4 h-4 text-green-500" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{entry.userName || entry.log.recipientEmail || entry.log.recipientPhone}</span>
                          <StatusBadge status={entry.log.status} />
                          {entry.log.templateSlug && (
                            <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{entry.log.templateSlug}</span>
                          )}
                          {entry.log.category && (
                            <Badge variant="outline" className="text-[10px]">{entry.log.category}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          {entry.log.subject && <span>Subject: {entry.log.subject}</span>}
                          <span>{format(new Date(entry.log.createdAt), "MMM d, yyyy h:mm a")}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {entry.log.openedAt && <span className="text-purple-600">Opened</span>}
                      {entry.log.clickedAt && <span className="text-indigo-600">Clicked</span>}
                      {entry.log.bouncedAt && <span className="text-red-600">Bounced</span>}
                      <Eye className="w-3 h-3" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
                <ChevronLeft className="w-4 h-4 mr-1" />Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                Next<ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </>
        )}
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Communication Details</DialogTitle>
          </DialogHeader>
          {detailEntry && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Recipient</label>
                  <p className="text-sm">{detailEntry.userName} ({detailEntry.userEmail || detailEntry.log.recipientEmail || detailEntry.log.recipientPhone})</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Channel</label>
                  <p className="text-sm">{detailEntry.log.channel}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <StatusBadge status={detailEntry.log.status} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Sent</label>
                  <p className="text-sm">{format(new Date(detailEntry.log.createdAt), "MMM d, yyyy h:mm:ss a")}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Delivered</label>
                  <p>{detailEntry.log.deliveredAt ? format(new Date(detailEntry.log.deliveredAt), "h:mm a") : "-"}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Opened</label>
                  <p>{detailEntry.log.openedAt ? format(new Date(detailEntry.log.openedAt), "h:mm a") : "-"}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Clicked</label>
                  <p>{detailEntry.log.clickedAt ? format(new Date(detailEntry.log.clickedAt), "h:mm a") : "-"}</p>
                </div>
              </div>

              {detailEntry.log.errorMessage && (
                <div className="bg-red-50 p-3 rounded text-sm text-red-700">
                  <strong>Error:</strong> {detailEntry.log.errorMessage}
                </div>
              )}

              {detailEntry.log.renderedHtml && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Rendered Content</label>
                  <Tabs defaultValue="html">
                    <TabsList>
                      <TabsTrigger value="html">HTML</TabsTrigger>
                      <TabsTrigger value="text">Text</TabsTrigger>
                    </TabsList>
                    <TabsContent value="html">
                      <div className="border rounded-lg overflow-hidden">
                        <iframe srcDoc={detailEntry.log.renderedHtml} className="w-full h-[300px]" title="Content" sandbox="" />
                      </div>
                    </TabsContent>
                    <TabsContent value="text">
                      <pre className="text-xs bg-muted p-4 rounded whitespace-pre-wrap">{detailEntry.log.renderedText}</pre>
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={bouncesOpen} onOpenChange={setBouncesOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bounced Emails</DialogTitle>
          </DialogHeader>
          {bounces.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No bounces recorded</p>
          ) : (
            <div className="space-y-2">
              {bounces.map(b => (
                <Card key={b.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{b.email}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <Badge variant={b.bounceType === "hard" ? "destructive" : "secondary"} className="text-[10px]">{b.bounceType}</Badge>
                        {b.reason && <span>{b.reason}</span>}
                        <span>{format(new Date(b.bouncedAt), "MMM d, yyyy")}</span>
                        {b.suppressed && <Badge variant="outline" className="text-[10px]">Suppressed</Badge>}
                      </div>
                    </div>
                    {b.suppressed && (
                      <Button variant="outline" size="sm" onClick={() => handleUnsuppress(b.id)}>Unsuppress</Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </CommunicationsLayout>
  );
}
