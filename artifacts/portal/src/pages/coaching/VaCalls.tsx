import { useState, useMemo, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
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
  Phone,
  Calendar,
  Clock,
  Video,
  XCircle,
  CheckCircle2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  FileText,
  ScrollText,
  PlayCircle,
  Lock,
} from "lucide-react";
import { format, addMinutes, isBefore } from "date-fns";
import { Link, useSearch } from "wouter";
import { useAuth } from "@/lib/auth";
import { isAdminRole, isCoachRole } from "@workspace/auth";
import { useGetCurrentMember } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { resolveCoachPhotoUrl } from "@/lib/coaches-admin-api";
import { useMyVaCalls, useCancelVaCall, type VaCall } from "@/lib/va-calls-api";

const PAST_PAGE_SIZE = 5;

/**
 * Google Drive "view" links (…/file/d/<id>/view) can't be embedded directly;
 * the embeddable player URL is …/file/d/<id>/preview. Returns null when the
 * URL isn't a recognizable Drive file link (caller falls back to opening it).
 */
function toDriveEmbedUrl(url: string): string | null {
  const match = url.match(/\/file\/d\/([^/]+)/);
  return match ? `https://drive.google.com/file/d/${match[1]}/preview` : null;
}

function vaInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function UpcomingVaCard({
  call,
  now,
  cancelPending,
  onCancel,
}: {
  call: VaCall;
  now: Date;
  cancelPending: boolean;
  onCancel: () => void;
}) {
  const start = new Date(call.scheduledAt);
  const joinWindow = addMinutes(start, -5);
  const end = addMinutes(start, call.durationMinutes);
  const canJoin = !isBefore(now, joinWindow) && isBefore(now, end);
  const photo = resolveCoachPhotoUrl(call.coachPhotoUrl);
  return (
    <Card className="overflow-hidden" data-testid={`upcoming-${call.id}`}>
      <div className="flex flex-col sm:flex-row">
        <div className="bg-primary/5 p-6 flex flex-col items-center justify-center sm:w-40 border-b sm:border-b-0 sm:border-r border-border shrink-0">
          <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
            {format(start, "MMM")}
          </span>
          <span className="text-4xl font-bold text-foreground my-1">
            {format(start, "dd")}
          </span>
          <span className="text-sm text-muted-foreground">
            {format(start, "EEEE")}
          </span>
        </div>
        <div className="p-6 flex-1 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1 text-foreground">
              <Clock className="w-5 h-5 text-primary" />
              <span className="text-xl font-bold tracking-tight">
                {format(start, "h:mm a")}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-2">
              {photo ? (
                <img
                  src={photo}
                  alt={call.coachName}
                  className="w-10 h-10 rounded-full object-cover border border-border/60"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                  {vaInitials(call.coachName)}
                </div>
              )}
              <div>
                <h3 className="text-lg font-bold text-foreground">
                  1-on-1 VA Call with {call.coachName}
                </h3>
                <p className="text-sm text-muted-foreground">
                  Free {call.durationMinutes} minute call
                </p>
              </div>
            </div>
            {call.discussionTopic && (
              <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
                <span className="font-medium text-foreground">Topic:</span>{" "}
                {call.discussionTopic}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-3 sm:items-end shrink-0">
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span>Free to cancel or reschedule up to 1 hour before.</span>
            </p>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap sm:justify-end">
              {canJoin && call.meetLink ? (
                <a
                  href={call.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                    <Video className="w-4 h-4 mr-2" />
                    Join Call
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
              <Link href={`/va-calls/book?reschedule=${call.id}`}>
                <Button
                  className="bg-[#188f4a] text-white hover:bg-[#136b38]"
                  data-testid={`reschedule-${call.id}`}
                >
                  <CalendarClock className="w-4 h-4 mr-2" />
                  Reschedule
                </Button>
              </Link>
              <Button
                variant="destructive"
                className="hover:bg-destructive/70"
                onClick={onCancel}
                disabled={cancelPending}
                data-testid={`cancel-${call.id}`}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function VaCalls() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: member } = useGetCurrentMember();
  const isAdmin = isAdminRole(user?.role) || isAdminRole(member?.role);
  const isCoach = isCoachRole(user?.role) || isCoachRole(member?.role);
  const entitlements = new Set(member?.entitlements ?? []);
  const eligible = isAdmin || isCoach || entitlements.has("coaching:group");

  const [pastPage, setPastPage] = useState(0);
  const [activeRecording, setActiveRecording] = useState<VaCall | null>(null);
  const [cancelTarget, setCancelTarget] = useState<VaCall | null>(null);

  const { data: calls, isLoading } = useMyVaCalls({ enabled: eligible });
  const cancelMutation = useCancelVaCall();
  const now = new Date();

  const upcoming = useMemo(() => {
    return (calls ?? [])
      .filter(
        (c) =>
          c.status === "booked" &&
          new Date(c.scheduledAt).getTime() > now.getTime(),
      )
      .sort(
        (a, b) =>
          new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls]);
  const nextCall = upcoming[0];

  const past = useMemo<VaCall[]>(() => {
    return (calls ?? [])
      .filter(
        (c) =>
          !(
            c.status === "booked" &&
            new Date(c.scheduledAt).getTime() > now.getTime()
          ),
      )
      .sort(
        (a, b) =>
          new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime(),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls]);
  const completedCount = past.filter((c) => c.status === "completed").length;

  const paginatedPast = useMemo(() => {
    const totalPages = Math.ceil(past.length / PAST_PAGE_SIZE);
    const start = pastPage * PAST_PAGE_SIZE;
    return { calls: past.slice(start, start + PAST_PAGE_SIZE), totalPages };
  }, [past, pastPage]);

  // Deep link from a "your VA-call recording is ready" notification:
  // /va-calls?recording=<bookingId>. Once calls load, jump to the page holding
  // that call and auto-open its recording dialog. Guarded by a ref so closing
  // the dialog (or paginating) doesn't re-trigger the open.
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
    const target = past.find((c) => c.id === deepLinkRecordingId);
    if (!target) return;
    handledRecordingDeepLink.current = deepLinkRecordingId;
    if (target.recordingUrl) {
      const index = past.findIndex((c) => c.id === deepLinkRecordingId);
      if (index >= 0) setPastPage(Math.floor(index / PAST_PAGE_SIZE));
      setActiveRecording(target);
    }
  }, [deepLinkRecordingId, past]);

  async function confirmCancel() {
    const call = cancelTarget;
    setCancelTarget(null);
    if (!call) return;
    try {
      await cancelMutation.mutateAsync({ bookingId: call.id });
      toast({
        title: "Call cancelled",
        description: "Your 1-on-1 VA call has been cancelled.",
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
        return <Badge variant="secondary">Completed</Badge>;
    }
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Phone className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold text-foreground">1-on-1 VA Calls</h1>
          </div>
          <p className="text-muted-foreground">
            Book a free 30-minute private call with a member of the BTS
            Concierge™ team for personalized, hands-on assistance — banner
            creation, landing page setup, Flexy configuration, MetricMover
            variations, DIYTrax campaign setup, and more. Available Monday
            through Saturday.
          </p>
        </div>

        {!eligible ? (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-muted border border-border/60 mx-auto flex items-center justify-center">
                <Lock className="w-5 h-5 text-muted-foreground" />
              </div>
              <h3 className="text-base font-bold text-foreground">
                Full membership required
              </h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Free 1-on-1 VA calls are included with full BTS memberships.
                Upgrade your membership to book a call with the Concierge™ team.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {/* Upcoming */}
            <div>
              <div className="flex items-center justify-between gap-4 border-b border-border pb-3 mb-6">
                <h2 className="text-xl font-bold text-foreground">
                  Upcoming Calls
                </h2>
                <Link href="/va-calls/book">
                  <Button size="sm" className="shadow-lg shadow-primary/20">
                    <Phone className="w-4 h-4 mr-2" />
                    Book a Call
                  </Button>
                </Link>
              </div>
              {isLoading ? (
                <div className="animate-pulse h-40 bg-card rounded-xl" />
              ) : nextCall ? (
                <UpcomingVaCard
                  call={nextCall}
                  now={now}
                  cancelPending={cancelMutation.isPending}
                  onCancel={() => setCancelTarget(nextCall)}
                />
              ) : (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Calendar className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      No Upcoming Calls
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Book a free 1-on-1 VA call to get hands-on help.
                    </p>
                    <Link href="/va-calls/book">
                      <Button>
                        <Phone className="w-4 h-4 mr-2" />
                        Book a Call
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              )}

              {upcoming.length > 1 && (
                <div className="mt-4 space-y-3">
                  {upcoming.slice(1).map((call) => (
                    <UpcomingVaCard
                      key={call.id}
                      call={call}
                      now={now}
                      cancelPending={cancelMutation.isPending}
                      onCancel={() => setCancelTarget(call)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Past */}
            <div>
              <h2 className="text-xl font-bold text-foreground border-b border-border pb-3 mb-6">
                Past Calls
                {completedCount > 0 && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({completedCount} completed)
                  </span>
                )}
              </h2>
              {isLoading ? (
                <div className="animate-pulse space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 bg-card rounded-xl" />
                  ))}
                </div>
              ) : paginatedPast.calls.length > 0 ? (
                <div className="space-y-3">
                  {paginatedPast.calls.map((call) => {
                    const recordingUrl = call.recordingUrl ?? null;
                    const summaryUrl = call.summaryUrl ?? null;
                    const transcriptUrl = call.transcriptUrl ?? null;
                    const recordingEmbedUrl = recordingUrl
                      ? toDriveEmbedUrl(recordingUrl)
                      : null;
                    return (
                      <Card key={call.id}>
                        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="flex items-center gap-4 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                              {call.status === "cancelled" ? (
                                <XCircle className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <CheckCircle2 className="w-4 h-4 text-primary" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-semibold text-foreground text-sm">
                                1-on-1 VA Call with {call.coachName}
                              </h4>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {format(
                                    new Date(call.scheduledAt),
                                    "MMM d, yyyy",
                                  )}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {format(new Date(call.scheduledAt), "h:mm a")}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 flex-wrap">
                            {statusBadge(call.status)}
                            {recordingUrl && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                onClick={() =>
                                  recordingEmbedUrl
                                    ? setActiveRecording(call)
                                    : window.open(
                                        recordingUrl,
                                        "_blank",
                                        "noopener,noreferrer",
                                      )
                                }
                                data-testid={`watch-recording-${call.id}`}
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
                                  data-testid={`meeting-notes-${call.id}`}
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
                                  data-testid={`transcript-${call.id}`}
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
                          setPastPage((p) =>
                            Math.min(paginatedPast.totalPages - 1, p + 1),
                          )
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
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      No Past Calls
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Your completed 1-on-1 VA calls will appear here.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
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
                ? `1-on-1 VA Call with ${activeRecording.coachName}`
                : "Call recording"}
            </DialogTitle>
          </DialogHeader>
          <div className="aspect-video w-full bg-black">
            {activeRecording?.recordingUrl &&
              toDriveEmbedUrl(activeRecording.recordingUrl) && (
                <iframe
                  src={toDriveEmbedUrl(activeRecording.recordingUrl)!}
                  title="Call recording"
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
            <AlertDialogTitle>Cancel this call?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget
                ? `Your 1-on-1 VA call with ${cancelTarget.coachName} on ${format(
                    new Date(cancelTarget.scheduledAt),
                    "EEE, MMM d 'at' h:mm a",
                  )} will be cancelled. You can book another one any time.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep call</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel call
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
