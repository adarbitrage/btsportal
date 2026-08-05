import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClock, CheckCircle2, LifeBuoy, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MonthCalendar, type CalendarDayEvent } from "@/components/coaching/MonthCalendar";
import {
  getMemberTimezone,
  getFriendlyTimezoneLabel,
  formatMemberTime,
  formatMemberFullDateTime,
} from "@/lib/member-timezone";
import { authFetch, useAuth } from "@/lib/auth";

/**
 * FE-Intensive booking surface — drops into the Welcome page's booking slot.
 *
 * States:
 *   - config unset (server reports configured:false) → parent keeps rendering
 *     its pending card (this component renders it via the `pending` prop).
 *   - configured, no upcoming booking → month calendar + slot buttons
 *     (kickoff booking layout pattern) → confirmation card on success.
 *   - configured, upcoming booking → booked-state card in the member's
 *     timezone with cancel / rebook.
 *   - GHL/server errors → friendly retry card, never a broken grid.
 *
 * All member-facing copy arrives brand-substituted from the gated
 * frontend-welcome curriculum payload (`copy` prop) — nothing user-visible
 * is hardcoded here except icons/layout.
 */

export interface FeBookingUiCopy {
  intro: string;
  timezoneNote: string;
  chooseDayHint: string;
  noSlotsForDay: string;
  noSlotsAtAll: string;
  confirmCta: string;
  bookingInProgress: string;
  confirmationTitle: string;
  confirmationBody: string;
  bookedTitle: string;
  bookedBody: string;
  cancelCta: string;
  rebookCta: string;
  cancelConfirmTitle: string;
  cancelConfirmBody: string;
  keepCta: string;
  supportLine: string;
  errorTitle: string;
  errorBody: string;
  retryCta: string;
}

interface FeBooking {
  id: number;
  scheduledAt: string;
  endAt: string;
  durationMinutes: number;
  status: string;
}

interface StatusResponse {
  configured: boolean;
  booking: FeBooking | null;
}

interface AvailabilityResponse {
  configured: boolean;
  slots: { startTime: string }[];
  durationMinutes?: number;
}

const SLOT_DISPLAY_CAP = 12;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await authFetch(path);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export function FeIntensiveBooking({
  copy,
  pending,
}: {
  copy: FeBookingUiCopy;
  pending: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const timezone = getMemberTimezone(user?.timezone);
  const tzLabel = getFriendlyTimezoneLabel(timezone);

  const [month, setMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [showAllSlots, setShowAllSlots] = useState(false);
  const [justBooked, setJustBooked] = useState<FeBooking | null>(null);

  const statusQuery = useQuery({
    queryKey: ["fe-intensive-status"],
    queryFn: () => fetchJson<StatusResponse>("/fe-intensive/status"),
  });

  const configured = statusQuery.data?.configured === true;
  const activeBooking = statusQuery.data?.booking ?? null;
  const showGrid = configured && !activeBooking && !justBooked;

  const availabilityQuery = useQuery({
    queryKey: ["fe-intensive-availability"],
    queryFn: () => fetchJson<AvailabilityResponse>("/fe-intensive/availability"),
    enabled: showGrid,
  });

  const bookMutation = useMutation({
    mutationFn: async (startTime: string) => {
      const res = await authFetch("/fe-intensive/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || "Booking failed");
      return (json as { booking: FeBooking }).booking;
    },
    onSuccess: (booking) => {
      setJustBooked(booking);
      setSelectedSlot(null);
      queryClient.invalidateQueries({ queryKey: ["fe-intensive-status"] });
      queryClient.invalidateQueries({ queryKey: ["fe-intensive-availability"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (bookingId: number) => {
      const res = await authFetch("/fe-intensive/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || "Cancel failed");
      return json;
    },
    onSuccess: () => {
      setJustBooked(null);
      queryClient.invalidateQueries({ queryKey: ["fe-intensive-status"] });
      queryClient.invalidateQueries({ queryKey: ["fe-intensive-availability"] });
    },
  });

  const slotsByDate = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const slot of availabilityQuery.data?.slots ?? []) {
      const key = format(new Date(slot.startTime), "yyyy-MM-dd");
      const list = map.get(key);
      if (list) list.push(slot.startTime);
      else map.set(key, [slot.startTime]);
    }
    return map;
  }, [availabilityQuery.data?.slots]);

  const calendarEvents: CalendarDayEvent[] = useMemo(
    () =>
      Array.from(slotsByDate.keys()).map((key) => ({
        id: key,
        date: new Date(`${key}T12:00:00`),
      })),
    [slotsByDate],
  );

  const slotsForSelectedDate = selectedDate
    ? slotsByDate.get(format(selectedDate, "yyyy-MM-dd")) ?? []
    : [];
  const visibleSlots = showAllSlots
    ? slotsForSelectedDate
    : slotsForSelectedDate.slice(0, SLOT_DISPLAY_CAP);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (statusQuery.isLoading) {
    return (
      <div className="space-y-3" data-testid="fe-booking-loading">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // ── Status error → friendly retry (never a broken grid) ───────────────────
  if (statusQuery.isError) {
    return (
      <ErrorCard
        copy={copy}
        onRetry={() => statusQuery.refetch()}
        testId="fe-booking-status-error"
      />
    );
  }

  // ── Config unset → pending state (today's behavior) ───────────────────────
  if (!configured) {
    return <>{pending}</>;
  }

  // ── Just booked → confirmation card ───────────────────────────────────────
  if (justBooked) {
    return (
      <Card data-testid="fe-booking-confirmation">
        <CardContent className="py-10 text-center space-y-3">
          <CheckCircle2 className="w-10 h-10 text-primary mx-auto" />
          <p className="text-lg font-semibold">{copy.confirmationTitle}</p>
          <p className="text-foreground font-medium">
            {formatMemberFullDateTime(justBooked.scheduledAt, timezone)}
          </p>
          <p className="text-sm text-muted-foreground">
            {copy.timezoneNote} {tzLabel}
          </p>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            {copy.confirmationBody}
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Booked state → details + cancel / rebook ──────────────────────────────
  if (activeBooking) {
    return (
      <Card data-testid="fe-booking-booked">
        <CardContent className="py-8 text-center space-y-4">
          <CalendarClock className="w-10 h-10 text-primary mx-auto" />
          <p className="text-lg font-semibold">{copy.bookedTitle}</p>
          <p className="text-xl font-bold text-foreground" data-testid="fe-booking-booked-time">
            {formatMemberFullDateTime(activeBooking.scheduledAt, timezone)}
          </p>
          <p className="text-sm text-muted-foreground">
            {copy.timezoneNote} {tzLabel} · {activeBooking.durationMinutes} min
          </p>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            {copy.bookedBody}
          </p>
          {cancelMutation.isError && (
            <p className="text-sm text-destructive" data-testid="fe-booking-cancel-error">
              {(cancelMutation.error as Error).message}
            </p>
          )}
          <div className="flex items-center justify-center gap-3 pt-1">
            <CancelDialog
              copy={copy}
              disabled={cancelMutation.isPending}
              onConfirm={() => cancelMutation.mutate(activeBooking.id)}
            />
            {/* Rebook = release the current slot, then the grid re-opens
                (status invalidation flips booking → null). Same confirm
                dialog contract as cancel since it cancels first. */}
            <RebookDialog
              copy={copy}
              disabled={cancelMutation.isPending}
              onConfirm={() => cancelMutation.mutate(activeBooking.id)}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Booking grid ───────────────────────────────────────────────────────────
  if (availabilityQuery.isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="fe-booking-grid-loading">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (availabilityQuery.isError) {
    return (
      <ErrorCard
        copy={copy}
        onRetry={() => availabilityQuery.refetch()}
        testId="fe-booking-availability-error"
      />
    );
  }

  const noSlotsAtAll = slotsByDate.size === 0;

  return (
    <Card data-testid="fe-booking-grid">
      <CardContent className="py-6 space-y-5">
        <p className="text-muted-foreground leading-relaxed text-center max-w-2xl mx-auto">
          {copy.intro}
        </p>
        <p className="text-sm text-muted-foreground text-center">
          {copy.timezoneNote} <span className="font-medium text-foreground">{tzLabel}</span>
        </p>

        {noSlotsAtAll ? (
          <p
            className="text-center text-muted-foreground py-8 max-w-xl mx-auto"
            data-testid="fe-booking-no-slots"
          >
            {copy.noSlotsAtAll}
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <MonthCalendar
                month={month}
                onMonthChange={(next) => {
                  setMonth(next);
                  setSelectedDate(null);
                  setSelectedSlot(null);
                  setShowAllSlots(false);
                }}
                events={calendarEvents}
                selectedDate={selectedDate}
                onSelectDate={(d) => {
                  setSelectedDate(d);
                  setSelectedSlot(null);
                  setShowAllSlots(false);
                }}
              />
            </div>
            <div className="space-y-3">
              {!selectedDate && (
                <p className="text-muted-foreground text-sm py-6 text-center">
                  {copy.chooseDayHint}
                </p>
              )}
              {selectedDate && slotsForSelectedDate.length === 0 && (
                <p className="text-muted-foreground text-sm py-6 text-center">
                  {copy.noSlotsForDay}
                </p>
              )}
              {selectedDate && slotsForSelectedDate.length > 0 && (
                <>
                  <div className="grid grid-cols-2 gap-2" data-testid="fe-booking-slots">
                    {visibleSlots.map((startTime) => {
                      const isSelected = selectedSlot === startTime;
                      return (
                        <Button
                          key={startTime}
                          type="button"
                          variant={isSelected ? "default" : "outline"}
                          onClick={() => setSelectedSlot(startTime)}
                          data-testid={`fe-slot-${startTime}`}
                        >
                          {formatMemberTime(startTime, timezone)}
                        </Button>
                      );
                    })}
                  </div>
                  {!showAllSlots && slotsForSelectedDate.length > SLOT_DISPLAY_CAP && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full"
                      onClick={() => setShowAllSlots(true)}
                    >
                      +{slotsForSelectedDate.length - SLOT_DISPLAY_CAP}
                    </Button>
                  )}
                  {bookMutation.isError && (
                    <p className="text-sm text-destructive" data-testid="fe-booking-book-error">
                      {(bookMutation.error as Error).message}
                    </p>
                  )}
                  <Button
                    type="button"
                    className="w-full"
                    disabled={!selectedSlot || bookMutation.isPending}
                    onClick={() => selectedSlot && bookMutation.mutate(selectedSlot)}
                    data-testid="fe-booking-confirm"
                  >
                    {bookMutation.isPending ? copy.bookingInProgress : copy.confirmCta}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
          <LifeBuoy className="w-4 h-4" />
          {copy.supportLine}
        </p>
      </CardContent>
    </Card>
  );
}

function ErrorCard({
  copy,
  onRetry,
  testId,
}: {
  copy: FeBookingUiCopy;
  onRetry: () => void;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="py-10 text-center space-y-3">
        <p className="text-lg font-semibold">{copy.errorTitle}</p>
        <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">{copy.errorBody}</p>
        <Button type="button" variant="outline" onClick={onRetry} data-testid="fe-booking-retry">
          <RefreshCw className="w-4 h-4 mr-2" />
          {copy.retryCta}
        </Button>
      </CardContent>
    </Card>
  );
}

function CancelDialog({
  copy,
  disabled,
  onConfirm,
}: {
  copy: FeBookingUiCopy;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} data-testid="fe-booking-cancel">
          {copy.cancelCta}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.cancelConfirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{copy.cancelConfirmBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{copy.keepCta}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} data-testid="fe-booking-cancel-confirm">
            {copy.cancelCta}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RebookDialog({
  copy,
  disabled,
  onConfirm,
}: {
  copy: FeBookingUiCopy;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" disabled={disabled} data-testid="fe-booking-rebook">
          {copy.rebookCta}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.cancelConfirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{copy.cancelConfirmBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{copy.keepCta}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} data-testid="fe-booking-rebook-confirm">
            {copy.rebookCta}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
