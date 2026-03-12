import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, Heart, Users, TrendingUp, BarChart3 } from "lucide-react";
import { adminApi, type Analytics } from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";

function StatCard({ title, icon: Icon, total, today, week, month }: {
  title: string;
  icon: React.ElementType;
  total: number;
  today: number;
  week: number;
  month: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Icon className="w-4 h-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{total.toLocaleString()}</div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
          <div>
            <p className="text-muted-foreground">Today</p>
            <p className="font-semibold">{today}</p>
          </div>
          <div>
            <p className="text-muted-foreground">This Week</p>
            <p className="font-semibold">{week}</p>
          </div>
          <div>
            <p className="text-muted-foreground">This Month</p>
            <p className="font-semibold">{month}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CommunityAnalytics() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    adminApi.getAnalytics()
      .then(setAnalytics)
      .catch((err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <AppLayout>
        <div className="text-center py-12 text-muted-foreground">Loading analytics...</div>
      </AppLayout>
    );
  }

  if (!analytics) {
    return (
      <AppLayout>
        <div className="text-center py-12 text-muted-foreground">Failed to load analytics.</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Community Analytics</h1>
          <p className="text-muted-foreground mt-1">Overview of community engagement and activity</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title="Posts"
            icon={MessageSquare}
            total={analytics.posts.total}
            today={analytics.posts.today}
            week={analytics.posts.thisWeek}
            month={analytics.posts.thisMonth}
          />
          <StatCard
            title="Comments"
            icon={MessageSquare}
            total={analytics.comments.total}
            today={analytics.comments.today}
            week={analytics.comments.thisWeek}
            month={analytics.comments.thisMonth}
          />
          <StatCard
            title="Reactions"
            icon={Heart}
            total={analytics.reactions.total}
            today={analytics.reactions.today}
            week={analytics.reactions.thisWeek}
            month={analytics.reactions.thisMonth}
          />
        </div>

        <div className="flex items-center gap-3 p-4 bg-primary/5 rounded-lg">
          <Users className="w-5 h-5 text-primary" />
          <div>
            <p className="text-sm font-medium">New Members (Last 30 Days)</p>
            <p className="text-2xl font-bold">{analytics.newMembersThisMonth}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Most Active Categories
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analytics.activeCategories.length === 0 ? (
                <p className="text-sm text-muted-foreground">No categories yet</p>
              ) : (
                <div className="space-y-3">
                  {analytics.activeCategories.map((cat, i) => {
                    const maxCount = analytics.activeCategories[0]?.postCount || 1;
                    const pct = Math.max(5, (cat.postCount / maxCount) * 100);
                    return (
                      <div key={cat.id}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="font-medium">{cat.name}</span>
                          <span className="text-muted-foreground">{cat.postCount} posts</span>
                        </div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Top Posters
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analytics.topPosters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No posts yet</p>
                ) : (
                  <div className="space-y-2">
                    {analytics.topPosters.slice(0, 5).map((user, i) => (
                      <div key={user.userId} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                            {i + 1}
                          </span>
                          <span className="font-medium">{user.name}</span>
                        </div>
                        <span className="text-muted-foreground">{user.postCount} posts</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Top Commenters
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analytics.topCommenters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No comments yet</p>
                ) : (
                  <div className="space-y-2">
                    {analytics.topCommenters.slice(0, 5).map((user, i) => (
                      <div key={user.userId} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                            {i + 1}
                          </span>
                          <span className="font-medium">{user.name}</span>
                        </div>
                        <span className="text-muted-foreground">{user.commentCount} comments</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
