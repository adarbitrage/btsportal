import { useState, useEffect } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, TrendingUp, AlertTriangle, Clock, Activity, ArrowRight, ShieldAlert, Package, Mic } from "lucide-react";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function AdminDashboard() {
  const [kpis, setKpis] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const load = async () => {
      try {
        const [kpiData, alertData, activityData] = await Promise.all([
          adminPanelApi.getDashboardKpis(),
          adminPanelApi.getNeedsAttention(),
          adminPanelApi.getRecentActivity(),
        ]);
        setKpis(kpiData);
        setAlerts(alertData);
        setRecentActivity(activityData);
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const statCards = kpis ? [
    { label: "Total Members", value: kpis.totalMembers, icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "New Members (30d)", value: kpis.newMembers30d, icon: TrendingUp, color: "text-green-600", bg: "bg-green-50" },
    { label: "Active Subscriptions", value: kpis.activeSubscriptions, icon: Package, color: "text-purple-600", bg: "bg-purple-50" },
  ] : [];

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your platform</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => (
              <Card key={i}><CardContent className="p-6"><div className="h-16 bg-muted animate-pulse rounded" /></CardContent></Card>
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {statCards.map((stat) => (
                <Card key={stat.label}>
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${stat.bg}`}>
                        <stat.icon className={`w-5 h-5 ${stat.color}`} />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{stat.value.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">{stat.label}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {alerts.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    Needs Attention
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {alerts.map((alert, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <div className="flex items-center gap-3">
                          <Badge variant={alert.severity === "high" ? "destructive" : alert.severity === "medium" ? "default" : "secondary"}>
                            {alert.severity}
                          </Badge>
                          <div>
                            <p className="font-medium text-sm">{alert.title}</p>
                            <p className="text-xs text-muted-foreground">{alert.description}</p>
                            <AlertThresholdProvenance alert={alert} />
                          </div>
                        </div>
                        {alert.link && (
                          <Link href={alert.link}>
                            <Button variant="ghost" size="sm"><ArrowRight className="w-4 h-4" /></Button>
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Activity className="w-5 h-5 text-primary" />
                    Quick Actions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    <Link href="/admin/members"><Button variant="outline" className="w-full justify-start gap-2"><Users className="w-4 h-4" />Members</Button></Link>
                    <Link href="/admin/audit-log"><Button variant="outline" className="w-full justify-start gap-2"><Clock className="w-4 h-4" />Audit Log</Button></Link>
                    <Link href="/admin/system"><Button variant="outline" className="w-full justify-start gap-2"><Activity className="w-4 h-4" />System Health</Button></Link>
                    <Link href="/admin/voice"><Button variant="outline" className="w-full justify-start gap-2"><Mic className="w-4 h-4" />Voice Usage</Button></Link>
                    <Link href="/admin/settings"><Button variant="outline" className="w-full justify-start gap-2"><ShieldAlert className="w-4 h-4" />Settings</Button></Link>
                    <Link href="/admin/commissions"><Button variant="outline" className="w-full justify-start gap-2"><TrendingUp className="w-4 h-4" />Commissions</Button></Link>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Clock className="w-5 h-5 text-primary" />
                    Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-80 overflow-y-auto">
                    {recentActivity.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No recent activity</p>
                    ) : (
                      recentActivity.slice(0, 10).map((log: any) => (
                        <div key={log.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{log.description}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant="outline" className="text-[10px]">{log.actionType}</Badge>
                              <span className="text-[10px] text-muted-foreground">
                                {log.createdAt ? format(new Date(log.createdAt), "MMM d, h:mm a") : ""}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

/**
 * Render a small "tuned to N hits / M min by <admin> on <date>" sub-line
 * underneath an alert's description when the alert payload carries
 * `thresholds` and `lastTuned` provenance (currently only the auth
 * rate-limit burst alert does). Falls back gracefully on any of the
 * shapes being absent — the dashboard endpoint omits both for alerts
 * that don't have tunable thresholds.
 */
function AlertThresholdProvenance({ alert }: { alert: any }) {
  const thresholds = alert?.thresholds as
    | { threshold: number; windowMinutes: number }
    | undefined;
  const lastTuned = alert?.lastTuned as
    | {
        at: string;
        actorId: number | null;
        actorEmail: string | null;
        actorName: string | null;
        changedFields: string[];
      }
    | null
    | undefined;

  if (!thresholds) return null;

  const tunedSummary = `Tuned to ${thresholds.threshold} hits / ${thresholds.windowMinutes} min`;

  if (!lastTuned) {
    return (
      <p
        className="text-[11px] text-muted-foreground mt-1"
        data-testid="alert-threshold-provenance"
      >
        {tunedSummary} (still on default thresholds).
      </p>
    );
  }

  const actor = lastTuned.actorName && lastTuned.actorEmail
    ? `${lastTuned.actorName} (${lastTuned.actorEmail})`
    : lastTuned.actorName || lastTuned.actorEmail || "an admin";

  let when = lastTuned.at;
  try {
    const d = new Date(lastTuned.at);
    if (!Number.isNaN(d.getTime())) when = format(d, "MMM d, yyyy");
  } catch {
    // Fall through to the raw ISO string below.
  }

  return (
    <p
      className="text-[11px] text-muted-foreground mt-1"
      data-testid="alert-threshold-provenance"
    >
      {tunedSummary} by {actor} on {when}.
    </p>
  );
}
