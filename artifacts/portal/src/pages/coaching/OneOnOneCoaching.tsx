import { useState, useMemo, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Calendar,
  Clock,
  UserCheck,
  Video,
  ArrowRight,
  CheckSquare,
  Star,
  FileText,
  XCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { format, addMinutes, isBefore } from "date-fns";
import { Link } from "wouter";
import {
  useCoachingStatus,
  useOneOnOneSessions,
  useOneOnOneSession,
  useCancelSession,
  useToggleActionItem,
  type ActionItem,
} from "@/lib/coaching-api";
import { RatingModal } from "@/components/coaching/RatingModal";

const PAST_PAGE_SIZE = 5;

export default function OneOnOneCoaching() {
  const [ratingSession, setRatingSession] = useState<{ id: number; coachName: string } | null>(null);
  const [pastPage, setPastPage] = useState(0);

  const { data: status, isLoading: statusLoading, error: statusError } = useCoachingStatus();
  const { data: allPastSessions, isLoading: pastLoading, error: pastError } = useOneOnOneSessions({ status: "completed" });
  const cancelSession = useCancelSession();
  const toggleItem = useToggleActionItem();

  const recentCompletedId = allPastSessions?.[0]?.id ?? 0;
  const { data: recentSessionDetail } = useOneOnOneSession(recentCompletedId);
  const [ratingDismissed, setRatingDismissed] = useState(false);

  useEffect(() => {
    if (
      recentSessionDetail &&
      !recentSessionDetail.rating &&
      recentSessionDetail.status === "completed" &&
      !ratingDismissed
    ) {
      setRatingSession({
        id: recentSessionDetail.id,
        coachName: recentSessionDetail.coachName,
      });
    }
  }, [recentSessionDetail, ratingDismissed]);

  const now = new Date();

  const paginatedSessions = useMemo(() => {
    if (!allPastSessions) return { sessions: [], totalPages: 0 };
    const totalPages = Math.ceil(allPastSessions.length / PAST_PAGE_SIZE);
    const start = pastPage * PAST_PAGE_SIZE;
    return {
      sessions: allPastSessions.slice(start, start + PAST_PAGE_SIZE),
      totalPages,
    };
  }, [allPastSessions, pastPage]);

  const activeActionItems = useMemo(() => {
    const items: (ActionItem & { sessionId: number; coachName: string })[] = [];
    if (recentSessionDetail?.actionItems) {
      for (const item of recentSessionDetail.actionItems) {
        if (!item.completed) {
          items.push({
            ...item,
            sessionId: recentSessionDetail.id,
            coachName: recentSessionDetail.coachName,
          });
        }
      }
    }
    return items;
  }, [recentSessionDetail]);

  if (statusError) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border">
          <AlertTriangle className="w-12 h-12 text-destructive/50 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground">Could not load coaching data</h2>
          <p className="text-muted-foreground mt-2">Please try refreshing the page.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <UserCheck className="w-6 h-6 text-primary" />
              <h1 className="text-3xl font-bold text-foreground">1-on-1 Coaching</h1>
            </div>
            <p className="text-muted-foreground">
              Private coaching sessions tailored to your goals.
            </p>
          </div>
          {status?.eligible && (
            <Link href="/coaching/one-on-one/book">
              <Button size="lg" className="shadow-lg shadow-primary/20">
                <Calendar className="w-5 h-5 mr-2" />
                Book a Session
              </Button>
            </Link>
          )}
        </div>

        {statusLoading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-24 bg-card rounded-xl"></div>
            <div className="h-48 bg-card rounded-xl"></div>
          </div>
        ) : status && status.eligible ? (
          <>
            <Card className="border-t-4 border-t-primary rounded-t-sm">
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <UserCheck className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-bold text-foreground">
                        {status.frequency === "weekly" ? "Weekly" : "Monthly"} Coaching Plan
                      </h3>
                      {status.periodEnd && (
                        <p className="text-sm text-muted-foreground">
                          Period ends {format(new Date(status.periodEnd), "MMM d, yyyy")}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <p className="text-3xl font-bold text-primary">
                        {Math.max(0, status.sessionsLimit - status.sessionsUsed)}
                      </p>
                      <p className="text-xs text-muted-foreground">Remaining</p>
                    </div>
                    <div className="w-px h-10 bg-border" />
                    <div className="text-center">
                      <p className="text-3xl font-bold text-foreground">{status.sessionsUsed}</p>
                      <p className="text-xs text-muted-foreground">Used</p>
                    </div>
                    <div className="w-px h-10 bg-border" />
                    <div className="text-center">
                      <p className="text-3xl font-bold text-muted-foreground">{status.sessionsLimit}</p>
                      <p className="text-xs text-muted-foreground">Total</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-8">
                <div>
                  <h2 className="text-xl font-bold text-foreground border-b border-border pb-3 mb-6">
                    Upcoming Session
                  </h2>
                  {status.upcomingSession ? (
                    <Card className="overflow-hidden">
                      <div className="flex flex-col sm:flex-row">
                        <div className="bg-primary/5 p-6 flex flex-col items-center justify-center sm:w-40 border-b sm:border-b-0 sm:border-r border-border shrink-0">
                          <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
                            {format(new Date(status.upcomingSession.scheduledAt), "MMM")}
                          </span>
                          <span className="text-4xl font-bold text-foreground my-1">
                            {format(new Date(status.upcomingSession.scheduledAt), "dd")}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {format(new Date(status.upcomingSession.scheduledAt), "EEEE")}
                          </span>
                        </div>
                        <div className="p-6 flex-1">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="secondary" className="bg-primary/10 text-primary uppercase text-[10px] tracking-widest">
                                  1-on-1
                                </Badge>
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Clock className="w-3 h-3" />
                                  {format(new Date(status.upcomingSession.scheduledAt), "h:mm a")}
                                </span>
                              </div>
                              <h3 className="text-lg font-bold text-foreground mt-2">
                                Session with {status.upcomingSession.coachName}
                              </h3>
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground mb-4">
                            {status.upcomingSession.durationMinutes} minute session
                          </p>
                          <div className="flex flex-wrap gap-3">
                            {(() => {
                              const sessionStart = new Date(status.upcomingSession!.scheduledAt);
                              const joinWindow = addMinutes(sessionStart, -5);
                              const sessionEnd = addMinutes(sessionStart, status.upcomingSession!.durationMinutes);
                              const canJoin = !isBefore(now, joinWindow) && isBefore(now, sessionEnd);

                              return (
                                <>
                                  {canJoin && status.upcomingSession!.meetLink ? (
                                    <a href={status.upcomingSession!.meetLink} target="_blank" rel="noopener noreferrer">
                                      <Button>
                                        <Video className="w-4 h-4 mr-2" />
                                        Join Session
                                      </Button>
                                    </a>
                                  ) : (
                                    <Button variant="outline" disabled>
                                      <Video className="w-4 h-4 mr-2" />
                                      Join (opens 5 min before)
                                    </Button>
                                  )}
                                  <Link href={`/coaching/one-on-one/book?reschedule=${status.upcomingSession!.id}`}>
                                    <Button variant="outline">Reschedule</Button>
                                  </Link>
                                  <Button
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => {
                                      if (window.confirm("Are you sure you want to cancel this session?")) {
                                        cancelSession.mutate({ sessionId: status.upcomingSession!.id });
                                      }
                                    }}
                                    disabled={cancelSession.isPending}
                                  >
                                    <XCircle className="w-4 h-4 mr-2" />
                                    Cancel
                                  </Button>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </Card>
                  ) : (
                    <Card>
                      <CardContent className="p-8 text-center">
                        <Calendar className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-foreground mb-2">
                          No Upcoming Session
                        </h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Book your next coaching session to keep making progress.
                        </p>
                        <Link href="/coaching/one-on-one/book">
                          <Button>
                            <Calendar className="w-4 h-4 mr-2" />
                            Book a Session
                          </Button>
                        </Link>
                      </CardContent>
                    </Card>
                  )}
                </div>

                <div>
                  <h2 className="text-xl font-bold text-foreground border-b border-border pb-3 mb-6">
                    Past Sessions
                  </h2>
                  {pastLoading ? (
                    <div className="animate-pulse space-y-3">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-20 bg-card rounded-xl" />
                      ))}
                    </div>
                  ) : pastError ? (
                    <Card>
                      <CardContent className="p-8 text-center">
                        <AlertTriangle className="w-12 h-12 text-destructive/50 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-foreground mb-2">Failed to load past sessions</h3>
                        <p className="text-sm text-muted-foreground">Please try refreshing the page.</p>
                      </CardContent>
                    </Card>
                  ) : paginatedSessions.sessions.length > 0 ? (
                    <div className="space-y-3">
                      {paginatedSessions.sessions.map((session) => (
                        <Link key={session.id} href={`/coaching/one-on-one/sessions/${session.id}`}>
                          <Card className="hover:shadow-md transition-shadow cursor-pointer">
                            <CardContent className="p-4 flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                                  {session.coachName.split(" ").map((n) => n[0]).join("")}
                                </div>
                                <div>
                                  <h4 className="font-semibold text-foreground text-sm">
                                    Session with {session.coachName}
                                  </h4>
                                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                    <span className="flex items-center gap-1">
                                      <Calendar className="w-3 h-3" />
                                      {format(new Date(session.scheduledAt), "MMM d, yyyy")}
                                    </span>
                                    <span className="flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      {format(new Date(session.scheduledAt), "h:mm a")}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <ArrowRight className="w-4 h-4 text-muted-foreground/40" />
                            </CardContent>
                          </Card>
                        </Link>
                      ))}

                      {paginatedSessions.totalPages > 1 && (
                        <div className="flex items-center justify-center gap-4 pt-4">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPastPage((p) => Math.max(0, p - 1))}
                            disabled={pastPage <= 0}
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <span className="text-sm text-muted-foreground">
                            Page {pastPage + 1} of {paginatedSessions.totalPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPastPage((p) => Math.min(paginatedSessions.totalPages - 1, p + 1))}
                            disabled={pastPage >= paginatedSessions.totalPages - 1}
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Card>
                      <CardContent className="p-8 text-center">
                        <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-foreground mb-2">No Past Sessions</h3>
                        <p className="text-sm text-muted-foreground">
                          Your completed coaching sessions will appear here.
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <Card>
                  <CardHeader className="pb-4 border-b border-border/50">
                    <div className="flex items-center gap-2 text-foreground font-semibold">
                      <CheckSquare className="w-5 h-5 text-primary" />
                      Action Items
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4">
                    {activeActionItems.length > 0 ? (
                      <ul className="space-y-3">
                        {activeActionItems.map((item) => (
                          <li key={`${item.sessionId}-${item.id}`} className="flex items-start gap-3">
                            <Checkbox
                              checked={item.completed}
                              onCheckedChange={(checked) => {
                                toggleItem.mutate({
                                  sessionId: item.sessionId,
                                  actionItemId: item.id,
                                  completed: checked === true,
                                });
                              }}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <span className="text-sm text-foreground">{item.text}</span>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                from session with {item.coachName}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No pending action items. They'll be added after your sessions.
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-b from-primary/5 to-transparent border-primary/20">
                  <CardContent className="p-6">
                    <h3 className="font-bold text-lg mb-2">Prepare for Success</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Prepare your questions and goals before your next session for maximum impact.
                    </p>
                    <Link href="/support">
                      <Button variant="outline" className="w-full">
                        Contact Support
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <UserCheck className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">1-on-1 Coaching Not Available</h3>
              <p className="text-sm text-muted-foreground">
                Your current plan does not include 1-on-1 coaching sessions.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {ratingSession && (
        <RatingModal
          open={!!ratingSession}
          onOpenChange={(open) => {
            if (!open) {
              setRatingSession(null);
              setRatingDismissed(true);
            }
          }}
          sessionId={ratingSession.id}
          coachName={ratingSession.coachName}
        />
      )}
    </AppLayout>
  );
}
