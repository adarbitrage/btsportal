import { CoachingAdminLayout } from "@/components/layout/CoachingAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCoachingAnalytics } from "@/lib/coaching-admin-api";
import {
  Calendar,
  TrendingUp,
  TrendingDown,
  Star,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Users,
  FileText,
  Target,
} from "lucide-react";

export default function CoachingAnalytics() {
  const { data: analytics, isLoading } = useCoachingAnalytics();

  if (isLoading) {
    return (
      <CoachingAdminLayout>
        <div className="py-12 text-center text-muted-foreground">Loading analytics...</div>
      </CoachingAdminLayout>
    );
  }

  if (!analytics) {
    return (
      <CoachingAdminLayout>
        <div className="py-12 text-center text-muted-foreground">Failed to load analytics</div>
      </CoachingAdminLayout>
    );
  }

  const totalSessions = analytics.completed + analytics.cancelled + analytics.noShow + analytics.scheduled + analytics.creditReturned;
  const completedRate = totalSessions > 0 ? Math.round((analytics.completed / totalSessions) * 100) : 0;
  const cancelledRate = totalSessions > 0 ? Math.round((analytics.cancelled / totalSessions) * 100) : 0;
  const noShowRate = totalSessions > 0 ? Math.round((analytics.noShow / totalSessions) * 100) : 0;
  const monthChange = analytics.sessionsLastMonth > 0
    ? Math.round(((analytics.sessionsThisMonth - analytics.sessionsLastMonth) / analytics.sessionsLastMonth) * 100)
    : analytics.sessionsThisMonth > 0 ? 100 : 0;
  const actionItemCompletionRate = analytics.actionItemsTotal > 0
    ? Math.round((analytics.actionItemsCompleted / analytics.actionItemsTotal) * 100)
    : 0;

  return (
    <CoachingAdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Coaching Analytics</h1>
          <p className="text-muted-foreground mt-1">Performance metrics for 1-on-1 coaching sessions</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{analytics.sessionsThisMonth}</p>
                  <p className="text-sm text-muted-foreground">This Month</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1">
                {monthChange >= 0 ? (
                  <TrendingUp className="w-4 h-4 text-green-600" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-600" />
                )}
                <span className={`text-sm font-medium ${monthChange >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {monthChange >= 0 ? "+" : ""}{monthChange}%
                </span>
                <span className="text-xs text-muted-foreground ml-1">vs last month ({analytics.sessionsLastMonth})</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{completedRate}%</p>
                  <p className="text-sm text-muted-foreground">Completed Rate</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{analytics.completed} of {totalSessions} sessions</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                  <Star className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{analytics.averageRating ?? "—"}</p>
                  <p className="text-sm text-muted-foreground">Avg Rating</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Out of 5 stars</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{noShowRate}%</p>
                  <p className="text-sm text-muted-foreground">No-Show Rate</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{analytics.noShow} no-shows, {analytics.cancelled} cancelled</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4" />
                Most Popular Coaches
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analytics.popularCoaches.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No session data yet</p>
              ) : (
                <div className="space-y-3">
                  {analytics.popularCoaches.map((coach, idx) => (
                    <div key={coach.coachId} className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{coach.coachName}</p>
                      </div>
                      <Badge variant="secondary">{coach.sessionCount} sessions</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4" />
                Session Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-sm">Completed</span>
                  </div>
                  <span className="font-medium">{analytics.completed}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="text-sm">Scheduled</span>
                  </div>
                  <span className="font-medium">{analytics.scheduled}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-gray-400" />
                    <span className="text-sm">Cancelled</span>
                  </div>
                  <span className="font-medium">{analytics.cancelled}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-sm">No-Show</span>
                  </div>
                  <span className="font-medium">{analytics.noShow}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="text-sm">Credit Returned</span>
                  </div>
                  <span className="font-medium">{analytics.creditReturned}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Coach Accountability
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50/50 border border-amber-100">
                  <div>
                    <p className="font-medium text-sm">Sessions Needing Notes</p>
                    <p className="text-xs text-muted-foreground">Completed sessions without coach notes</p>
                  </div>
                  <Badge variant={analytics.needsNotesCount > 0 ? "warning" : "secondary"}>
                    {analytics.needsNotesCount}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Action Item Completion
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="text-center py-4">
                  <p className="text-4xl font-bold text-foreground">{actionItemCompletionRate}%</p>
                  <p className="text-sm text-muted-foreground mt-1">Completion Rate</p>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total Items</span>
                  <span className="font-medium">{analytics.actionItemsTotal}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Completed</span>
                  <span className="font-medium text-green-600">{analytics.actionItemsCompleted}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Pending</span>
                  <span className="font-medium text-amber-600">{analytics.actionItemsTotal - analytics.actionItemsCompleted}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </CoachingAdminLayout>
  );
}
