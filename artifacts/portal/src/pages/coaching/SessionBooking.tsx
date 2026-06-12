import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Calendar,
  Clock,
  Video,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Ticket,
  Sparkles,
  Loader2,
} from "lucide-react";
import { format, addDays, startOfDay } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  useSessionBalance,
  useSessionCoaches,
  useSessionCoachSlots,
  useBookSessionPack,
  useMySessionBookings,
  useCancelSessionBooking,
  type SessionCoach,
  type SessionSlot,
  type SessionBooking,
} from "@/lib/session-packs-api";

const DATE_WINDOW_DAYS = 14;

const PACKAGE_PLACEHOLDERS = [
  { name: "Single Session", sessions: "1 session", blurb: "A focused 1-on-1 to unblock a specific challenge." },
  { name: "Starter Pack", sessions: "5 sessions", blurb: "Build momentum with regular coaching touchpoints." },
  { name: "Pro Pack", sessions: "10 sessions", blurb: "Go all-in with ongoing accountability and strategy." },
];

function coachInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function groupSlotsByDay(slots: SessionSlot[]): { date: string; label: string; slots: SessionSlot[] }[] {
  const map = new Map<string, SessionSlot[]>();
  for (const slot of slots) {
    const d = new Date(slot.startTime);
    const key = format(d, "yyyy-MM-dd");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(slot);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, daySlots]) => ({
      date,
      label: format(new Date(`${date}T12:00:00`), "EEE, MMM d"),
      slots: daySlots,
    }));
}

export default function SessionBooking() {
  const { toast } = useToast();
  const { data: balanceData, isLoading: balanceLoading } = useSessionBalance();
  const { data: coaches, isLoading: coachesLoading } = useSessionCoaches();
  const { data: bookings } = useMySessionBookings();

  const balance = balanceData?.balance ?? 0;
  const hasCredits = balance > 0;

  const [selectedCoach, setSelectedCoach] = useState<SessionCoach | null>(null);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);

  const today = useMemo(() => startOfDay(new Date()), []);
  const startDate = format(today, "yyyy-MM-dd");
  const endDate = format(addDays(today, DATE_WINDOW_DAYS), "yyyy-MM-dd");

  const { data: slotData, isLoading: slotsLoading } = useSessionCoachSlots(
    selectedCoach?.id ?? 0,
    startDate,
    endDate,
  );

  const bookMutation = useBookSessionPack();
  const cancelMutation = useCancelSessionBooking();

  const now = Date.now();
  const upcoming = (bookings ?? [])
    .filter((b) => b.status === "booked" && new Date(b.scheduledAt).getTime() >= now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const past = (bookings ?? [])
    .filter((b) => b.status !== "booked" || new Date(b.scheduledAt).getTime() < now)
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  const groupedSlots = useMemo(
    () => (slotData?.slots ? groupSlotsByDay(slotData.slots) : []),
    [slotData],
  );

  async function handleBook(startTime: string) {
    if (!selectedCoach) return;
    setPendingSlot(startTime);
    try {
      const result = await bookMutation.mutateAsync({ coachId: selectedCoach.id, startTime });
      toast({
        title: "Session booked!",
        description: `${selectedCoach.name} · ${format(new Date(result.booking.scheduledAt), "EEE, MMM d 'at' h:mm a")}. ${result.balance} credit${result.balance === 1 ? "" : "s"} left.`,
      });
      setSelectedCoach(null);
    } catch (err) {
      toast({
        title: "Could not book session",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPendingSlot(null);
    }
  }

  async function handleCancel(booking: SessionBooking) {
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

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        {/* Header + balance */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">1-on-1 Sessions</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Book private coaching sessions with our team. Each session uses one credit.
            </p>
          </div>
          <Card className="shrink-0">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Ticket className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Session credits</p>
                <p className="text-xl font-bold" data-testid="credit-balance">
                  {balanceLoading ? "—" : balance}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {hasCredits ? (
          <>
            {/* Coach picker */}
            {!selectedCoach ? (
              <section className="space-y-4">
                <h2 className="text-lg font-semibold">Choose a coach</h2>
                {coachesLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading coaches…
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(coaches ?? []).map((coach) => (
                      <Card
                        key={coach.id}
                        className="cursor-pointer transition-shadow hover:shadow-md"
                        onClick={() => setSelectedCoach(coach)}
                        data-testid={`coach-card-${coach.id}`}
                      >
                        <CardContent className="flex items-center gap-4 p-5">
                          <Avatar className="h-14 w-14">
                            {coach.photoUrl ? <AvatarImage src={coach.photoUrl} alt={coach.name} /> : null}
                            <AvatarFallback>{coachInitials(coach.name)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold">{coach.name}</p>
                            {coach.bio ? (
                              <p className="line-clamp-2 text-sm text-muted-foreground">{coach.bio}</p>
                            ) : (
                              <p className="text-sm text-muted-foreground">30-minute 1-on-1 session</p>
                            )}
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              /* Availability */
              <section className="space-y-4">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedCoach(null)}>
                    <ChevronLeft className="mr-1 h-4 w-4" /> Coaches
                  </Button>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      {selectedCoach.photoUrl ? (
                        <AvatarImage src={selectedCoach.photoUrl} alt={selectedCoach.name} />
                      ) : null}
                      <AvatarFallback>{coachInitials(selectedCoach.name)}</AvatarFallback>
                    </Avatar>
                    <h2 className="text-lg font-semibold">Book with {selectedCoach.name}</h2>
                  </div>
                </div>

                {slotsLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading availability…
                  </div>
                ) : groupedSlots.length === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                      No open slots in the next {DATE_WINDOW_DAYS} days. Check back soon.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-5">
                    {groupedSlots.map((day) => (
                      <div key={day.date}>
                        <p className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                          <Calendar className="h-4 w-4" /> {day.label}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {day.slots.map((slot) => {
                            const isPending = pendingSlot === slot.startTime;
                            return (
                              <Button
                                key={slot.startTime}
                                variant="outline"
                                size="sm"
                                disabled={bookMutation.isPending}
                                onClick={() => handleBook(slot.startTime)}
                                data-testid={`slot-${slot.startTime}`}
                              >
                                {isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  format(new Date(slot.startTime), "h:mm a")
                                )}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        ) : (
          /* No credits → package placeholders */
          <section className="space-y-4">
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <Sparkles className="h-8 w-8 text-primary" />
                <p className="text-lg font-semibold">You don't have any session credits yet</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Session packages are coming soon. In the meantime, reach out to the team if you'd
                  like access to 1-on-1 coaching.
                </p>
              </CardContent>
            </Card>
            <div className="grid gap-4 sm:grid-cols-3">
              {PACKAGE_PLACEHOLDERS.map((pkg) => (
                <Card key={pkg.name} className="opacity-80">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{pkg.name}</p>
                      <Badge variant="secondary">Coming soon</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{pkg.sessions}</p>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{pkg.blurb}</p>
                    <Button className="mt-4 w-full" disabled>
                      Coming soon
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Upcoming sessions</h2>
            <div className="space-y-3">
              {upcoming.map((booking) => (
                <Card key={booking.id} data-testid={`upcoming-${booking.id}`}>
                  <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-10 w-10">
                        {booking.coachPhotoUrl ? (
                          <AvatarImage src={booking.coachPhotoUrl} alt={booking.coachName} />
                        ) : null}
                        <AvatarFallback>{coachInitials(booking.coachName)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{booking.coachName}</p>
                        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          {format(new Date(booking.scheduledAt), "EEE, MMM d 'at' h:mm a")} ·{" "}
                          {booking.durationMinutes} min
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {booking.meetLink && (
                        <Button asChild size="sm">
                          <a href={booking.meetLink} target="_blank" rel="noopener noreferrer">
                            <Video className="mr-1.5 h-4 w-4" /> Join
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={cancelMutation.isPending}
                        onClick={() => handleCancel(booking)}
                        data-testid={`cancel-${booking.id}`}
                      >
                        Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Past */}
        {past.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Past & cancelled</h2>
            <div className="space-y-2">
              {past.map((booking) => (
                <Card key={booking.id} className="bg-muted/30">
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3">
                      {booking.status === "cancelled" ? (
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div>
                        <p className="text-sm font-medium">{booking.coachName}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(booking.scheduledAt), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                      </div>
                    </div>
                    <Badge variant={booking.status === "cancelled" ? "outline" : "secondary"}>
                      {booking.status}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
}
