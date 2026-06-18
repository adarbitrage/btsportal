import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, Users } from "lucide-react";
import { format } from "date-fns";
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
import {
  useCoachGroupCalls,
  useCancelGroupCall,
  useRestoreGroupCall,
  type CoachGroupCall,
} from "@/lib/coach-group-calls-api";

export default function GroupCoaching() {
  const { toast } = useToast();
  const { data, isLoading, isError } = useCoachGroupCalls();
  const cancelCall = useCancelGroupCall();
  const restoreCall = useRestoreGroupCall();
  // The single date the coach is about to cancel (drives the confirm dialog).
  // Un-cancel is reversible and low-stakes, so it fires immediately.
  const [pendingCancel, setPendingCancel] = useState<CoachGroupCall | null>(null);

  const calls = data?.calls ?? [];

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

  const mutating = cancelCall.isPending || restoreCall.isPending;

  return (
    <AppLayout>
      <div className="space-y-6 max-w-4xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Group Coaching</h1>
          </div>
          <p className="text-muted-foreground">
            Your upcoming weekly group-call dates. Cancel a single date if you can't
            make it — members will see "no call this week" — and reinstate it any time.
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5 sm:p-6">
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                Loading your group calls…
              </div>
            ) : isError ? (
              <div className="text-sm text-destructive py-8 text-center">
                Couldn't load your group calls. Please refresh and try again.
              </div>
            ) : calls.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                You have no upcoming group calls scheduled.
              </div>
            ) : (
              <div className="border border-border/60 rounded-xl overflow-hidden">
                {calls.map((call, i) => {
                  const start = new Date(call.scheduledAt);
                  const end = new Date(start.getTime() + call.durationMinutes * 60000);
                  return (
                    <div
                      key={call.id}
                      data-testid={`group-call-${call.id}`}
                      data-cancelled={call.cancelled ? "true" : "false"}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 ${
                        i !== calls.length - 1 ? "border-b border-border/60" : ""
                      } ${i % 2 === 0 ? "bg-background" : "bg-muted/40"}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <CalendarClock className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <div
                            className={`text-sm ${
                              call.cancelled
                                ? "text-muted-foreground line-through"
                                : "text-foreground"
                            }`}
                          >
                            {format(start, "EEEE, MMM d")} ·{" "}
                            <strong className="text-foreground">
                              {format(start, "h:mm a")} – {format(end, "h:mm a")}
                            </strong>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {call.registeredCount} registered
                            </span>
                            {/* Admins (coaching:view, no coach record) see every
                                coach's calls, so label whose call this is. */}
                            {data?.coachId === null && (
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
                        </div>
                      </div>
                      {call.cancelled ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={mutating}
                          data-testid={`group-call-restore-${call.id}`}
                          className="font-semibold shrink-0"
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
                          className="font-semibold shrink-0"
                          onClick={() => setPendingCancel(call)}
                        >
                          Cancel this date
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
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
