import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  ArrowRight,
  Star,
  Calendar,
  Clock,
  Check,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  UserCheck,
  Zap,
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
  addDays,
  setHours,
  setMinutes,
} from "date-fns";
import { Link, useLocation, useSearch } from "wouter";
import {
  useOneOnOneCoaches,
  useCoachSlots,
  useBookSession,
  useRescheduleSession,
  type OneOnOneCoach,
  type CoachAvailabilitySlot,
  type TimeSlot,
} from "@/lib/coaching-api";
import { cn } from "@/lib/utils";

type WizardStep = 1 | 2 | 3;

function getNextAvailableSlot(availability: CoachAvailabilitySlot[]): Date | null {
  if (!availability || availability.length === 0) return null;
  const now = new Date();
  const today = now.getDay();

  const sorted = [...availability].sort((a, b) => {
    const aDist = ((a.dayOfWeek - today) + 7) % 7;
    const bDist = ((b.dayOfWeek - today) + 7) % 7;
    if (aDist !== bDist) return aDist - bDist;
    return a.startTime.localeCompare(b.startTime);
  });

  for (const slot of sorted) {
    const dayDiff = ((slot.dayOfWeek - today) + 7) % 7;
    const targetDate = addDays(startOfDay(now), dayDiff);
    const [hours, mins] = slot.startTime.split(":").map(Number);
    const slotDate = setMinutes(setHours(targetDate, hours), mins);
    if (slotDate > now) return slotDate;
  }

  for (const slot of sorted) {
    const dayDiff = ((slot.dayOfWeek - today) + 7) % 7 || 7;
    const targetDate = addDays(startOfDay(now), dayDiff);
    const [hours, mins] = slot.startTime.split(":").map(Number);
    return setMinutes(setHours(targetDate, hours), mins);
  }

  return null;
}

export default function BookCoaching() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const rescheduleSessionId = searchParams.get("reschedule");
  const isReschedule = !!rescheduleSessionId;

  const [step, setStep] = useState<WizardStep>(1);
  const [selectedCoach, setSelectedCoach] = useState<OneOnOneCoach | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [preSessionNotes, setPreSessionNotes] = useState("");

  const memberTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const { data: coaches, isLoading: coachesLoading, error: coachesError } = useOneOnOneCoaches();

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const calendarStartDay = getDay(monthStart);

  const startDate = format(monthStart, "yyyy-MM-dd");
  const endDate = format(monthEnd, "yyyy-MM-dd");
  const { data: slotsData, isLoading: slotsLoading } = useCoachSlots(
    selectedCoach?.id ?? 0,
    startDate,
    endDate,
    memberTimezone
  );

  const slotsByDate = useMemo(() => {
    const map = new Map<string, TimeSlot[]>();
    if (!slotsData?.slots) return map;
    for (const slot of slotsData.slots) {
      const dateKey = format(new Date(slot.startTime), "yyyy-MM-dd");
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(slot);
    }
    return map;
  }, [slotsData]);

  const slotsForSelectedDate = selectedDate
    ? slotsByDate.get(format(selectedDate, "yyyy-MM-dd")) ?? []
    : [];

  const bookSession = useBookSession();
  const rescheduleSession = useRescheduleSession();

  const handleSelectCoach = (coach: OneOnOneCoach) => {
    setSelectedCoach(coach);
    setSelectedDate(null);
    setSelectedSlot(null);
    setStep(2);
  };

  const handleSelectSlot = (slot: TimeSlot) => {
    setSelectedSlot(slot);
  };

  const handleConfirmBooking = async () => {
    if (!selectedCoach || !selectedSlot) return;
    try {
      if (isReschedule && rescheduleSessionId) {
        await rescheduleSession.mutateAsync({
          sessionId: parseInt(rescheduleSessionId, 10),
          newStartTime: selectedSlot.startTime,
          coachId: selectedCoach.id,
        });
      } else {
        await bookSession.mutateAsync({
          coachId: selectedCoach.id,
          startTime: selectedSlot.startTime,
          memberNotes: preSessionNotes.trim() || undefined,
        });
      }
      navigate("/coaching/one-on-one");
    } catch {
    }
  };

  const isMutating = bookSession.isPending || rescheduleSession.isPending;
  const mutationError = bookSession.isError || rescheduleSession.isError;

  const stepLabels = ["Choose Coach", "Select Time", "Confirm"];

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/coaching/one-on-one">
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
                : "Schedule your 1-on-1 coaching session."}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 mb-8">
          {stepLabels.map((label, idx) => {
            const stepNum = (idx + 1) as WizardStep;
            const isActive = step === stepNum;
            const isCompleted = step > stepNum;
            return (
              <div key={label} className="flex items-center gap-2">
                {idx > 0 && (
                  <div
                    className={cn(
                      "w-12 h-0.5",
                      isCompleted || isActive ? "bg-primary" : "bg-border"
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
                        : "bg-secondary text-muted-foreground"
                    )}
                  >
                    {isCompleted ? <Check className="w-4 h-4" /> : stepNum}
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium hidden sm:inline",
                      isActive ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold text-foreground mb-6">Choose Your Coach</h2>
            {coachesLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse h-64 bg-card rounded-xl" />
                ))}
              </div>
            ) : coachesError ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <AlertTriangle className="w-12 h-12 text-destructive/50 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">Failed to load coaches</h3>
                  <p className="text-sm text-muted-foreground">
                    Please try refreshing the page. If the problem persists, contact support.
                  </p>
                </CardContent>
              </Card>
            ) : coaches && coaches.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {coaches.map((coach) => {
                  const nextSlot = getNextAvailableSlot(coach.availability);
                  return (
                    <Card
                      key={coach.id}
                      className={cn(
                        "cursor-pointer transition-all hover:shadow-md",
                        selectedCoach?.id === coach.id && "ring-2 ring-primary"
                      )}
                      onClick={() => handleSelectCoach(coach)}
                    >
                      <CardContent className="p-6">
                        <div className="flex flex-col items-center text-center">
                          {coach.photoUrl ? (
                            <img
                              src={coach.photoUrl}
                              alt={coach.name}
                              className="w-20 h-20 rounded-full object-cover mb-4"
                            />
                          ) : (
                            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary mb-4">
                              {coach.name.split(" ").map((n) => n[0]).join("")}
                            </div>
                          )}
                          <h3 className="text-lg font-bold text-foreground mb-1">{coach.name}</h3>
                          <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase mt-1 mb-3">
                            {coach.specialties}
                          </p>
                          <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
                            {coach.averageRating !== null && (
                              <span className="flex items-center gap-1">
                                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                                {coach.averageRating.toFixed(1)}
                              </span>
                            )}
                            {coach.totalRatings > 0 && (
                              <span>{coach.totalRatings} review{coach.totalRatings !== 1 ? "s" : ""}</span>
                            )}
                          </div>
                          {nextSlot && (
                            <div className="flex items-center gap-1.5 text-xs text-primary font-medium mt-1">
                              <Zap className="w-3.5 h-3.5" />
                              Next available: {format(nextSlot, "EEE, MMM d 'at' h:mm a")}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
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
                Select Date & Time with {selectedCoach.name}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Change Coach
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <h3 className="font-bold text-foreground">
                      {format(currentMonth, "MMMM yyyy")}
                    </h3>
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
                            isCurrentDay && !isSelected && "ring-1 ring-primary/30"
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
                          {slotsForSelectedDate.map((slot, idx) => {
                            const isSelected = selectedSlot?.startTime === slot.startTime;
                            return (
                              <button
                                key={idx}
                                onClick={() => handleSelectSlot(slot)}
                                className={cn(
                                  "px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border",
                                  isSelected
                                    ? "bg-primary text-white border-primary"
                                    : "border-border hover:border-primary hover:bg-primary/5 text-foreground"
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
                          onClick={() => setStep(3)}
                        >
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
                        src={selectedCoach.photoUrl}
                        alt={selectedCoach.name}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">
                        {selectedCoach.name.split(" ").map((n) => n[0]).join("")}
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-foreground">{selectedCoach.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {selectedCoach.specialties}
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
                        {format(new Date(selectedSlot.endTime), "h:mm a")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {memberTimezone}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {!isReschedule && (
              <Card className="mb-6">
                <CardContent className="p-6">
                  <h3 className="font-bold text-foreground mb-2">Pre-Session Notes</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Share what you'd like to discuss so your coach can prepare.
                  </p>
                  <Textarea
                    value={preSessionNotes}
                    onChange={(e) => setPreSessionNotes(e.target.value)}
                    placeholder="What topics, challenges, or goals would you like to cover in this session?"
                    rows={4}
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
                    Sessions can be cancelled or rescheduled up to 24 hours before the scheduled time.
                    Late cancellations or no-shows will count as a used session.
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setStep(2)}
              >
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={handleConfirmBooking}
                disabled={isMutating}
              >
                {isMutating
                  ? isReschedule ? "Rescheduling..." : "Booking..."
                  : isReschedule ? "Confirm Reschedule" : "Confirm Booking"}
              </Button>
            </div>

            {mutationError && (
              <p className="text-sm text-destructive text-center mt-4">
                {isReschedule
                  ? "Failed to reschedule session. Please try again."
                  : "Failed to book session. Please try again."}
              </p>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
