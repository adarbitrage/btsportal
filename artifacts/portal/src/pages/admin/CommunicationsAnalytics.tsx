import { useState, useEffect } from "react";
import { CommunicationsLayout } from "@/components/layout/CommunicationsLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { commsApi } from "@/lib/communications-api";
import {
  Mail, MessageSquare, Send, CheckCircle2, Eye, MousePointerClick,
  AlertTriangle, DollarSign, TrendingUp, BarChart3, Users,
} from "lucide-react";

function StatCard({ icon: Icon, label, value, color, sub }: {
  icon: any; label: string; value: string | number; color: string; sub?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className="text-xl font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}

export default function CommunicationsAnalytics() {
  const { toast } = useToast();
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");

  async function load() {
    try {
      setLoading(true);
      setAnalytics(await commsApi.getAnalytics(period));
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [period]);

  if (loading) {
    return (
      <CommunicationsLayout>
        <div className="text-center py-12 text-muted-foreground">Loading analytics...</div>
      </CommunicationsLayout>
    );
  }

  if (!analytics) {
    return (
      <CommunicationsLayout>
        <div className="text-center py-12 text-muted-foreground">Failed to load analytics</div>
      </CommunicationsLayout>
    );
  }

  const emailOpenRate = analytics.email.sent > 0
    ? ((analytics.email.opened / analytics.email.sent) * 100).toFixed(1)
    : "0";
  const emailClickRate = analytics.email.sent > 0
    ? ((analytics.email.clicked / analytics.email.sent) * 100).toFixed(1)
    : "0";
  const emailBounceRate = analytics.email.sent > 0
    ? ((analytics.email.bounced / analytics.email.sent) * 100).toFixed(1)
    : "0";

  return (
    <CommunicationsLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Communication Analytics</h1>
            <p className="text-sm text-muted-foreground mt-1">Monitor delivery performance and engagement</p>
          </div>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">Last 7 Days</SelectItem>
              <SelectItem value="month">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Mail className="w-5 h-5 text-blue-500" />Email Stats</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard icon={Send} label="Sent" value={analytics.email.sent} color="bg-blue-50 text-blue-600" />
            <StatCard icon={CheckCircle2} label="Delivered" value={analytics.email.delivered} color="bg-green-50 text-green-600" />
            <StatCard icon={Eye} label="Opened" value={analytics.email.opened} color="bg-purple-50 text-purple-600" sub={`${emailOpenRate}% rate`} />
            <StatCard icon={MousePointerClick} label="Clicked" value={analytics.email.clicked} color="bg-indigo-50 text-indigo-600" sub={`${emailClickRate}% rate`} />
            <StatCard icon={AlertTriangle} label="Bounced" value={analytics.email.bounced} color="bg-red-50 text-red-600" sub={`${emailBounceRate}% rate`} />
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><MessageSquare className="w-5 h-5 text-green-500" />SMS Stats</h2>
          <div className="grid grid-cols-3 gap-4">
            <StatCard icon={Send} label="Sent" value={analytics.sms.sent} color="bg-green-50 text-green-600" />
            <StatCard icon={CheckCircle2} label="Delivered" value={analytics.sms.delivered} color="bg-emerald-50 text-emerald-600" />
            <StatCard icon={AlertTriangle} label="Failed" value={analytics.sms.failed} color="bg-red-50 text-red-600" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <StatCard icon={Users} label="Unsubscribes" value={analytics.unsubscribes} color="bg-orange-50 text-orange-600" sub="this period" />
          <StatCard icon={DollarSign} label="Estimated Cost" value={`$${analytics.estimatedCost.total.toFixed(2)}`} color="bg-amber-50 text-amber-600"
            sub={`Email: $${analytics.estimatedCost.email.toFixed(2)} | SMS: $${analytics.estimatedCost.sms.toFixed(2)}`} />
        </div>

        {analytics.topTemplates.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" />Top Templates</h2>
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium">Template</th>
                    <th className="text-right p-3 font-medium">Total</th>
                    <th className="text-right p-3 font-medium">Opened</th>
                    <th className="text-right p-3 font-medium">Open Rate</th>
                    <th className="text-right p-3 font-medium">Clicked</th>
                    <th className="text-right p-3 font-medium">Click Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.topTemplates.map((t: any) => (
                    <tr key={t.templateSlug} className="border-b last:border-0">
                      <td className="p-3 font-mono text-xs">{t.templateSlug || "(none)"}</td>
                      <td className="p-3 text-right">{t.total}</td>
                      <td className="p-3 text-right">{t.opened}</td>
                      <td className="p-3 text-right">
                        <Badge variant={t.openRate > 0.3 ? "default" : "secondary"}>
                          {(t.openRate * 100).toFixed(1)}%
                        </Badge>
                      </td>
                      <td className="p-3 text-right">{t.clicked}</td>
                      <td className="p-3 text-right">
                        <Badge variant={t.clickRate > 0.05 ? "default" : "secondary"}>
                          {(t.clickRate * 100).toFixed(1)}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {analytics.sequenceCompletions.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-primary" />Sequence Completion Rates</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {analytics.sequenceCompletions.map((s: any) => (
                <Card key={s.sequenceId} className="p-4">
                  <p className="text-sm font-medium">Sequence #{s.sequenceId}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${(s.completionRate * 100).toFixed(0)}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold">{(s.completionRate * 100).toFixed(0)}%</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{s.completed} / {s.total} completed</p>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </CommunicationsLayout>
  );
}
