import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  Clock,
  UserCheck,
  Video,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Ticket,
} from "lucide-react";
import { format, addMinutes, isBefore } from "date-fns";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  useSessionBalance,
  useMySessionBookings,
  useCancelSessionBooking,
  type SessionBooking as SessionBookingType,
} from "@/lib/session-packs-api";

const PAST_PAGE_SIZE = 5;

const PACKAGE_PLACEHOLDERS = [
  {
    name: "Single Session",
    sessions: "1 session",
    blurb: "A focused 1-on-1 to unblock a specific challenge.",
  },
  {
    name: "Starter Pack",
    sessions: "5 sessions",
    blurb: "Build momentum with regular coaching touchpoints.",
  },
  {
    name: "Pro Pack",
    sessions: "10 sessions",
    blurb: "Go all-in with ongoing accountability and strategy.",
  },
];

function coachInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function SessionBooking() {
  const { toast } = useToast();
  const [pastPage, setPastPage] = useState(0);

  const { data: balanceData, isLoading: balanceLoading } = useSessionBalance();
  const { data: bookings, isLoading: bookingsLoading } = useMySessionBookings();
  const cancelMutation = useCancelSessionBooking();

  const balance = balanceData?.balance ?? 0;
  const hasCredits = balance > 0;
  const now = new Date();

  const upcoming = useMemo(
    () =>
      (bookings ?? [])
        .filter(
          (b) => b.status === "booked" && new Date(b.scheduledAt).getTime() >= now.getTime(),
        )
        .sort(
          (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
        ),
    [bookings],
  );
  const nextSession = upcoming[0];

  const past = useMemo(
    () =>
      (bookings ?? [])
        .filter(
          (b) => b.status !== "booked" || new Date(b.scheduledAt).getTime() < now.getTime(),
        )
        .sort(
          (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime(),
        ),
    [bookings],
  );
  const completedCount = past.filter((b) => b.status === "completed").length;

  const paginatedPast = useMemo(() => {
    const totalPages = Math.ceil(past.length / PAST_PAGE_SIZE);
    const start = pastPage * PAST_PAGE_SIZE;
    return { sessions: past.slice(start, start + PAST_PAGE_SIZE), totalPages };
  }, [past, pastPage]);

  async function handleCancel(booking: SessionBookingType) {
    if (!window.confirm("Are you sure you want to cancel this session?")) return;
    try {
      const result = await cancelMutation.mutateAsync({ bookingId: booking.id });
      toast({
        title: "Session cancelled",
        description: result.refunded
          ? "Your credit has been refunded."
          : "This session was within 24 hours, so the credit was not refunded.",
      });
    } catch (err) {
      toast({
        title: "Could not cancel",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  function statusBadge(status: string) {
    switch (status) {
      case "completed":
        return <Badge variant="secondary">Completed</Badge>;
      case "cancelled":
        return <Badge variant="outline">Cancelled</Badge>;
      case "no_show":
        return <Badge variant="warning">No-show</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <UserCheck className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold text-foreground">1-on-1 Coaching</h1>
          </div>
          <p className="text-muted-foreground">
            Feeling stuck? Book private sessions with the coach of your choice to get unstuck
            fast — real-time answers, stronger creatives and strategy, and a clear next step.
            Each 60-minute session is focused entirely on your specific challenges.
          </p>
        </div>

        {/* Session credits summary */}
        <Card className="border-t-4 border-t-primary rounded-t-sm">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Ticket className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground">Session Credits</h3>
                  <p className="text-sm text-muted-foreground">
                    Each credit books one 1-hour 1-on-1 session.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-primary" data-testid="credit-balance">
                    {balanceLoading ? "—" : balance}
                  </p>
                  <p className="text-xs text-muted-foreground">Credits</p>
                </div>
                <div className="w-px h-10 bg-border" />
                <div className="text-center">
                  <p className="text-3xl font-bold text-foreground">{upcoming.length}</p>
                  <p className="text-xs text-muted-foreground">Upcoming</p>
                </div>
                <div className="w-px h-10 bg-border" />
                <div className="text-center">
                  <p className="text-3xl font-bold text-muted-foreground">{completedCount}</p>
                  <p className="text-xs text-muted-foreground">Completed</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-8">
          {/* Upcoming session */}
            <div>
              <div className="flex items-center justify-between gap-4 border-b border-border pb-3 mb-6">
                <h2 className="text-xl font-bold text-foreground">Upcoming Session</h2>
                {hasCredits && (
                  <Link href="/coaching/book-session/book">
                    <Button size="sm" className="shadow-lg shadow-primary/20">
                      <Calendar className="w-4 h-4 mr-2" />
                      Book a Session
                    </Button>
                  </Link>
                )}
              </div>
              {bookingsLoading ? (
                <div className="animate-pulse h-40 bg-card rounded-xl" />
              ) : nextSession ? (
                <Card className="overflow-hidden" data-testid={`upcoming-${nextSession.id}`}>
                  <div className="flex flex-col sm:flex-row">
                    <div className="bg-primary/5 p-6 flex flex-col items-center justify-center sm:w-40 border-b sm:border-b-0 sm:border-r border-border shrink-0">
                      <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
                        {format(new Date(nextSession.scheduledAt), "MMM")}
                      </span>
                      <span className="text-4xl font-bold text-foreground my-1">
                        {format(new Date(nextSession.scheduledAt), "dd")}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(nextSession.scheduledAt), "EEEE")}
                      </span>
                    </div>
                    <div className="p-6 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="secondary"
                          className="bg-primary/10 text-primary uppercase text-[10px] tracking-widest"
                        >
                          1-on-1
                        </Badge>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {format(new Date(nextSession.scheduledAt), "h:mm a")}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-foreground mt-2">
                        Session with {nextSession.coachName}
                      </h3>
                      <p className="text-sm text-muted-foreground mb-4 mt-1">
                        {nextSession.durationMinutes} minute session
                      </p>
                      <div className="flex flex-wrap gap-3">
                        {(() => {
                          const sessionStart = new Date(nextSession.scheduledAt);
                          const joinWindow = addMinutes(sessionStart, -5);
                          const sessionEnd = addMinutes(
                            sessionStart,
                            nextSession.durationMinutes,
                          );
                          const canJoin =
                            !isBefore(now, joinWindow) && isBefore(now, sessionEnd);
                          return (
                            <>
                              {canJoin && nextSession.meetLink ? (
                                <a
                                  href={nextSession.meetLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
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
                              <Link href={`/coaching/book-session/book?reschedule=${nextSession.id}`}>
                                <Button variant="outline">Reschedule</Button>
                              </Link>
                              <Button
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleCancel(nextSession)}
                                disabled={cancelMutation.isPending}
                                data-testid={`cancel-${nextSession.id}`}
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
                      {hasCredits
                        ? "Book your next coaching session to keep making progress."
                        : "You don't have any session credits yet. See the packages below."}
                    </p>
                    {hasCredits && (
                      <Link href="/coaching/book-session/book">
                        <Button>
                          <Calendar className="w-4 h-4 mr-2" />
                          Book a Session
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              )}

              {upcoming.length > 1 && (
                <div className="mt-4 space-y-3">
                  {upcoming.slice(1).map((booking) => (
                    <Card key={booking.id} data-testid={`upcoming-${booking.id}`}>
                      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                            {coachInitials(booking.coachName)}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{booking.coachName}</p>
                            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {format(new Date(booking.scheduledAt), "EEE, MMM d 'at' h:mm a")}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Link href={`/coaching/book-session/book?reschedule=${booking.id}`}>
                            <Button variant="outline" size="sm">
                              Reschedule
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleCancel(booking)}
                            disabled={cancelMutation.isPending}
                            data-testid={`cancel-${booking.id}`}
                          >
                            Cancel
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Past sessions */}
            <div>
              <h2 className="text-xl font-bold text-foreground border-b border-border pb-3 mb-6">
                Past Sessions
              </h2>
              {bookingsLoading ? (
                <div className="animate-pulse space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 bg-card rounded-xl" />
                  ))}
                </div>
              ) : paginatedPast.sessions.length > 0 ? (
                <div className="space-y-3">
                  {paginatedPast.sessions.map((booking) => (
                    <Card key={booking.id}>
                      <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                            {booking.status === "cancelled" ? (
                              <XCircle className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 text-primary" />
                            )}
                          </div>
                          <div>
                            <h4 className="font-semibold text-foreground text-sm">
                              Session with {booking.coachName}
                            </h4>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {format(new Date(booking.scheduledAt), "MMM d, yyyy")}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {format(new Date(booking.scheduledAt), "h:mm a")}
                              </span>
                            </div>
                          </div>
                        </div>
                        {statusBadge(booking.status)}
                      </CardContent>
                    </Card>
                  ))}

                  {paginatedPast.totalPages > 1 && (
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
                        Page {pastPage + 1} of {paginatedPast.totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPastPage((p) => Math.min(paginatedPast.totalPages - 1, p + 1))
                        }
                        disabled={pastPage >= paginatedPast.totalPages - 1}
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

        {/* Coaching packages */}
        <div>
          <h2 className="text-xl font-bold text-foreground border-b border-border pb-3 mb-6">
            Coaching Packages
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {PACKAGE_PLACEHOLDERS.map((pkg) => (
              <Card key={pkg.name} className="opacity-90">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{pkg.name}</p>
                    <Badge variant="secondary">Coming soon</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{pkg.sessions}</p>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{pkg.blurb}</p>
                  <Button className="mt-4 w-full" disabled>
                    Coming soon
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
