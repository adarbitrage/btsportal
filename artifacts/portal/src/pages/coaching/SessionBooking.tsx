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
  ChevronDown,
  FileText,
  Ticket,
  PlayCircle,
  Sparkles,
  ListChecks,
  MessageSquare,
} from "lucide-react";
import { format, addMinutes, isBefore } from "date-fns";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  useSessionBalance,
  useMySessionBookings,
  useCancelSessionBooking,
  type SessionBooking as SessionBookingType,
} from "@/lib/session-packs-api";

const PAST_PAGE_SIZE = 5;

/**
 * TEMPORARY DESIGN PREVIEW — remove once the Google Meet recording/notes
 * ingest task is live and real recording + summary data flows to members.
 *
 * The member API intentionally strips recordingUrl/summaryUrl/notes for
 * privacy, so to design the completed-session presentation we inject a
 * fake "already happened" session, only for the account below.
 */
const DESIGN_PREVIEW_EMAIL = "sasha@cherringtonmedia.com";

interface PastSessionView extends SessionBookingType {
  recordingUrl?: string | null;
  summaryText?: string | null;
  summaryHighlights?: string[];
  actionItems?: string[];
}

function buildDesignPreviewSession(): PastSessionView {
  const scheduledAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  scheduledAt.setHours(14, 0, 0, 0);
  const endAt = addMinutes(scheduledAt, 60);
  return {
    id: -1,
    coachId: 0,
    coachName: "Michael",
    coachPhotoUrl: null,
    scheduledAt: scheduledAt.toISOString(),
    endAt: endAt.toISOString(),
    durationMinutes: 60,
    meetLink: "https://meet.google.com/abc-defg-hij",
    status: "completed",
    title: "1-on-1 Coaching with Michael",
    discussionTopic: "Scaling my Media Mavens campaign past $500/day in spend",
    cancelledAt: null,
    createdAt: scheduledAt.toISOString(),
    recordingUrl: "https://meet.google.com/abc-defg-hij",
    summaryText:
      "We reviewed your current Media Mavens campaign and pinpointed why scaling stalls around $300/day. The core issue is ad fatigue on your top creative paired with too-narrow audience targeting. Michael walked through a creative-refresh cadence and a structured budget-scaling plan that protects ROAS while you push past $500/day.",
    summaryHighlights: [
      "Your top creative is fatiguing — frequency is above 3.0 on the main audience.",
      "Audience is too narrow to support $500/day; broaden before scaling budget.",
      "Scale budget in 20% steps every 48 hours rather than doubling overnight.",
    ],
    actionItems: [
      "Launch 3 new creative variations this week to combat ad fatigue.",
      "Build one broad interest-stacked audience to expand reach.",
      "Increase daily budget by 20% every 2 days while ROAS holds above target.",
    ],
  };
}

const PACKAGE_PLACEHOLDERS = [
  {
    name: "1-Session (60 minutes)",
    price: "$135",
    blurb: "A single session for targeted guidance.",
  },
  {
    name: "3-Pack (60 minutes)",
    price: "$375",
    blurb: "A short-term package for focused support.",
  },
  {
    name: "5-Pack (60 minutes)",
    price: "$600",
    blurb: "A comprehensive package for continued strategic development.",
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
  const { user } = useAuth();
  const [pastPage, setPastPage] = useState(0);
  const [expandedPastId, setExpandedPastId] = useState<number | null>(-1);

  const { data: balanceData, isLoading: balanceLoading } = useSessionBalance();
  const { data: bookings, isLoading: bookingsLoading } = useMySessionBookings();
  const cancelMutation = useCancelSessionBooking();

  const showDesignPreview = user?.email === DESIGN_PREVIEW_EMAIL;

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

  const past = useMemo<PastSessionView[]>(
    () => {
      const real: PastSessionView[] = (bookings ?? []).filter(
        (b) => b.status !== "booked" || new Date(b.scheduledAt).getTime() < now.getTime(),
      );
      const combined = showDesignPreview
        ? [...real, buildDesignPreviewSession()]
        : real;
      return combined.sort(
        (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime(),
      );
    },
    [bookings, showDesignPreview],
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
                    Each credit books one private 1-hour session.
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
                  {paginatedPast.sessions.map((booking) => {
                    const hasRecap = Boolean(
                      booking.recordingUrl ||
                        booking.summaryText ||
                        (booking.summaryHighlights?.length ?? 0) > 0 ||
                        (booking.actionItems?.length ?? 0) > 0,
                    );
                    const isExpanded = expandedPastId === booking.id;
                    return (
                    <Card key={booking.id} className="overflow-hidden">
                      <CardContent className="p-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                            {booking.status === "cancelled" ? (
                              <XCircle className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 text-primary" />
                            )}
                          </div>
                          <div className="min-w-0">
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
                        <div className="flex items-center gap-3 shrink-0">
                          {statusBadge(booking.status)}
                          {hasRecap && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() =>
                                setExpandedPastId(isExpanded ? null : booking.id)
                              }
                              data-testid={`recap-toggle-${booking.id}`}
                            >
                              <Sparkles className="w-3.5 h-3.5 text-primary" />
                              Recording & Notes
                              <ChevronDown
                                className={`w-3.5 h-3.5 transition-transform ${
                                  isExpanded ? "rotate-180" : ""
                                }`}
                              />
                            </Button>
                          )}
                        </div>
                      </CardContent>

                      {hasRecap && isExpanded && (
                        <div className="border-t border-border bg-muted/30 p-4 space-y-5">
                          {booking.discussionTopic && (
                            <div className="flex items-start gap-2 text-sm">
                              <MessageSquare className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                              <p className="text-muted-foreground">
                                <span className="font-medium text-foreground">
                                  Topic:
                                </span>{" "}
                                {booking.discussionTopic}
                              </p>
                            </div>
                          )}

                          {booking.recordingUrl && (
                            <div>
                              <div className="aspect-video w-full rounded-lg bg-foreground/5 border border-border flex items-center justify-center">
                                <a
                                  href={booking.recordingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex flex-col items-center gap-2 text-primary hover:opacity-80 transition-opacity"
                                  data-testid={`recording-link-${booking.id}`}
                                >
                                  <PlayCircle className="w-12 h-12" />
                                  <span className="text-sm font-medium">
                                    Watch session recording
                                  </span>
                                </a>
                              </div>
                            </div>
                          )}

                          {(booking.summaryText ||
                            (booking.summaryHighlights?.length ?? 0) > 0) && (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-primary" />
                                <h5 className="font-semibold text-foreground text-sm">
                                  AI Session Summary
                                </h5>
                              </div>
                              {booking.summaryText && (
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                  {booking.summaryText}
                                </p>
                              )}
                              {(booking.summaryHighlights?.length ?? 0) > 0 && (
                                <ul className="space-y-1.5 mt-2">
                                  {booking.summaryHighlights!.map((point, i) => (
                                    <li
                                      key={i}
                                      className="flex items-start gap-2 text-sm text-muted-foreground"
                                    >
                                      <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                                      <span>{point}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}

                          {(booking.actionItems?.length ?? 0) > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <ListChecks className="w-4 h-4 text-primary" />
                                <h5 className="font-semibold text-foreground text-sm">
                                  Your Action Items
                                </h5>
                              </div>
                              <ul className="space-y-1.5">
                                {booking.actionItems!.map((item, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2 text-sm text-muted-foreground"
                                  >
                                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                                      {i + 1}
                                    </span>
                                    <span>{item}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                    );
                  })}

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
                  <p className="text-sm text-muted-foreground">{pkg.price}</p>
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
