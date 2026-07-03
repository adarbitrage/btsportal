import { useState, useMemo } from "react";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { useAuth } from "@/lib/auth";
import { getMemberTimezone, formatMemberFullDateTime } from "@/lib/member-timezone";
import { useLocation, Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, Clock, Check, ChevronLeft, ChevronRight, Users, X } from "lucide-react";
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
import { PartnerRevealCard } from "@/components/onboarding/PartnerRevealCard";
import {
  usePartnerInfo,
  usePartnerAvailability,
  useMyPartnerBookings,
  useBookPartnerCall,
  useReschedulePartnerCall,
  useCancelPartnerCall,
} from "@/lib/call-bookings-api";
import { getOnboardingRouteForStep } from "@/components/onboarding/OnboardingLayout";

const THIS_STEP = 4;

export default function OnboardingBookPartnerCall() {
  const { refreshAuth, user } = useAuth();
  const memberTimezoneShared = getMemberTimezone(user?.timezone);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const memberTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const inOnboarding = !user?.onboardingComplete;

  const [showBookingFlow, setShowBookingFlow] = useState(false);
  const [reschedulingBookingId, setReschedulingBookingId] = useState<number | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ startTime: string } | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const { data: partnerInfo, isLoading: partnerLoading } = usePartnerInfo();
  const partner = partnerInfo?.partner ?? null;

  const { data: myBookings, isLoading: bookingsLoading } = useMyPartnerBookings();
  const bookings = useMemo(
    () => (myBookings?.bookings ?? []).slice().sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    [myBookings],
  );
  const upcoming = bookings.filter((b) => b.status === "booked");
  const past = bookings.filter((b) => b.status !== "booked");

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const calendarStartDay = getDay(monthStart);
  const startDate = format(monthStart, "yyyy-MM-dd");
  const endDate = format(monthEnd, "yyyy-MM-dd");

  const { data: availability, isLoading: slotsLoading } = usePartnerAvailability(startDate, endDate);

  const slotsByDate = useMemo(() => {
    const map = new Map<string, { startTime: string }[]>();
    if (!availability?.slots) return map;
    for (const slot of availability.slots) {
      const key = format(new Date(slot.startTime), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(slot);
    }
    return map;
  }, [availability]);

  const slotsForSelectedDate = selectedDate ? slotsByDate.get(format(selectedDate, "yyyy-MM-dd")) ?? [] : [];

  const bookCall = useBookPartnerCall();
  const rescheduleCall = useReschedulePartnerCall();
  const cancelCall = useCancelPartnerCall();
  const isReschedule = reschedulingBookingId !== null;

  // Forward-navigate whenever the server says the member is already past this
  // page's step — mirrors BookKickoff's advanceIfAhead (see its comment for
  // why this must read the refreshAuth() return value, not the stale `user`
  // closure).
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

  const resetBookingFlow = () => {
    setShowBookingFlow(false);
    setReschedulingBookingId(null);
    setSelectedDate(null);
    setSelectedSlot(null);
  };

  const handleConfirm = async () => {
    if (!selectedSlot) return;
    try {
      if (reschedulingBookingId !== null) {
        await rescheduleCall.mutateAsync({ bookingId: reschedulingBookingId, startTime: selectedSlot.startTime });
        toast({ title: "Partner call rescheduled!" });
      } else {
        await bookCall.mutateAsync({ startTime: selectedSlot.startTime });
        toast({ title: "Partner call booked!" });
      }
      resetBookingFlow();
      await advanceIfAhead();
    } catch (err) {
      toast({
        title: reschedulingBookingId !== null ? "Could not reschedule call" : "Could not book call",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleStartReschedule = (bookingId: number) => {
    setReschedulingBookingId(bookingId);
    setShowBookingFlow(true);
    setSelectedDate(null);
    setSelectedSlot(null);
  };

  const handleCancel = async (bookingId: number) => {
    try {
      await cancelCall.mutateAsync({ bookingId });
      toast({ title: "Call canceled" });
    } catch (err) {
      toast({
        title: "Could not cancel call",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    inOnboarding ? (
      <OnboardingLayout stepName="partner_call_booked" onBack={() => navigate("/onboarding/book-kickoff")}>
        {children}
      </OnboardingLayout>
    ) : (
      <>{children}</>
    );

  // LaunchPad members have no partner-call step at all (see onboarding-steps.ts) —
  // this route should never be reachable for them. Defensively bounce them to
  // wherever their variant's step array actually puts them.
  if (inOnboarding && user?.onboardingVariant === "launchpad") {
    return <Redirect to={getOnboardingRouteForStep(user.onboardingStep || 1, user.onboardingVariant)} />;
  }

  if (partnerLoading || bookingsLoading) {
    return (
      <Wrapper>
        <div className="animate-pulse h-64 bg-card rounded-xl" />
      </Wrapper>
    );
  }

  if (!partner) {
    return (
      <Wrapper>
        <div className="space-y-6 max-w-lg mx-auto text-center">
          <div className="w-14 h-14 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
            <Users className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-foreground">Accountability Partner Coming Soon</h2>
          <p className="text-sm text-muted-foreground">
            You don't have an accountability partner assigned yet. Check back shortly.
          </p>
          <Button variant="outline" onClick={handleCheckStatus} disabled={advancing}>
            {advancing ? "Checking..." : "Check again"}
          </Button>
        </div>
      </Wrapper>
    );
  }

  const bookingFlow = (
    <div className="space-y-6">
      {isReschedule && (
        <div className="max-w-xl mx-auto flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm">
          <span className="text-foreground font-medium">Rescheduling your call — pick a new time below.</span>
          <Button variant="ghost" size="sm" onClick={resetBookingFlow}>
            Cancel
          </Button>
        </div>
      )}
      {partner && (
        <PartnerRevealCard
          partner={partner}
          subtitle={
            availability?.durationMinutes
              ? `Free ${availability.durationMinutes}-minute accountability call`
              : "Free accountability call"
          }
        />
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
                  Times shown in your local timezone ({memberTimezone})
                </p>
                {slotsForSelectedDate.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {slotsForSelectedDate.map((slot) => {
                      const isSelected = selectedSlot?.startTime === slot.startTime;
                      return (
                        <button
                          key={slot.startTime}
                          onClick={() => setSelectedSlot(slot)}
                          data-testid={`partner-slot-${slot.startTime}`}
                          className={cn(
                            "px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border",
                            isSelected
                              ? "bg-primary text-white border-primary"
                              : "border-border hover:border-primary hover:bg-primary/5 text-foreground",
                          )}
                        >
                          {format(new Date(slot.startTime), "h:mm a")}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No available time slots for this date.
                  </p>
                )}

                {selectedSlot && (
                  <Button
                    className="w-full mt-6"
                    onClick={handleConfirm}
                    disabled={bookCall.isPending || rescheduleCall.isPending}
                    data-testid="confirm-partner-booking"
                  >
                    {bookCall.isPending || rescheduleCall.isPending ? (
                      isReschedule ? (
                        "Rescheduling..."
                      ) : (
                        "Booking..."
                      )
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        {isReschedule ? "Confirm New Time" : "Confirm Partner Call"}
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
  );

  // During onboarding, before the member has ever booked, go straight to the
  // booking flow (mirrors BookKickoff's single-step experience).
  if (inOnboarding && bookings.length === 0) {
    return <Wrapper>{bookingFlow}</Wrapper>;
  }

  // Ongoing view: list existing bookings + a "book another call" toggle.
  return (
    <Wrapper>
      <div className="space-y-6">
        <div className="text-center mb-2">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {inOnboarding ? "Your First Partner Call Is Booked!" : "Accountability Partner Calls"}
          </h2>
          <p className="text-muted-foreground">
            {inOnboarding
              ? "You're all set — this should move you to the next step automatically."
              : `Manage your calls with ${partner.displayName}.`}
          </p>
        </div>

        {inOnboarding && (
          <div className="flex justify-center">
            <Button onClick={handleCheckStatus} disabled={advancing}>
              {advancing ? "Checking..." : "Continue"}
            </Button>
          </div>
        )}

        {upcoming.length > 0 && (
          <div className="max-w-xl mx-auto space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Upcoming Calls</h3>
            {upcoming.map((b) => (
              <Card key={b.id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-foreground">
                      {formatMemberFullDateTime(b.scheduledAt, memberTimezoneShared)}
                    </p>
                    <p className="text-xs text-muted-foreground">{b.durationMinutes} minutes</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStartReschedule(b.id)}
                      disabled={cancelCall.isPending}
                      data-testid={`reschedule-partner-call-${b.id}`}
                    >
                      <Clock className="w-4 h-4 mr-1" />
                      Reschedule
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancel(b.id)}
                      disabled={cancelCall.isPending}
                      data-testid={`cancel-partner-call-${b.id}`}
                    >
                      <X className="w-4 h-4 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {past.length > 0 && (
          <div className="max-w-xl mx-auto space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Past Calls</h3>
            {past.map((b) => (
              <Card key={b.id} className="opacity-70">
                <CardContent className="p-4">
                  <p className="font-semibold text-foreground">
                    {formatMemberFullDateTime(b.scheduledAt, memberTimezoneShared)}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize">{b.status}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!showBookingFlow ? (
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={() => {
                setReschedulingBookingId(null);
                setShowBookingFlow(true);
              }}
            >
              Book Another Call
            </Button>
          </div>
        ) : (
          bookingFlow
        )}
      </div>
    </Wrapper>
  );
}
