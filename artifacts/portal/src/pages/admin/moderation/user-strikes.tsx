import { useParams, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ShieldAlert,
  ExternalLink,
  Bot,
  UserCog,
  UserCheck,
} from "lucide-react";
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

            {(() => {
              const { autoBan, manualBan } = data;
              if (!autoBan && !manualBan && !data.user.isBanned) return null;

              const autoTime = autoBan ? new Date(autoBan.createdAt).getTime() : null;
              const manualTime = manualBan ? new Date(manualBan.createdAt).getTime() : null;

              // When both records exist, the newer one explains the member's
              // current banned/unbanned state — highlight it as the live reason.
              let currentReason: "auto" | "manual" | null = null;
              if (autoTime != null && manualTime != null) {
                currentReason = manualTime >= autoTime ? "manual" : "auto";
              }

              const highlightClass = "ring-2 ring-offset-1 ring-primary/60";

              return (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold">Ban Details</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    {autoBan && (
                      <div
                        className={`flex items-start gap-3 p-3 rounded-lg border border-red-200 bg-red-50/50 ${
                          currentReason === "auto" ? highlightClass : ""
                        }`}
                      >
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-100 text-red-700 flex items-center justify-center">
                          <Bot className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            Auto-banned on{" "}
                            {format(new Date(autoBan.createdAt), "MMM d, yyyy 'at' h:mm a")}
                            {autoBan.actorEmail && (
                              <>
                                {" "}by{" "}
                                <span className="font-semibold">{autoBan.actorEmail}</span>
                              </>
                            )}
                            {autoBan.metadata?.triggeringQueueId != null && (
                              <>
                                {" "}via queue #{autoBan.metadata.triggeringQueueId}
                              </>
                            )}
                          </p>
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            {currentReason === "auto" && (
                              <Badge className="text-xs bg-primary text-primary-foreground border-transparent">
                                Current reason
                              </Badge>
                            )}
                            {autoBan.metadata?.strikeCount != null && (
                              <Badge variant="outline" className="text-xs bg-white">
                                {autoBan.metadata.strikeCount} strikes at ban
                              </Badge>
                            )}
                            {autoBan.metadata?.triggeringStrikeId != null && (
                              <Badge variant="outline" className="text-xs bg-white">
                                Strike #{autoBan.metadata.triggeringStrikeId}
                              </Badge>
                            )}
                            {autoBan.metadata?.triggeringQueueId != null && (
                              <Link
                                href={`/admin/moderation/queue/${autoBan.metadata.triggeringQueueId}`}
                              >
                                <span className="inline-flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer">
                                  View triggering queue item
                                  <ExternalLink className="w-3 h-3" />
                                </span>
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {manualBan &&
                      (() => {
                        const isUnban = manualBan.actionType === "unban_posting";
                        const strikesCleared = manualBan.metadata?.strikesCleared === true;
                        return (
                          <div
                            className={`flex items-start gap-3 p-3 rounded-lg border ${
                              isUnban
                                ? "border-green-200 bg-green-50/50"
                                : "border-red-200 bg-red-50/50"
                            } ${currentReason === "manual" ? highlightClass : ""}`}
                          >
                            <div
                              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                                isUnban
                                  ? "bg-green-100 text-green-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {isUnban ? (
                                <UserCheck className="w-4 h-4" />
                              ) : (
                                <UserCog className="w-4 h-4" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground">
                                {isUnban ? "Manually unbanned" : "Manually banned"} on{" "}
                                {format(
                                  new Date(manualBan.createdAt),
                                  "MMM d, yyyy 'at' h:mm a",
                                )}
                                {manualBan.actorEmail && (
                                  <>
                                    {" "}by{" "}
                                    <span className="font-semibold">{manualBan.actorEmail}</span>
                                  </>
                                )}
                              </p>
                              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                {currentReason === "manual" && (
                                  <Badge className="text-xs bg-primary text-primary-foreground border-transparent">
                                    Current reason
                                  </Badge>
                                )}
                                {isUnban && (
                                  <Badge variant="outline" className="text-xs bg-white">
                                    {strikesCleared ? "Strikes cleared" : "Strikes retained"}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                    {!autoBan && !manualBan && data.user.isBanned && (
                      <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                          <UserCog className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">Banned by admin</p>
                          {data.user.postingBannedAt && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {format(
                                new Date(data.user.postingBannedAt),
                                "MMM d, yyyy 'at' h:mm a",
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

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
