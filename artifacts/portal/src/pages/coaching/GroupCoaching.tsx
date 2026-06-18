import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, Users } from "lucide-react";
import { format, isSameDay, startOfMonth } from "date-fns";
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
  type CoachGroupCall,
} from "@/lib/coach-group-calls-api";

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

  const events: CalendarDayEvent[] = calls.map((c) => ({
    id: c.id,
    date: new Date(c.scheduledAt),
    cancelled: c.cancelled,
  }));

  const selectedDayCalls = selectedDate
    ? calls
        .filter((c) => isSameDay(new Date(c.scheduledAt), selectedDate))
        .sort(
          (a, b) =>
            new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
        )
    : [];

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
              {selectedDayCalls.length === 0 ? (
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
                      </div>
                    );
                  })}
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
