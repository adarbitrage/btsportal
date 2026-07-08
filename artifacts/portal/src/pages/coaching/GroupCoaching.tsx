import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, Users, AlertTriangle, CalendarOff } from "lucide-react";
import {
  format,
  isSameDay,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { useToast } from "@/hooks/use-toast";
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
import { MonthCalendar, type CalendarDayEvent } from "@/components/coaching/MonthCalendar";
import {
  useCoachGroupCalls,
  useGroupCoachingCoaches,
  useCancelGroupCall,
  useRestoreGroupCall,
  useCoachCalendarBusy,
  useGroupCallRoster,
  type CoachGroupCall,
} from "@/lib/coach-group-calls-api";

// Collapsible RSVP roster for one call in the day-detail panel. The roster
// request only fires while expanded (the hook is disabled when collapsed).
function CallRoster({ callId }: { callId: number }) {
  const [expanded, setExpanded] = useState(false);
  const roster = useGroupCallRoster(expanded ? callId : null);
  return (
    <div className="mt-2">
      <Button
        size="sm"
        variant="ghost"
        data-testid={`group-call-roster-toggle-${callId}`}
        className="font-semibold w-full"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Hide RSVPs" : "View RSVPs"}
      </Button>
      {expanded && (
        <div data-testid={`group-call-roster-${callId}`} className="mt-2 space-y-1.5">
          {roster.isLoading ? (
            <div className="text-xs text-muted-foreground py-1">Loading roster…</div>
          ) : roster.isError ? (
            <div className="text-xs text-destructive py-1">Couldn't load the roster.</div>
          ) : (roster.data?.members.length ?? 0) === 0 ? (
            <div data-testid={`group-call-roster-empty-${callId}`} className="text-xs text-muted-foreground py-1">
              No RSVPs yet.
            </div>
          ) : (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {roster.data!.rsvpCount} RSVP'd · {roster.data!.joinedCount} joined
              </div>
              {roster.data!.members.map((m) => (
                <div
                  key={m.userId}
                  data-testid={`roster-member-${callId}-${m.userId}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-xs"
                >
                  <span className="text-foreground truncate">{m.name}</span>
                  {m.joined ? (
                    <Badge variant="secondary" className="text-[10px] shrink-0">Joined</Badge>
                  ) : m.rsvpd ? (
                    <Badge variant="outline" className="text-[10px] shrink-0">RSVP'd</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] shrink-0">Cancelled RSVP</Badge>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function GroupCoaching() {
  const { toast } = useToast();
  // Admin-only: which coach's calendar is being viewed. Null while we wait for
  // the roster to load (we default to the first coach once it arrives). A plain
  // coach is pinned server-side to their own schedule and ignores this entirely.
  const [selectedCoachId, setSelectedCoachId] = useState<number | null>(null);
  const { data, isLoading, isError } = useCoachGroupCalls(selectedCoachId);
  const isAdmin = data?.isAdmin ?? false;
  const coachesQuery = useGroupCoachingCoaches(isAdmin);

  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  // The day the coach is focused on (drives the detail panel below the grid).
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  // The single date about to be cancelled (drives the confirm dialog). Un-cancel
  // is reversible and low-stakes, so it fires immediately without a confirm.
  const [pendingCancel, setPendingCancel] = useState<CoachGroupCall | null>(null);

  const cancelCall = useCancelGroupCall();
  const restoreCall = useRestoreGroupCall();
  const mutating = cancelCall.isPending || restoreCall.isPending;

  const calls = data?.calls ?? [];
  const coaches = coachesQuery.data ?? [];

  // The visible 6-week grid window (Sun-aligned), matching MonthCalendar, so the
  // busy overlay covers exactly the days the calendar can show — including the
  // trailing/leading days from adjacent months.
  const gridFrom = startOfWeek(startOfMonth(month)).toISOString();
  const gridTo = endOfWeek(endOfMonth(month)).toISOString();
  const busyQuery = useCoachCalendarBusy(selectedCoachId, gridFrom, gridTo);
  const busyConnected = busyQuery.data?.connected ?? false;
  const busyNeedsReconnect = busyQuery.data?.needsReconnect ?? false;
  const busyBlocks = (busyQuery.data?.busy ?? []).map((b, i) => ({
    id: `busy-${i}`,
    start: new Date(b.start),
    end: new Date(b.end),
  }));

  // Once the admin roster loads, default the picker to the first coach so the
  // calendar opens on a single coach (personal-first) rather than every coach.
  useEffect(() => {
    if (isAdmin && selectedCoachId === null && coaches.length > 0) {
      setSelectedCoachId(coaches[0].id);
    }
  }, [isAdmin, selectedCoachId, coaches]);

  // Focus the soonest call's date (and bring it into view) once data loads, so
  // the detail panel isn't empty. Calls arrive ordered soonest-first.
  useEffect(() => {
    if (selectedDate === null && calls.length > 0) {
      const soonest = new Date(calls[0].scheduledAt);
      setSelectedDate(soonest);
      setMonth(startOfMonth(soonest));
    }
  }, [calls, selectedDate]);

  // A conflict is an ACTIVE (non-cancelled) group call whose time window
  // overlaps an external busy block. Cancelled calls never conflict (the date
  // is already off). Collected as id sets so both the calendar markers and the
  // day-detail panel can flag the exact calls/blocks involved.
  const conflictingCallIds = new Set<number>();
  const conflictingBusyIds = new Set<string>();
  for (const call of calls) {
    if (call.cancelled) continue;
    const callStart = new Date(call.scheduledAt).getTime();
    const callEnd = callStart + call.durationMinutes * 60000;
    for (const block of busyBlocks) {
      const blockStart = block.start.getTime();
      const blockEnd = block.end.getTime();
      if (callStart < blockEnd && blockStart < callEnd) {
        conflictingCallIds.add(call.id);
        conflictingBusyIds.add(block.id);
      }
    }
  }

  const callEvents: CalendarDayEvent[] = calls.map((c) => ({
    id: c.id,
    date: new Date(c.scheduledAt),
    kind: "group-call",
    cancelled: c.cancelled,
    conflict: conflictingCallIds.has(c.id),
  }));
  const busyEvents: CalendarDayEvent[] = busyBlocks.map((b) => ({
    id: b.id,
    date: b.start,
    kind: "busy",
    conflict: conflictingBusyIds.has(b.id),
  }));
  const events: CalendarDayEvent[] = [...callEvents, ...busyEvents];

  const selectedDayCalls = selectedDate
    ? calls
        .filter((c) => isSameDay(new Date(c.scheduledAt), selectedDate))
        .sort(
          (a, b) =>
            new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
        )
    : [];

  const selectedDayBusy = selectedDate
    ? busyBlocks
        .filter((b) => isSameDay(b.start, selectedDate))
        .sort((a, b) => a.start.getTime() - b.start.getTime())
    : [];

  const selectedDayHasConflict =
    selectedDayCalls.some((c) => conflictingCallIds.has(c.id));

  const handleCoachChange = (id: number) => {
    setSelectedCoachId(id);
    // The new coach has a different schedule; let the soonest-call effect
    // re-focus a relevant date instead of keeping a stale selection.
    setSelectedDate(null);
  };

  const handleCancel = (call: CoachGroupCall) => {
    cancelCall.mutate(call.id, {
      onSuccess: () =>
        toast({ title: "Call cancelled", description: "Members will see this date is off." }),
      onError: (err) =>
        toast({ title: "Could not cancel", description: err.message, variant: "destructive" }),
    });
    setPendingCancel(null);
  };

  const handleRestore = (call: CoachGroupCall) => {
    restoreCall.mutate(call.id, {
      onSuccess: () =>
        toast({ title: "Call reinstated", description: "This date is back on the schedule." }),
      onError: (err) =>
        toast({ title: "Could not reinstate", description: err.message, variant: "destructive" }),
    });
  };

  return (
    <AppLayout>
      <div className="space-y-6 max-w-4xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Group Coaching</h1>
          </div>
          <p className="text-muted-foreground">
            Your weekly group-call dates at a glance. Pick a date to cancel it if you
            can't make it — members will see "no call this week" — and reinstate it any time.
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-3">
            <label
              htmlFor="coach-picker"
              className="text-sm font-medium text-muted-foreground shrink-0"
            >
              Coach
            </label>
            <select
              id="coach-picker"
              data-testid="coach-picker"
              value={selectedCoachId ?? ""}
              disabled={coaches.length === 0}
              onChange={(e) => handleCoachChange(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            >
              {coaches.length === 0 && <option value="">Loading coaches…</option>}
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-5 sm:p-6">
              {isLoading ? (
                <div className="text-sm text-muted-foreground py-8 text-center">
                  Loading group calls…
                </div>
              ) : isError ? (
                <div className="text-sm text-destructive py-8 text-center">
                  Couldn't load group calls. Please refresh and try again.
                </div>
              ) : (
                <MonthCalendar
                  month={month}
                  onMonthChange={setMonth}
                  events={events}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                />
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-5 sm:p-6">
              <h2 className="text-sm font-semibold mb-3">
                {selectedDate
                  ? format(selectedDate, "EEEE, MMM d")
                  : "Select a date"}
              </h2>

              {selectedDayHasConflict && (
                <div
                  data-testid="day-conflict-warning"
                  className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    This group call overlaps something on the connected Google
                    Calendar. Cancel or move the call if you can't make it.
                  </span>
                </div>
              )}

              {selectedDayCalls.length === 0 && selectedDayBusy.length === 0 ? (
                <div
                  data-testid="day-detail-empty"
                  className="text-sm text-muted-foreground py-4"
                >
                  No group call on this date.
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedDayCalls.map((call) => {
                    const start = new Date(call.scheduledAt);
                    const end = new Date(start.getTime() + call.durationMinutes * 60000);
                    return (
                      <div
                        key={call.id}
                        data-testid={`group-call-${call.id}`}
                        data-cancelled={call.cancelled ? "true" : "false"}
                        className="rounded-lg border border-border/60 p-3"
                      >
                        <div
                          className={`text-sm font-medium ${
                            call.cancelled
                              ? "text-muted-foreground line-through"
                              : "text-foreground"
                          }`}
                        >
                          {format(start, "h:mm a")} – {format(end, "h:mm a")}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {call.registeredCount} registered
                          </span>
                          {/* Admins view any coach's calendar, so name the coach. */}
                          {isAdmin && (
                            <span className="text-xs text-muted-foreground">
                              · {call.coachName}
                            </span>
                          )}
                          {call.cancelled && (
                            <Badge variant="secondary" className="text-[10px]">
                              Cancelled
                            </Badge>
                          )}
                        </div>
                        <div className="mt-3">
                          {call.cancelled ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={mutating}
                              data-testid={`group-call-restore-${call.id}`}
                              className="font-semibold w-full"
                              onClick={() => handleRestore(call)}
                            >
                              Reinstate
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={mutating}
                              data-testid={`group-call-cancel-${call.id}`}
                              className="font-semibold w-full"
                              onClick={() => setPendingCancel(call)}
                            >
                              Cancel this date
                            </Button>
                          )}
                        </div>
                        <CallRoster callId={call.id} />
                      </div>
                    );
                  })}

                  {selectedDayBusy.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Google Calendar
                      </div>
                      {selectedDayBusy.map((block) => (
                        <div
                          key={block.id}
                          data-testid={`busy-block-${block.id}`}
                          className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs"
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/70" />
                          <span className="text-muted-foreground">
                            Busy · {format(block.start, "h:mm a")} –{" "}
                            {format(block.end, "h:mm a")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!busyConnected && (
                <div
                  data-testid="calendar-not-connected"
                  className="mt-4 flex items-start gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground"
                >
                  <CalendarOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {busyNeedsReconnect
                      ? "Reconnect your Google account on the Sessions page to grant calendar access and see conflicts here."
                      : "Connect a Google account on the Sessions page to overlay your calendar and flag conflicts."}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog
        open={pendingCancel !== null}
        onOpenChange={(open) => !open && setPendingCancel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this group call?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCancel && (
                <>
                  Members will see "no call this week" for{" "}
                  <strong>
                    {format(new Date(pendingCancel.scheduledAt), "EEEE, MMM d")}
                  </strong>
                  . You can reinstate this date at any time.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep call</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingCancel && handleCancel(pendingCancel)}
            >
              Cancel this date
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
