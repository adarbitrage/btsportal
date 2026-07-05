import { useState, useMemo } from "react";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, Clock, Check, ChevronLeft, ChevronRight, PartyPopper, Hourglass } from "lucide-react";
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
} from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { resolveCoachPhotoUrl } from "@/lib/coaches-admin-api";
import { useKickoffAvailability, useMyKickoffBooking, useBookKickoffCall } from "@/lib/call-bookings-api";
import { getOnboardingRouteForStep } from "@/components/onboarding/OnboardingLayout";
import { getMemberTimezone, formatMemberFullDateTime, getFriendlyTimezoneLabel } from "@/lib/member-timezone";

const SLOT_DISPLAY_CAP = 8;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const THIS_STEP = 3;

export default function OnboardingBookKickoff() {
  const { refreshAuth, user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const memberTimezone = getMemberTimezone(user?.timezone);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showAllSlots, setShowAllSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ startTime: string; coachId: number; durationMinutes: number } | null>(
    null,
  );
  const [advancing, setAdvancing] = useState(false);

  const { data: mine, isLoading: mineLoading } = useMyKickoffBooking();
  const existingBooking = mine?.booking ?? null;

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const calendarStartDay = getDay(monthStart);
  const startDate = format(monthStart, "yyyy-MM-dd");
  const endDate = format(monthEnd, "yyyy-MM-dd");

  const {
    data: availability,
    isLoading: slotsLoading,
    refetch: refetchAvailability,
  } = useKickoffAvailability(startDate, endDate);

  // Task #1654: the grid is a MERGED pool across every coach in the tier —
  // there's no single "the coach" until the member picks a slot. Coach
  // photo/bio only reveal once a specific slot (and therefore a specific
  // coach) is selected.
  const coachesById = useMemo(() => {
    const map = new Map<number, { id: number; displayName: string; photoUrl: string | null; bio: string | null }>();
    for (const c of availability?.coaches ?? []) map.set(c.id, c);
    return map;
  }, [availability]);
  const selectedCoach = selectedSlot ? coachesById.get(selectedSlot.coachId) ?? null : null;

  const slotsByDate = useMemo(() => {
    const map = new Map<string, { startTime: string; coachId: number; durationMinutes: number }[]>();
    if (!availability?.slots) return map;
    for (const slot of availability.slots) {
      const key = format(new Date(slot.startTime), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(slot);
    }
    return map;
  }, [availability]);

  const slotsForSelectedDate = selectedDate ? slotsByDate.get(format(selectedDate, "yyyy-MM-dd")) ?? [] : [];
  const visibleSlotsForSelectedDate = showAllSlots
    ? slotsForSelectedDate
    : slotsForSelectedDate.slice(0, SLOT_DISPLAY_CAP);

  const bookCall = useBookKickoffCall();

  // Forward-navigate whenever the server says the member is already past this
  // page's step (booking flows advance onboardingStep server-side, so a stale
  // "Continue" click here should never be a dead end — for the member OR for
  // an admin impersonating them). Never navigate BACKWARD from here; a member
  // could still be sitting exactly on this step (booking failed / retried).
  const advanceIfAhead = async () => {
    const freshUser = await refreshAuth();
    if (freshUser && freshUser.onboardingStep > THIS_STEP) {
      navigate(getOnboardingRouteForStep(freshUser.onboardingStep, freshUser.onboardingVariant));
    }
  };

  const handleCheckStatus = async () => {
    setAdvancing(true);
    try {
      await advanceIfAhead();
    } finally {
      setAdvancing(false);
    }
  };

  // Setup-pending is polled explicitly, not auto-refreshed, so re-fetch
  // availability (not just onboarding step) when the member asks to check
  // again — a coach's calendar can go live without any step-advance event.
  const handleCheckAvailabilityAgain = async () => {
    setAdvancing(true);
    try {
      await refetchAvailability();
    } finally {
      setAdvancing(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedSlot) return;
    try {
      const result = await bookCall.mutateAsync({
        startTime: selectedSlot.startTime,
        coachId: selectedSlot.coachId,
      });
      if (result.setupPending) {
        toast({
          title: "Kickoff booking isn't set up yet",
          description: "Your coach's calendar is still being configured. Please check back shortly.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Kickoff call booked!" });
      await advanceIfAhead();
    } catch (err) {
      toast({
        title: "Could not book call",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (mineLoading) {
    return (
      <OnboardingLayout stepName="kickoff_booked" onBack={() => navigate("/onboarding/profile")}>
        <div className="animate-pulse h-64 bg-card rounded-xl" />
      </OnboardingLayout>
    );
  }

  if (existingBooking && existingBooking.status !== "canceled") {
    return (
      <OnboardingLayout stepName="kickoff_booked" onBack={() => navigate("/onboarding/profile")}>
        <div className="space-y-6 max-w-lg mx-auto text-center">
          <div className="w-14 h-14 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
            <PartyPopper className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-foreground">Your Kickoff Call Is Booked!</h2>
          <Card>
            <CardContent className="p-6 space-y-2">
              <p className="font-semibold text-foreground">
                {formatMemberFullDateTime(existingBooking.scheduledAt, memberTimezone)}
              </p>
              <p className="text-sm text-muted-foreground">
                {existingBooking.durationMinutes} minutes
                {existingBooking.meetingUrl ? " · Google Meet link will be in your email" : ""}
              </p>
            </CardContent>
          </Card>
          <p className="text-sm text-muted-foreground">
            You're all set — this should move you to the next step automatically.
          </p>
          <Button onClick={handleCheckStatus} disabled={advancing}>
            {advancing ? "Checking..." : "Continue"}
          </Button>
        </div>
      </OnboardingLayout>
    );
  }

  if (availability?.setupPending) {
    // Task #1641: loud, explicit "still being set up" state — e.g. a
    // LaunchPad member before Neil's dedicated calendar is configured. Never
    // shown as a silently empty calendar and never falls back to another
    // tier's coaches.
    return (
      <OnboardingLayout stepName="kickoff_booked" onBack={() => navigate("/onboarding/profile")}>
        <div className="space-y-6 max-w-lg mx-auto text-center">
          <div className="w-14 h-14 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
            <Hourglass className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-foreground">Kickoff Booking Is Almost Ready</h2>
          <p className="text-sm text-muted-foreground">
            We're finishing setup for your coach's calendar. Please check back shortly to book your kickoff call.
          </p>
          <Button onClick={handleCheckAvailabilityAgain} disabled={advancing}>
            {advancing ? "Checking..." : "Check Again"}
          </Button>
        </div>
      </OnboardingLayout>
    );
  }

  return (
    <OnboardingLayout stepName="kickoff_booked" onBack={() => navigate("/onboarding/profile")}>
      <div className="space-y-6">
        <div className="text-center mb-2">
          <h2 className="text-2xl font-bold text-foreground mb-2">Book Your Kickoff Call</h2>
          <p className="text-muted-foreground">
            The next step is scheduling a quick kickoff call with your coach to map out your plan.
          </p>
        </div>

        {selectedCoach && selectedSlot && (
          <div className="flex items-center justify-center gap-3">
            {selectedCoach.photoUrl ? (
              <img
                src={resolveCoachPhotoUrl(selectedCoach.photoUrl) ?? undefined}
                alt={selectedCoach.displayName}
                className="w-12 h-12 rounded-full object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                {initials(selectedCoach.displayName)}
              </div>
            )}
            <div className="text-left">
              <p className="font-semibold text-foreground">{selectedCoach.displayName}</p>
              <p className="text-xs text-muted-foreground">
                {`Free ${selectedSlot.durationMinutes}-minute kickoff call`}
              </p>
            </div>
          </div>
        )}

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
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">
                    {d}
                  </div>
                ))}
              </div>

              {slotsLoading && (
                <div className="text-center py-4 text-sm text-muted-foreground">Loading availability...</div>
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
                          const isSelected =
                            selectedSlot?.startTime === slot.startTime && selectedSlot?.coachId === slot.coachId;
                          const slotCoach = coachesById.get(slot.coachId);
                          return (
                            <button
                              key={`${slot.coachId}-${slot.startTime}`}
                              onClick={() => setSelectedSlot(slot)}
                              data-testid={`kickoff-slot-${slot.startTime}`}
                              className={cn(
                                "px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border flex flex-col items-center",
                                isSelected
                                  ? "bg-primary text-white border-primary"
                                  : "border-border hover:border-primary hover:bg-primary/5 text-foreground",
                              )}
                            >
                              <span>{format(new Date(slot.startTime), "h:mm a")}</span>
                              {slotCoach && (
                                <span
                                  className={cn(
                                    "text-[10px] font-normal",
                                    isSelected ? "text-white/80" : "text-muted-foreground",
                                  )}
                                >
                                  {slotCoach.displayName}
                                </span>
                              )}
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

                  {selectedSlot && (
                    <Button
                      className="w-full mt-6"
                      onClick={handleConfirm}
                      disabled={bookCall.isPending}
                      data-testid="confirm-kickoff-booking"
                    >
                      {bookCall.isPending ? (
                        "Booking..."
                      ) : (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          Confirm Kickoff Call
                        </>
                      )}
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
    </OnboardingLayout>
  );
}
