import { useState, useMemo, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  ScrollText,
  Ticket,
  PlayCircle,
} from "lucide-react";
import { format, addMinutes, isBefore } from "date-fns";
import { Link, useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  useSessionBalance,
  useMySessionBookings,
  useCancelSessionBooking,
  type SessionBooking as SessionBookingType,
} from "@/lib/session-packs-api";

const PAST_PAGE_SIZE = 5;

// Sessions can be cancelled/rescheduled freely up to this far ahead; inside the
// window a cancel uses the credit (no refund) and rescheduling is closed. Mirrors
// REFUND_WINDOW_MS on the server, which is the source of truth.
const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;

function isLockedWithin24h(scheduledAt: string, nowMs: number): boolean {
  return new Date(scheduledAt).getTime() - nowMs < REFUND_WINDOW_MS;
}

/**
 * Google Drive "view" links (…/file/d/<id>/view) can't be embedded directly;
 * the embeddable player URL is …/file/d/<id>/preview. Returns null when the
 * URL isn't a recognizable Drive file link (caller falls back to opening it).
 */
function toDriveEmbedUrl(url: string): string | null {
  const match = url.match(/\/file\/d\/([^/]+)/);
  return match ? `https://drive.google.com/file/d/${match[1]}/preview` : null;
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

function SessionPolicyNote({
  scheduledAt,
  locked,
}: {
  scheduledAt: string;
  locked: boolean;
}) {
  if (locked) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
        <span>
          Within 24 hours — cancelling now uses your credit, and rescheduling is
          closed.
        </span>
      </p>
    );
  }
  const deadline = new Date(new Date(scheduledAt).getTime() - REFUND_WINDOW_MS);
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Clock className="h-3.5 w-3.5 shrink-0 mt-px" />
      <span>
        Free to cancel or reschedule until{" "}
        {format(deadline, "EEE, MMM d 'at' h:mm a")}.
      </span>
    </p>
  );
}

function RescheduleButton({
  bookingId,
  locked,
  size,
}: {
  bookingId: number;
  locked: boolean;
  size?: "default" | "sm";
}) {
  const btn = (
    <Button
      size={size}
      className="bg-[#188f4a] text-white hover:bg-[#136b38]"
      disabled={locked}
      data-testid={`reschedule-${bookingId}`}
    >
      <Clock className="w-4 h-4 mr-2" />
      Reschedule
    </Button>
  );
  if (locked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex cursor-not-allowed">
            {btn}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Rescheduling is closed within 24 hours of the session.
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Link href={`/coaching/book-session/book?reschedule=${bookingId}`}>
      {btn}
    </Link>
  );
}

function CancelButton({
  bookingId,
  pending,
  onClick,
  size,
}: {
  bookingId: number;
  pending: boolean;
  onClick: () => void;
  size?: "default" | "sm";
}) {
  return (
    <Button
      variant="destructive"
      size={size}
      className="hover:bg-destructive/70"
      onClick={onClick}
      disabled={pending}
      data-testid={`cancel-${bookingId}`}
    >
      <XCircle className="w-4 h-4 mr-2" />
      Cancel
    </Button>
  );
}

function UpcomingSessionCard({
  booking,
  locked,
  now,
  cancelPending,
  onCancel,
}: {
  booking: SessionBookingType;
  locked: boolean;
  now: Date;
  cancelPending: boolean;
  onCancel: () => void;
}) {
  const sessionStart = new Date(booking.scheduledAt);
  const joinWindow = addMinutes(sessionStart, -5);
  const sessionEnd = addMinutes(sessionStart, booking.durationMinutes);
  const canJoin = !isBefore(now, joinWindow) && isBefore(now, sessionEnd);
  return (
    <Card className="overflow-hidden" data-testid={`upcoming-${booking.id}`}>
      <div className="flex flex-col sm:flex-row">
        <div className="bg-primary/5 p-6 flex flex-col items-center justify-center sm:w-40 border-b sm:border-b-0 sm:border-r border-border shrink-0">
          <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
            {format(sessionStart, "MMM")}
          </span>
          <span className="text-4xl font-bold text-foreground my-1">
            {format(sessionStart, "dd")}
          </span>
          <span className="text-sm text-muted-foreground">
            {format(sessionStart, "EEEE")}
          </span>
        </div>
        <div className="p-6 flex-1 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1 text-foreground">
              <Clock className="w-5 h-5 text-primary" />
              <span className="text-xl font-bold tracking-tight">
                {format(sessionStart, "h:mm a")}
              </span>
            </div>
            <h3 className="text-lg font-bold text-foreground mt-2">
              Session with {booking.coachName}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {booking.durationMinutes} minute session
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end shrink-0">
            <div className="w-full sm:w-0 sm:min-w-full">
              <SessionPolicyNote
                scheduledAt={booking.scheduledAt}
                locked={locked}
              />
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap sm:justify-end">
              {canJoin && booking.meetLink ? (
                <a
                  href={booking.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                    <Video className="w-4 h-4 mr-2" />
                    Join Session
                  </Button>
                </a>
              ) : (
                <Button
                  disabled
                  className="bg-primary/20 text-primary hover:bg-primary/20 disabled:opacity-100 cursor-not-allowed"
                >
                  <Video className="w-4 h-4 mr-2" />
                  Join (opens 5 min before)
                </Button>
              )}
              <RescheduleButton bookingId={booking.id} locked={locked} />
              <CancelButton
                bookingId={booking.id}
                pending={cancelPending}
                onClick={onCancel}
              />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function SessionBooking() {
  const { toast } = useToast();
  const [pastPage, setPastPage] = useState(0);
  const [activeRecording, setActiveRecording] =
    useState<SessionBookingType | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SessionBookingType | null>(
    null,
  );

  const { data: balanceData, isLoading: balanceLoading } = useSessionBalance();
  const { data: bookings, isLoading: bookingsLoading } = useMySessionBookings();
  const cancelMutation = useCancelSessionBooking();

  const balance = balanceData?.balance ?? 0;
  const hasCredits = balance > 0;
  const now = new Date();

  const upcoming = useMemo(() => {
    const real = (bookings ?? []).filter(
      (b) => b.status === "booked" && new Date(b.scheduledAt).getTime() >= now.getTime(),
    );
    return [...real].sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );
  }, [bookings]);
  const nextSession = upcoming[0];
  const nextLocked = nextSession
    ? isLockedWithin24h(nextSession.scheduledAt, now.getTime())
    : false;

  const past = useMemo<SessionBookingType[]>(
    () => {
      const real: SessionBookingType[] = (bookings ?? []).filter(
        (b) => b.status !== "booked" || new Date(b.scheduledAt).getTime() < now.getTime(),
      );
      return [...real].sort(
        (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime(),
      );
    },
    [bookings],
  );
  const completedCount = past.filter((b) => b.status === "completed").length;

  const paginatedPast = useMemo(() => {
    const totalPages = Math.ceil(past.length / PAST_PAGE_SIZE);
    const start = pastPage * PAST_PAGE_SIZE;
    return { sessions: past.slice(start, start + PAST_PAGE_SIZE), totalPages };
  }, [past, pastPage]);

  // Deep link from the "your Private Coaching recording is ready" email/SMS:
  // /coaching/book-session?recording=<bookingId>. Once bookings load, jump to
  // the page holding that session and auto-open its recording dialog. Guarded by
  // a ref so closing the dialog (or paginating) doesn't re-trigger the open.
  const searchString = useSearch();
  const deepLinkRecordingId = useMemo(() => {
    const raw = new URLSearchParams(searchString).get("recording");
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [searchString]);
  const handledRecordingDeepLink = useRef<number | null>(null);

  useEffect(() => {
    if (deepLinkRecordingId === null) return;
    if (handledRecordingDeepLink.current === deepLinkRecordingId) return;
    const target = past.find((b) => b.id === deepLinkRecordingId);
    if (!target) return;
    handledRecordingDeepLink.current = deepLinkRecordingId;
    if (target.recordingUrl) {
      const index = past.findIndex((b) => b.id === deepLinkRecordingId);
      if (index >= 0) setPastPage(Math.floor(index / PAST_PAGE_SIZE));
      setActiveRecording(target);
    }
  }, [deepLinkRecordingId, past]);

  const cancelLocked = cancelTarget
    ? isLockedWithin24h(cancelTarget.scheduledAt, Date.now())
    : false;

  function openCancelDialog(booking: SessionBookingType) {
    setCancelTarget(booking);
  }

  async function confirmCancel() {
    const booking = cancelTarget;
    setCancelTarget(null);
    if (!booking) return;
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
            <h1 className="text-3xl font-bold text-foreground">Private Coaching</h1>
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
                <UpcomingSessionCard
                  booking={nextSession}
                  locked={nextLocked}
                  now={now}
                  cancelPending={cancelMutation.isPending}
                  onCancel={() => openCancelDialog(nextSession)}
                />
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
                  {upcoming.slice(1).map((booking) => {
                    const locked = isLockedWithin24h(
                      booking.scheduledAt,
                      now.getTime(),
                    );
                    return (
                      <UpcomingSessionCard
                        key={booking.id}
                        booking={booking}
                        locked={locked}
                        now={now}
                        cancelPending={cancelMutation.isPending}
                        onCancel={() => openCancelDialog(booking)}
                      />
                    );
                  })}
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
                    const recordingUrl = booking.recordingUrl ?? null;
                    const summaryUrl = booking.summaryUrl ?? null;
                    const transcriptUrl = booking.transcriptUrl ?? null;
                    const recordingEmbedUrl = recordingUrl
                      ? toDriveEmbedUrl(recordingUrl)
                      : null;
                    return (
                    <Card key={booking.id}>
                      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                          {statusBadge(booking.status)}
                          {recordingUrl && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() =>
                                recordingEmbedUrl
                                  ? setActiveRecording(booking)
                                  : window.open(
                                      recordingUrl,
                                      "_blank",
                                      "noopener,noreferrer",
                                    )
                              }
                              data-testid={`watch-recording-${booking.id}`}
                            >
                              <PlayCircle className="w-3.5 h-3.5 text-primary" />
                              Watch Recording
                            </Button>
                          )}
                          {summaryUrl && (
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                            >
                              <a
                                href={summaryUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                data-testid={`meeting-notes-${booking.id}`}
                              >
                                <FileText className="w-3.5 h-3.5 text-primary" />
                                See Meeting Notes
                              </a>
                            </Button>
                          )}
                          {transcriptUrl && (
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                            >
                              <a
                                href={transcriptUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                data-testid={`transcript-${booking.id}`}
                              >
                                <ScrollText className="w-3.5 h-3.5 text-primary" />
                                Read Transcript
                              </a>
                            </Button>
                          )}
                        </div>
                      </CardContent>
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
              <Card key={pkg.name} className="opacity-90 flex flex-col h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{pkg.name}</p>
                    <Badge variant="secondary">Coming soon</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{pkg.price}</p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col">
                  <p className="text-sm text-muted-foreground">{pkg.blurb}</p>
                  <Button className="mt-auto w-full" disabled>
                    Coming soon
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      <Dialog
        open={!!activeRecording}
        onOpenChange={(open) => {
          if (!open) setActiveRecording(null);
        }}
      >
        <DialogContent className="max-w-3xl p-0 overflow-hidden gap-0">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>
              {activeRecording
                ? `Session with ${activeRecording.coachName}`
                : "Session recording"}
            </DialogTitle>
          </DialogHeader>
          <div className="aspect-video w-full bg-black">
            {activeRecording?.recordingUrl &&
              toDriveEmbedUrl(activeRecording.recordingUrl) && (
                <iframe
                  src={toDriveEmbedUrl(activeRecording.recordingUrl)!}
                  title="Session recording"
                  className="w-full h-full border-0"
                  allow="autoplay; fullscreen"
                  allowFullScreen
                />
              )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this session?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelLocked
                ? "This session is within 24 hours of its start time. Cancelling now will count as a used credit — it will not be refunded."
                : "Your credit will be refunded and the session will be removed from your calendar."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep session</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelLocked ? "Cancel & use credit" : "Cancel session"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
