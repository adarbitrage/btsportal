import { useState, useMemo, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Clock,
  Check,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  UserCheck,
  Ticket,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  addMonths,
  subMonths,
  getDay,
  isToday,
  isBefore,
  startOfDay,
  addMinutes,
} from "date-fns";
import { getFriendlyTimezoneLabel } from "@/lib/member-timezone";
import { Link, useLocation, useSearch } from "wouter";
import {
  useSessionBalance,
  useSessionCoaches,
  useSessionCoachSlots,
  useSessionCoachBusy,
  useMySessionBookings,
  useBookSessionPack,
  useRescheduleSessionBooking,
  type SessionCoach,
  type SessionSlot,
} from "@/lib/session-packs-api";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { resolveCoachPhotoUrl } from "@/lib/coaches-admin-api";

const SESSION_DURATION_MINUTES = 60;
const SLOT_DISPLAY_CAP = 8;

type WizardStep = 1 | 2 | 3;

function coachInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function BookSessionPack() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const rescheduleId = searchParams.get("reschedule");
  const isReschedule = !!rescheduleId;
  const rescheduleBookingId = rescheduleId ? parseInt(rescheduleId, 10) : null;

  const [step, setStep] = useState<WizardStep>(isReschedule ? 2 : 1);
  const [selectedCoach, setSelectedCoach] = useState<SessionCoach | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showAllSlots, setShowAllSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SessionSlot | null>(null);
  const [discussionTopic, setDiscussionTopic] = useState("");

  const memberTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const { data: balanceData } = useSessionBalance();
  const { data: coaches, isLoading: coachesLoading } = useSessionCoaches();
  const { data: myBookings } = useMySessionBookings();

  const balance = balanceData?.balance ?? 0;

  // In reschedule mode, pin the coach to the existing booking's coach.
  useEffect(() => {
    if (!isReschedule || selectedCoach || !rescheduleBookingId) return;
    const booking = myBookings?.find((b) => b.id === rescheduleBookingId);
    if (booking) {
      setSelectedCoach({
        id: booking.coachId,
        name: booking.coachName,
        bio: null,
        photoUrl: booking.coachPhotoUrl,
        sortOrder: 0,
      });
    }
  }, [isReschedule, selectedCoach, rescheduleBookingId, myBookings]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const calendarStartDay = getDay(monthStart);

  const startDate = format(monthStart, "yyyy-MM-dd");
  const endDate = format(monthEnd, "yyyy-MM-dd");
  const { data: slotsData, isLoading: slotsLoading } = useSessionCoachSlots(
    selectedCoach?.id ?? 0,
    startDate,
    endDate,
  );

  // The coach's real Google Calendar busy intervals for the visible month, used
  // to flag slots that clash with their actual calendar (GHL free-slots don't
  // know about it). Only busy intervals are returned — never event details.
  const { data: busyData } = useSessionCoachBusy(
    selectedCoach?.id ?? 0,
    monthStart.toISOString(),
    endOfMonth(currentMonth).toISOString(),
  );

  const slotsByDate = useMemo(() => {
    const map = new Map<string, SessionSlot[]>();
    if (!slotsData?.slots) return map;
    for (const slot of slotsData.slots) {
      const dateKey = format(new Date(slot.startTime), "yyyy-MM-dd");
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(slot);
    }
    return map;
  }, [slotsData]);

  // Set of slot start times (the canonical slot key) that overlap a coach busy
  // block. A slot runs startTime..startTime+SESSION_DURATION; it conflicts when
  // it overlaps any busy interval (start < busyEnd && busyStart < end).
  const conflictingSlotStartTimes = useMemo(() => {
    const set = new Set<string>();
    const busy = busyData?.busy;
    if (!busy || busy.length === 0 || !slotsData?.slots) return set;
    const blocks = busy.map((b) => ({
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
    }));
    for (const slot of slotsData.slots) {
      const start = new Date(slot.startTime).getTime();
      const end = start + SESSION_DURATION_MINUTES * 60_000;
      if (blocks.some((b) => start < b.end && b.start < end)) {
        set.add(slot.startTime);
      }
    }
    return set;
  }, [busyData, slotsData]);

  const slotsForSelectedDate = selectedDate
    ? slotsByDate.get(format(selectedDate, "yyyy-MM-dd")) ?? []
    : [];
  const visibleSlotsForSelectedDate = showAllSlots
    ? slotsForSelectedDate
    : slotsForSelectedDate.slice(0, SLOT_DISPLAY_CAP);

  const selectedSlotConflicts = selectedSlot
    ? conflictingSlotStartTimes.has(selectedSlot.startTime)
    : false;

  const bookSession = useBookSessionPack();
  const rescheduleSession = useRescheduleSessionBooking();

  const handleSelectCoach = (coach: SessionCoach) => {
    setSelectedCoach(coach);
    setSelectedDate(null);
    setSelectedSlot(null);
    setStep(2);
  };

  const handleConfirm = async () => {
    if (!selectedCoach || !selectedSlot) return;
    try {
      if (isReschedule && rescheduleBookingId) {
        await rescheduleSession.mutateAsync({
          bookingId: rescheduleBookingId,
          startTime: selectedSlot.startTime,
        });
        toast({ title: "Session rescheduled" });
      } else {
        await bookSession.mutateAsync({
          coachId: selectedCoach.id,
          startTime: selectedSlot.startTime,
          discussionTopic: discussionTopic.trim() || undefined,
        });
        toast({ title: "Session booked!" });
      }
      navigate("/coaching/book-session");
    } catch (err) {
      toast({
        title: isReschedule ? "Could not reschedule" : "Could not book session",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const isMutating = bookSession.isPending || rescheduleSession.isPending;
  const stepLabels = isReschedule
    ? ["Select Time", "Confirm"]
    : ["Choose Coach", "Select Time", "Confirm"];

  // When in reschedule mode the visible steps are offset by one (no coach step).
  const visibleStep = isReschedule ? step - 1 : step;

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/coaching/book-session">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              {isReschedule ? "Reschedule Session" : "Book a Session"}
            </h1>
            <p className="text-muted-foreground">
              {isReschedule
                ? "Choose a new time for your coaching session."
                : "Schedule your Private Coaching session. Each session uses one credit."}
            </p>
          </div>
          {!isReschedule && (
            <div className="ml-auto flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2">
              <Ticket className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">
                {balance} credit{balance === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 mb-8">
          {stepLabels.map((label, idx) => {
            const stepNum = idx + 1;
            const isActive = visibleStep === stepNum;
            const isCompleted = visibleStep > stepNum;
            return (
              <div key={label} className="flex items-center gap-2">
                {idx > 0 && (
                  <div
                    className={cn(
                      "w-12 h-0.5",
                      isCompleted || isActive ? "bg-primary" : "bg-border",
                    )}
                  />
                )}
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors",
                      isCompleted
                        ? "bg-primary text-white"
                        : isActive
                          ? "bg-primary/10 text-primary border-2 border-primary"
                          : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {isCompleted ? <Check className="w-4 h-4" /> : stepNum}
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium hidden sm:inline",
                      isActive ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {step === 1 && !isReschedule && (
          <div>
            <h2 className="text-xl font-bold text-foreground mb-6">Choose Your Coach</h2>
            {coachesLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse h-48 bg-card rounded-xl" />
                ))}
              </div>
            ) : coaches && coaches.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {coaches.map((coach) => (
                  <Card
                    key={coach.id}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-md",
                      selectedCoach?.id === coach.id && "ring-2 ring-primary",
                    )}
                    onClick={() => handleSelectCoach(coach)}
                    data-testid={`coach-card-${coach.id}`}
                  >
                    <CardContent className="p-6">
                      <div className="flex flex-col items-center text-center">
                        {coach.photoUrl ? (
                          <img
                            src={resolveCoachPhotoUrl(coach.photoUrl) ?? undefined}
                            alt={coach.name}
                            className="w-20 h-20 rounded-full object-cover mb-4"
                          />
                        ) : (
                          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary mb-4">
                            {coachInitials(coach.name)}
                          </div>
                        )}
                        <h3 className="text-lg font-bold text-foreground mb-1">{coach.name}</h3>
                        <p className="text-sm text-muted-foreground">1-hour session</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <UserCheck className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">No Coaches Available</h3>
                  <p className="text-sm text-muted-foreground">
                    Please check back later or contact support.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {step === 2 && selectedCoach && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-foreground">
                Select Date &amp; Time with {selectedCoach.name}
              </h2>
              {!isReschedule && (
                <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Change Coach
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                      disabled={isSameDay(monthStart, startOfMonth(new Date()))}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <h3 className="font-bold text-foreground">{format(currentMonth, "MMMM yyyy")}</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                      <div
                        key={d}
                        className="text-center text-xs font-semibold text-muted-foreground py-2"
                      >
                        {d}
                      </div>
                    ))}
                  </div>

                  {slotsLoading && (
                    <div className="text-center py-4 text-sm text-muted-foreground">
                      Loading availability...
                    </div>
                  )}

                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: calendarStartDay }).map((_, i) => (
                      <div key={`pad-${i}`} />
                    ))}
                    {monthDays.map((day) => {
                      const dayStr = format(day, "yyyy-MM-dd");
                      const hasSlots = slotsByDate.has(dayStr);
                      const isSelected = selectedDate && isSameDay(day, selectedDate);
                      const isPastDay = isBefore(day, startOfDay(new Date()));
                      const isCurrentDay = isToday(day);

                      return (
                        <button
                          key={dayStr}
                          disabled={isPastDay || !hasSlots}
                          onClick={() => {
                            setSelectedDate(day);
                            setSelectedSlot(null);
                            setShowAllSlots(false);
                          }}
                          className={cn(
                            "h-10 rounded-lg text-sm font-medium transition-colors relative",
                            isSelected
                              ? "bg-primary text-white"
                              : hasSlots && !isPastDay
                                ? "hover:bg-primary/10 text-foreground"
                                : "text-muted-foreground/30 cursor-not-allowed",
                            isCurrentDay && !isSelected && "ring-1 ring-primary/30",
                          )}
                        >
                          {format(day, "d")}
                          {hasSlots && !isPastDay && !isSelected && (
                            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <div>
                {selectedDate ? (
                  <Card>
                    <CardContent className="p-6">
                      <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                        <Clock className="w-5 h-5 text-primary" />
                        Available Times for {format(selectedDate, "MMMM d")}
                      </h3>
                      <p className="text-xs text-muted-foreground mb-4">
                        Times shown in your local timezone ({getFriendlyTimezoneLabel(memberTimezone)})
                      </p>
                      {slotsForSelectedDate.length > 0 ? (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            {visibleSlotsForSelectedDate.map((slot) => {
                              const isSelected = selectedSlot?.startTime === slot.startTime;
                              const isConflict = conflictingSlotStartTimes.has(slot.startTime);
                              return (
                                <button
                                  key={slot.startTime}
                                  onClick={() => setSelectedSlot(slot)}
                                  data-testid={`slot-${slot.startTime}`}
                                  data-conflict={isConflict ? "true" : undefined}
                                  title={
                                    isConflict
                                      ? "The coach may be busy at this time"
                                      : undefined
                                  }
                                  className={cn(
                                    "px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border flex items-center justify-center gap-1.5",
                                    isSelected
                                      ? isConflict
                                        ? "bg-amber-500 text-white border-amber-500"
                                        : "bg-primary text-white border-primary"
                                      : isConflict
                                        ? "border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400"
                                        : "border-border hover:border-primary hover:bg-primary/5 text-foreground",
                                  )}
                                >
                                  {isConflict && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                                  {format(new Date(slot.startTime), "h:mm a")}
                                </button>
                              );
                            })}
                          </div>
                          {!showAllSlots && slotsForSelectedDate.length > SLOT_DISPLAY_CAP && (
                            <button
                              onClick={() => setShowAllSlots(true)}
                              data-testid="show-more-times"
                              className="w-full mt-3 text-sm font-medium text-primary hover:underline"
                            >
                              Show more times ({slotsForSelectedDate.length - SLOT_DISPLAY_CAP} more)
                            </button>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No available time slots for this date.
                        </p>
                      )}

                      {slotsForSelectedDate.some((s) =>
                        conflictingSlotStartTimes.has(s.startTime),
                      ) && (
                        <p className="mt-4 flex items-start gap-2 text-xs text-amber-700">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          Highlighted times overlap something on the coach&apos;s
                          calendar. You can still request them, but the coach may be
                          unavailable.
                        </p>
                      )}

                      {selectedSlot && (
                        <Button className="w-full mt-6" onClick={() => setStep(3)}>
                          Continue
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <Calendar className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                      <p className="text-sm text-muted-foreground">
                        Select a date on the calendar to see available time slots.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 3 && selectedCoach && selectedSlot && (
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-foreground">
                {isReschedule ? "Confirm Reschedule" : "Confirm Your Booking"}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Change Time
              </Button>
            </div>

            <Card className="mb-6">
              <CardContent className="p-6">
                <h3 className="font-bold text-foreground mb-4">Session Details</h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    {selectedCoach.photoUrl ? (
                      <img
                        src={resolveCoachPhotoUrl(selectedCoach.photoUrl) ?? undefined}
                        alt={selectedCoach.name}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">
                        {coachInitials(selectedCoach.name)}
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-foreground">{selectedCoach.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {SESSION_DURATION_MINUTES} minute Private Coaching session
                      </p>
                    </div>
                  </div>

                  <div className="bg-secondary/50 rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="w-4 h-4 text-primary" />
                      <span className="font-medium text-foreground">
                        {format(new Date(selectedSlot.startTime), "EEEE, MMMM d, yyyy")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-primary" />
                      <span className="font-medium text-foreground">
                        {format(new Date(selectedSlot.startTime), "h:mm a")} –{" "}
                        {format(
                          addMinutes(new Date(selectedSlot.startTime), SESSION_DURATION_MINUTES),
                          "h:mm a",
                        )}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{getFriendlyTimezoneLabel(memberTimezone)}</p>
                  </div>

                  {selectedSlotConflicts && (
                    <div
                      className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4"
                      data-testid="conflict-warning"
                    >
                      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-800">
                        This time overlaps something on {selectedCoach.name}&apos;s
                        calendar, so they may not be available. Consider picking a
                        different time, or continue if you&apos;ve already
                        coordinated with them.
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {!isReschedule && (
              <Card className="mb-6">
                <CardContent className="p-6">
                  <label
                    htmlFor="discussion-topic"
                    className="block font-bold text-foreground mb-3"
                  >
                    What would you like to discuss on this call?
                    <span className="text-destructive ml-1" aria-hidden="true">
                      *
                    </span>
                    <span className="sr-only">(required)</span>
                  </label>
                  <Textarea
                    id="discussion-topic"
                    value={discussionTopic}
                    onChange={(e) => setDiscussionTopic(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    required
                    aria-required="true"
                    placeholder="e.g. I want to review my ad creative and figure out why my CTR dropped."
                    data-testid="discussion-topic"
                  />
                </CardContent>
              </Card>
            )}

            <Card className="mb-6 border-amber-200 bg-amber-50/50">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-amber-900 text-sm mb-1">Cancellation Policy</h4>
                  <p className="text-xs text-amber-800">
                    Sessions can be cancelled or rescheduled up to 24 hours before the scheduled
                    time. Late cancellations or no-shows will count as a used credit.
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-4">
              <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={handleConfirm}
                disabled={isMutating || (!isReschedule && !discussionTopic.trim())}
                data-testid="confirm-booking"
              >
                {isMutating
                  ? "Processing..."
                  : isReschedule
                    ? "Confirm Reschedule"
                    : "Confirm Booking"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
