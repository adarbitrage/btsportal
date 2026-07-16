import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, Users, TrendingUp, Flag, BarChart3, Clock } from "lucide-react";
import { fetchChatAnalytics } from "@/lib/admin-api";

function StatCard({ title, value, icon: Icon, description }: { title: string; value: string | number; icon: any; description?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
          </div>
          <Icon className="w-8 h-8 text-primary opacity-60" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function ChatAnalytics() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-chat-analytics"],
    queryFn: fetchChatAnalytics,
    refetchInterval: 60000,
  });

  const maxHourCount = data?.peakHours?.reduce((max: number, h: any) => Math.max(max, h.count), 0) || 1;

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Chat Analytics</h1>
          <p className="text-muted-foreground mt-1">Monitor AI chat usage and performance metrics.</p>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading analytics...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Messages Today" value={data?.messages?.today ?? 0} icon={MessageSquare} />
              <StatCard title="Messages This Week" value={data?.messages?.week ?? 0} icon={TrendingUp} />
              <StatCard title="Messages This Month" value={data?.messages?.month ?? 0} icon={BarChart3} />
              <StatCard title="Total Messages" value={data?.messages?.total ?? 0} icon={MessageSquare} description={`${data?.totalSessions ?? 0} sessions`} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <StatCard title="Avg Messages / User / Day" value={data?.avgMessagesPerUserPerDay ?? 0} icon={Users} />
              <StatCard title="Flagged Messages" value={data?.flaggedMessages ?? 0} icon={Flag} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Peak Usage Hours (UTC, Last 30 Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!data?.peakHours?.length ? (
                  <p className="text-muted-foreground text-sm">No hourly data yet.</p>
                ) : (
                  <div className="flex items-end gap-1 h-40">
                    {Array.from({ length: 24 }, (_, i) => {
                      const hourData = data.peakHours.find((h: any) => h.hour === i);
                      const count = hourData?.count ?? 0;
                      const height = maxHourCount > 0 ? (count / maxHourCount) * 100 : 0;
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full flex items-end justify-center" style={{ height: "120px" }}>
                            <div
                              className="w-full bg-primary/70 rounded-t transition-all hover:bg-primary"
                              style={{ height: `${Math.max(2, height)}%` }}
                              title={`${i}:00 UTC - ${count} messages`}
                            />
                          </div>
                          <span className="text-[9px] text-muted-foreground">{i}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
