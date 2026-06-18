import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  adminPanelApi,
  type VoiceUsageResponse,
  type VoiceCallsResponse,
  type VoiceCallDetail,
} from "@/lib/admin-panel-api";
import {
  Mic,
  Clock,
  PhoneCall,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";

type Period = "today" | "week" | "month";
const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
];

const CALLS_PAGE_SIZE = 25;

function formatMinutes(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  return formatMinutes(seconds);
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status.toLowerCase();
  if (s === "ended" || s === "completed") return "secondary";
  if (s === "error" || s === "failed") return "destructive";
  if (s === "ongoing" || s === "in_progress") return "default";
  return "outline";
}

export default function VoiceUsage() {
  const { toast } = useToast();

  const [usage, setUsage] = useState<VoiceUsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("month");

  const [calls, setCalls] = useState<VoiceCallsResponse | null>(null);
  const [callsLoading, setCallsLoading] = useState(true);
  const [callsPage, setCallsPage] = useState(1);
  const [drillUser, setDrillUser] = useState<{ id: number; name: string } | null>(null);

  const [detail, setDetail] = useState<VoiceCallDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const loadUsage = useCallback(
    async (p: Period) => {
      setUsageLoading(true);
      try {
        const data = await adminPanelApi.getVoiceUsage({ period: p, limit: 20 });
        setUsage(data);
      } catch (err) {
        toast({
          title: "Failed to load voice usage",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setUsageLoading(false);
      }
    },
    [toast],
  );

  const loadCalls = useCallback(
    async (page: number, userId?: number) => {
      setCallsLoading(true);
      try {
        const data = await adminPanelApi.getVoiceCalls({
          page,
          limit: CALLS_PAGE_SIZE,
          userId,
        });
        setCalls(data);
      } catch (err) {
        toast({
          title: "Failed to load calls",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setCallsLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    loadUsage(period);
  }, [period, loadUsage]);

  useEffect(() => {
    loadCalls(callsPage, drillUser?.id);
  }, [callsPage, drillUser, loadCalls]);

  const openDetail = useCallback(
    async (id: number) => {
      setDetailOpen(true);
      setDetail(null);
      setDetailLoading(true);
      try {
        const { call } = await adminPanelApi.getVoiceCall(id);
        setDetail(call);
      } catch (err) {
        toast({
          title: "Failed to load call",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
        setDetailOpen(false);
      } finally {
        setDetailLoading(false);
      }
    },
    [toast],
  );

  const drillIntoMember = (id: number, name: string) => {
    setDrillUser({ id, name });
    setCallsPage(1);
  };

  const clearDrill = () => {
    setDrillUser(null);
    setCallsPage(1);
  };

  const totals = usage?.totals;
  const totalPages = calls ? Math.max(1, Math.ceil(calls.total / calls.limit)) : 1;

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
              <Mic className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Voice Usage</h1>
              <p className="text-sm text-muted-foreground">
                Track member voice minutes, spot heavy users, and audit calls.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadUsage(period);
              loadCalls(callsPage, drillUser?.id);
            }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(["today", "week", "month"] as const).map((key) => {
            const label = key === "today" ? "Today" : key === "week" ? "Last 7 Days" : "Last 30 Days";
            const win = totals?.[key];
            return (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    {label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {usageLoading ? (
                    <Skeleton className="h-9 w-28" />
                  ) : (
                    <>
                      <div className="text-3xl font-bold tracking-tight">
                        {formatMinutes(win?.seconds ?? 0)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <PhoneCall className="w-3 h-3" />
                        {win?.calls ?? 0} {win?.calls === 1 ? "call" : "calls"}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Top members */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <CardTitle className="text-base">Top Members by Usage</CardTitle>
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    period === p.value
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {usageLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !usage || usage.topMembers.members.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No voice usage recorded for this period.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead className="text-right">Minutes Used</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.topMembers.members.map((m) => (
                    <TableRow key={m.userId}>
                      <TableCell>
                        <div className="font-medium">{m.name || "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMinutes(m.secondsUsed)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.callCount}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => drillIntoMember(m.userId, m.name || m.email)}
                        >
                          View calls
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Calls */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <div className="flex items-center gap-3">
              {drillUser && (
                <Button variant="outline" size="sm" onClick={clearDrill}>
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  All calls
                </Button>
              )}
              <CardTitle className="text-base">
                {drillUser ? `Calls — ${drillUser.name}` : "All Calls"}
              </CardTitle>
            </div>
            {calls && (
              <span className="text-xs text-muted-foreground">{calls.total} total</span>
            )}
          </CardHeader>
          <CardContent>
            {callsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !calls || calls.calls.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No calls found.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calls.calls.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="font-medium">{c.name || "Unknown"}</div>
                          <div className="text-xs text-muted-foreground">{c.email}</div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(c.startedAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(c.status)}>{c.status || "unknown"}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatDuration(c.durationSeconds)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDetail(c.id)}
                            disabled={!c.hasTranscript && !c.hasSummary}
                            title={
                              !c.hasTranscript && !c.hasSummary
                                ? "No transcript or summary for this call"
                                : "View transcript & summary"
                            }
                          >
                            <FileText className="w-4 h-4 mr-1" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex items-center justify-between mt-4">
                  <span className="text-xs text-muted-foreground">
                    Page {calls.page} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={callsPage <= 1}
                      onClick={() => setCallsPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={callsPage >= totalPages}
                      onClick={() => setCallsPage((p) => p + 1)}
                    >
                      Next
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Call Detail</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading…
            </div>
          ) : detail ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Member</div>
                  <div className="font-medium">{detail.name || "Unknown"}</div>
                  <div className="text-xs text-muted-foreground">{detail.email}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Status</div>
                  <Badge variant={statusVariant(detail.status)}>{detail.status || "unknown"}</Badge>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Started</div>
                  <div>{formatDateTime(detail.startedAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Duration</div>
                  <div>{formatDuration(detail.durationSeconds)}</div>
                </div>
                {detail.disconnectReason && (
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">Disconnect reason</div>
                    <div>{detail.disconnectReason}</div>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Summary</h3>
                {detail.summary ? (
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground bg-muted/50 rounded-lg p-3">
                    {detail.summary}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No summary available.</p>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Transcript</h3>
                {detail.transcript ? (
                  <pre className="text-xs whitespace-pre-wrap font-sans text-muted-foreground bg-muted/50 rounded-lg p-3 max-h-80 overflow-y-auto">
                    {detail.transcript}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No transcript available.</p>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
