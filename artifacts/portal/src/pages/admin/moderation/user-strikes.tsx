import { useParams, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ShieldAlert, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { useAdminUserStrikes } from "@/lib/admin-api";
import { BanControls } from "@/components/admin/moderation/ban-controls";

export default function UserStrikesDetail() {
  const params = useParams<{ userId: string }>();
  const userId = parseInt(params.userId ?? "0", 10);

  const { data, isLoading, error } = useAdminUserStrikes(userId);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/admin/moderation/strikes">
            <Button variant="outline" size="sm" className="gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to strikes
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading...</div>
        ) : error ? (
          <Card>
            <CardContent className="py-12 text-center text-destructive">
              Failed to load strike data. Please refresh and try again.
            </CardContent>
          </Card>
        ) : !data ? null : (
          <>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-2xl font-bold text-foreground">{data.user.name}</h1>
                <p className="text-muted-foreground mt-0.5">{data.user.email}</p>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <Badge
                  className={
                    data.user.isBanned
                      ? "bg-red-100 text-red-700 border-red-200"
                      : data.strikeCount >= 3
                      ? "bg-amber-100 text-amber-700 border-amber-200"
                      : "bg-yellow-50 text-yellow-700 border-yellow-200"
                  }
                  variant="outline"
                >
                  {data.strikeCount} {data.strikeCount === 1 ? "strike" : "strikes"}
                </Badge>
                {data.user.isBanned && (
                  <Badge className="bg-red-100 text-red-700 border-red-200" variant="outline">
                    Posting banned
                    {data.user.postingBannedAt && (
                      <span className="ml-1 opacity-70">
                        since {format(new Date(data.user.postingBannedAt), "MMM d")}
                      </span>
                    )}
                  </Badge>
                )}
                <BanControls
                  userId={data.user.id}
                  isBanned={data.user.isBanned}
                  userName={data.user.name}
                />
              </div>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Strike History</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {data.strikes.length === 0 ? (
                  <div className="py-8 text-center">
                    <ShieldAlert className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                    <p className="text-sm text-muted-foreground">No strikes on record.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data.strikes.map((strike, idx) => (
                      <div
                        key={strike.id}
                        className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20"
                      >
                        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold">
                          {data.strikes.length - idx}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{strike.reason}</p>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(strike.createdAt), "MMM d, yyyy 'at' h:mm a")}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {strike.targetType} #{strike.targetId}
                            </Badge>
                            {strike.queueId && (
                              <Link href={`/admin/moderation/queue/${strike.queueId}`}>
                                <span className="inline-flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer">
                                  Queue item #{strike.queueId}
                                  <ExternalLink className="w-3 h-3" />
                                </span>
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
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
