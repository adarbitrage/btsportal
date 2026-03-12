import { useMemo } from "react";
import { useCoachingStatus, useOneOnOneSessions, useOneOnOneSession } from "@/lib/coaching-api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserCheck, Calendar, CheckSquare, ArrowRight } from "lucide-react";
import { format, addMinutes, isBefore } from "date-fns";
import { Link } from "wouter";

export function CoachingDashboardWidget() {
  const { data: status, isLoading, error } = useCoachingStatus();
  const { data: completedSessions } = useOneOnOneSessions({ status: "completed" });

  const recentCompletedId = completedSessions?.[0]?.id ?? 0;
  const { data: recentSessionDetail } = useOneOnOneSession(recentCompletedId);

  const pendingActionItemCount = useMemo(() => {
    if (!recentSessionDetail?.actionItems) return 0;
    return recentSessionDetail.actionItems.filter((item) => !item.completed).length;
  }, [recentSessionDetail]);

  if (error) {
    return (
      <Card>
        <CardHeader className="pb-4 border-b border-border/50">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <UserCheck className="w-5 h-5 text-primary" />
            1-on-1 Coaching
          </div>
        </CardHeader>
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Unable to load coaching data.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-secondary rounded w-1/2"></div>
            <div className="h-20 bg-secondary rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!status || !status.eligible) return null;

  const now = new Date();
  const upcoming = status.upcomingSession;

  return (
    <Card>
      <CardHeader className="pb-4 border-b border-border/50">
        <div className="flex items-center gap-2 text-foreground font-semibold">
          <UserCheck className="w-5 h-5 text-primary" />
          1-on-1 Coaching
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-0">
        {upcoming ? (
          <div className="p-5 border-b border-border/50">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs font-bold text-primary tracking-widest uppercase mb-1">
                  Next Session
                </p>
                <p className="text-sm font-semibold text-foreground">
                  with {upcoming.coachName}
                </p>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {upcoming.durationMinutes} min
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
              <Calendar className="w-3.5 h-3.5" />
              <span>{format(new Date(upcoming.scheduledAt), "MMM d, h:mm a")}</span>
            </div>
            {(() => {
              const sessionStart = new Date(upcoming.scheduledAt);
              const joinWindowStart = addMinutes(sessionStart, -5);
              const sessionEnd = addMinutes(sessionStart, upcoming.durationMinutes);
              const canJoin = !isBefore(now, joinWindowStart) && isBefore(now, sessionEnd);

              if (canJoin && upcoming.meetLink) {
                return (
                  <a href={upcoming.meetLink} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" className="w-full h-8 text-xs">
                      Join Session
                    </Button>
                  </a>
                );
              }
              return (
                <Link href="/coaching/one-on-one">
                  <Button size="sm" variant="outline" className="w-full h-8 text-xs">
                    View Details
                  </Button>
                </Link>
              );
            })()}
          </div>
        ) : (
          <div className="p-5 border-b border-border/50 text-center">
            <p className="text-sm text-muted-foreground mb-3">No upcoming session scheduled</p>
            <Link href="/coaching/one-on-one/book">
              <Button size="sm" className="h-8 text-xs">
                <Calendar className="w-3.5 h-3.5 mr-1.5" />
                Book a Session
              </Button>
            </Link>
          </div>
        )}

        <div className="p-5 border-b border-border/50 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Sessions remaining</span>
            <span className="font-bold text-foreground">
              {Math.max(0, status.sessionsLimit - status.sessionsUsed)} of {status.sessionsLimit}
            </span>
          </div>
          {pendingActionItemCount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <CheckSquare className="w-3.5 h-3.5" />
                Pending action items
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {pendingActionItemCount}
              </Badge>
            </div>
          )}
        </div>

        <div className="p-4">
          <Link href="/coaching/one-on-one">
            <Button variant="ghost" className="w-full text-primary hover:text-primary/80 text-sm">
              View All Sessions
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
