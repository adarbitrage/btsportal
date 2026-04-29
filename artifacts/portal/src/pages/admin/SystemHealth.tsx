import { useState, useEffect } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, Database, Globe, Server, Webhook, RefreshCw, Zap, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { useToast } from "@/hooks/use-toast";

interface QueueFallbackEvent {
  id: number;
  createdAt: string | null;
  metadata?: { channel?: string; recipient?: string | null; reason?: string | null } | null;
  entityId?: string | null;
}

const QUEUE_FALLBACK_RECENT_LIMIT = 10;

export default function SystemHealth() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fallbackEvents, setFallbackEvents] = useState<QueueFallbackEvent[]>([]);
  const [fallbackLoading, setFallbackLoading] = useState(true);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const { toast } = useToast();

  const loadFallbackEvents = async () => {
    try {
      setFallbackLoading(true);
      setFallbackError(null);
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const data = await adminPanelApi.getAuditLog({
        actionType: "queue_fallback",
        startDate: since,
        limit: QUEUE_FALLBACK_RECENT_LIMIT,
        page: 1,
      });
      setFallbackEvents(Array.isArray(data?.logs) ? data.logs : []);
    } catch (err: any) {
      setFallbackError(err?.message || "Failed to fetch queue-fallback events");
    } finally {
      setFallbackLoading(false);
    }
  };

  const load = async () => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getSystemHealth();
      setHealth(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
    void loadFallbackEvents();
  };

  useEffect(() => { load(); }, []);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6" /> System Health
            </h1>
            <p className="text-muted-foreground mt-1">Monitor system status and performance</p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>

        {loading && !health ? (
          <div className="p-8 text-center text-muted-foreground">Loading system health...</div>
        ) : health && (
          <>
            <div className="flex items-center gap-3">
              <Badge variant={health.status === "healthy" ? "default" : "destructive"} className="text-sm px-3 py-1">
                {health.status === "healthy" ? "All Systems Operational" : "System Degraded"}
              </Badge>
              <span className="text-sm text-muted-foreground">Last checked: {health.serverTime ? new Date(health.serverTime).toLocaleString() : "N/A"}</span>
            </div>

            {health.services?.redis?.queueFallbacks?.alerting && (
              <Card className="border-red-500/40 bg-red-50 dark:bg-red-950/30">
                <CardContent className="py-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium text-red-900 dark:text-red-200">Email/SMS queue is bypassing Redis</p>
                    <p className="text-sm text-red-800/80 dark:text-red-200/80">
                      Members are still receiving messages through the direct-send fallback,
                      but retries and backoff are disabled until Redis recovers. Check the
                      worker and Redis connection.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Server className="w-4 h-4" />API Server</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Status</span><Badge variant={health.services.api.status === "up" ? "default" : "destructive"}>{health.services.api.status}</Badge></div>
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Uptime</span><span className="text-sm font-medium">{formatUptime(health.services.api.uptime)}</span></div>
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Node Version</span><span className="text-sm font-medium">{health.nodeVersion}</span></div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Database className="w-4 h-4" />Database</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Status</span><Badge variant={health.services.database.status === "up" ? "default" : "destructive"}>{health.services.database.status}</Badge></div>
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Total Users</span><span className="text-sm font-medium">{health.services.database.totalUsers?.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Total Tickets</span><span className="text-sm font-medium">{health.services.database.totalTickets?.toLocaleString()}</span></div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Webhook className="w-4 h-4" />Webhooks (24h)</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Total</span><span className="text-sm font-medium">{health.webhooks.last24h}</span></div>
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Failed</span><span className={`text-sm font-medium ${health.webhooks.failed24h > 0 ? "text-red-600" : ""}`}>{health.webhooks.failed24h}</span></div>
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Audit Events</span><span className="text-sm font-medium">{health.auditLogs.last24h}</span></div>
                  </div>
                </CardContent>
              </Card>

              {health.services?.redis && (
                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><Zap className="w-4 h-4" />Redis / Comms Queue</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Status</span>
                        <Badge variant={health.services.redis.status === "up" ? "default" : "warning"}>
                          {health.services.redis.status}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Email fallbacks (5m / 1h / 24h)</span>
                        <span className={`text-sm font-medium ${health.services.redis.queueFallbacks?.email?.recentCount > 0 ? "text-red-600" : ""}`}>
                          {health.services.redis.queueFallbacks?.email?.recentCount ?? 0} /{" "}
                          {health.services.redis.queueFallbacks?.email?.hourCount ?? 0} /{" "}
                          {health.services.redis.queueFallbacks?.email?.dayCount ?? 0}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">SMS fallbacks (5m / 1h / 24h)</span>
                        <span className={`text-sm font-medium ${health.services.redis.queueFallbacks?.sms?.recentCount > 0 ? "text-red-600" : ""}`}>
                          {health.services.redis.queueFallbacks?.sms?.recentCount ?? 0} /{" "}
                          {health.services.redis.queueFallbacks?.sms?.hourCount ?? 0} /{" "}
                          {health.services.redis.queueFallbacks?.sms?.dayCount ?? 0}
                        </span>
                      </div>
                      {(health.services.redis.queueFallbacks?.email?.lastAt || health.services.redis.queueFallbacks?.sms?.lastAt) && (
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Last fallback</span>
                          <span className="text-sm font-medium">
                            {new Date(
                              [
                                health.services.redis.queueFallbacks?.email?.lastAt,
                                health.services.redis.queueFallbacks?.sms?.lastAt,
                              ]
                                .filter(Boolean)
                                .sort()
                                .pop() as string,
                            ).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />Recent Queue Fallback Events (24h)
                  </CardTitle>
                  <Link href="/admin/audit-log?actionType=queue_fallback" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                    View all <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                {fallbackLoading ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">Loading recent fallback events...</div>
                ) : fallbackError ? (
                  <div className="py-6 text-center text-sm text-red-600">{fallbackError}</div>
                ) : fallbackEvents.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">No fallback events in the last 24h</div>
                ) : (
                  <div className="divide-y">
                    {fallbackEvents.map((evt) => {
                      const channel = evt.metadata?.channel || evt.entityId || "unknown";
                      const recipient = evt.metadata?.recipient || "redacted";
                      const when = evt.createdAt ? new Date(evt.createdAt) : null;
                      return (
                        <div key={evt.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="outline" className="text-[10px] uppercase shrink-0">{channel}</Badge>
                            <span className="text-muted-foreground truncate">{recipient}</span>
                            {evt.metadata?.reason && (
                              <span className="text-[10px] text-muted-foreground/80 shrink-0">({evt.metadata.reason})</span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {when ? when.toLocaleString() : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Globe className="w-4 h-4" />Memory Usage</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {health.memoryUsage && Object.entries(health.memoryUsage).map(([key, value]) => (
                    <div key={key} className="p-3 bg-muted/50 rounded-lg">
                      <p className="text-lg font-bold">{formatBytes(value as number)}</p>
                      <p className="text-xs text-muted-foreground">{key.replace(/([A-Z])/g, " $1").trim()}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
