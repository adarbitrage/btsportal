import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Video, Lock, Check, Users } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCoachingCalls,
  useListCoaches,
  useRegisterForCoachingCall,
  useCancelCoachingCallRegistration,
  type CoachingCall,
} from "@workspace/api-client-react";
import { resolveCoachPhotoUrl } from "@/lib/coaches-admin-api";

type AvatarTint = {
  bg: string;
  border: string;
  text: string;
};

// Tints are assigned per-coach by position so the grid stays visually varied
// no matter which coaches the backend returns. Order matches the original
// hand-picked palette and cycles for any additional coaches.
const avatarTints: AvatarTint[] = [
  { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
  { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700" },
  { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-700" },
  { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" },
  { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700" },
  { bg: "bg-cyan-50", border: "border-cyan-200", text: "text-cyan-700" },
];

// Derive up to two uppercase initials from a coach's name (e.g. "Sarah
// Mitchell" -> "SM", "Sasha" -> "SA"), so initials track the real roster.
function coachInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Renders the per-call action shared by the "Upcoming Calls" list and the
// recurring weekly schedule. Both sections gate identically off the call's
// `isAccessible` flag and deep-link locked calls to the call's own
// `upgradeUrl` — never a single shared Meet link or upgrade URL.
function CallAction({
  call,
  onUnlock,
}: {
  call: CoachingCall;
  onUnlock: (url: string) => void;
}) {
  if (call.isAccessible) {
    if (call.meetLink) {
      return (
        <Button asChild size="sm" className="font-semibold shrink-0">
          <a href={call.meetLink} target="_blank" rel="noopener noreferrer">
            Join Call
          </a>
        </Button>
      );
    }
    // Accessible but the per-session link hasn't been published yet.
    return (
      <Button size="sm" variant="outline" disabled className="font-semibold shrink-0">
        Link soon
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="font-semibold shrink-0 gap-1.5"
      onClick={() => onUnlock(call.upgradeUrl ?? "/plans")}
    >
      <Lock className="w-3.5 h-3.5" />
      Unlock
    </Button>
  );
}

// RSVP control for one-off special sessions. Eligible members can reserve a
// spot ahead of the call and cancel that reservation; both surface the running
// registered tally. Locked sessions defer to the call's own Unlock deep-link
// (members can't reserve a session they aren't entitled to — the backend 404s).
function SpecialSessionAction({
  call,
  onUnlock,
}: {
  call: CoachingCall;
  onUnlock: (url: string) => void;
}) {
  const queryClient = useQueryClient();
  const refresh = () => {
    // Prefix match invalidates every cached coaching-calls list (any params)
    // plus the dashboard's upcoming-calls preview so both reflect the new state.
    queryClient.invalidateQueries({ queryKey: ["/api/coaching-calls"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
  };
  const register = useRegisterForCoachingCall({ mutation: { onSuccess: refresh } });
  const cancel = useCancelCoachingCallRegistration({ mutation: { onSuccess: refresh } });
  const pending = register.isPending || cancel.isPending;

  if (!call.isAccessible) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="font-semibold shrink-0 gap-1.5"
        onClick={() => onUnlock(call.upgradeUrl ?? "/plans")}
      >
        <Lock className="w-3.5 h-3.5" />
        Unlock
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-3 shrink-0">
      <span
        data-testid={`oneoff-registered-count-${call.id}`}
        className="flex items-center gap-1 text-xs text-muted-foreground"
      >
        <Users className="w-3.5 h-3.5" />
        {call.registeredCount} reserved
      </span>
      {call.hasRegistered ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          data-testid={`oneoff-cancel-${call.id}`}
          className="font-semibold gap-1.5"
          onClick={() => cancel.mutate({ id: call.id })}
        >
          <Check className="w-3.5 h-3.5 text-emerald-600" />
          Reserved
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={pending}
          data-testid={`oneoff-register-${call.id}`}
          className="font-semibold"
          onClick={() => register.mutate({ id: call.id })}
        >
          Reserve Spot
        </Button>
      )}
      {call.meetLink && (
        <Button asChild size="sm" variant="ghost" className="font-semibold">
          <a href={call.meetLink} target="_blank" rel="noopener noreferrer">
            Join Call
          </a>
        </Button>
      )}
    </div>
  );
}

// Monday-first index so the recurring schedule reads as a weekly cadence
// (Mon → Sun) rather than starting mid-week from "today".
function weekdayOrder(d: Date): number {
  return (d.getDay() + 6) % 7;
}

// The one-off call types surfaced in the "Upcoming Special Sessions" list.
// `weekly_qa` is excluded on purpose — it powers the recurring schedule above.
const ONE_OFF_CALL_TYPES = ["strategy", "mastermind", "vip_roundtable"] as const;
type OneOffCallType = (typeof ONE_OFF_CALL_TYPES)[number];

function isOneOffCallType(value: string): value is OneOffCallType {
  return (ONE_OFF_CALL_TYPES as readonly string[]).includes(value);
}

const ONE_OFF_CALL_LABELS: Record<OneOffCallType, string> = {
  strategy: "Strategy",
  mastermind: "Mastermind",
  vip_roundtable: "VIP Roundtable",
};

export default function Coaching() {
  const [, navigate] = useLocation();
  const { data: upcomingCalls } = useListCoachingCalls({ upcoming: true });
  const { data: coaches } = useListCoaches();

  // The recurring "Live Coaching Calls 6 Days/Week" schedule is the weekly
  // cadence of group Q&A calls, sourced from the same backend the Upcoming
  // Calls list uses. The backend returns every future occurrence of each
  // recurring slot (many weeks out), but this section shows a weekly cadence
  // (weekday + time + coach only), so we collapse each recurring slot to its
  // soonest upcoming occurrence — otherwise the same slot (e.g. "Saturday 3pm
  // with Bruce") renders as an identical row for every future week. Strategy /
  // mastermind / VIP sessions are one-off and stay in the Upcoming Calls list.
  const weeklyBySlot = new Map<
    string,
    { call: CoachingCall; start: Date; end: Date }
  >();
  for (const call of upcomingCalls ?? []) {
    if (call.callType !== "weekly_qa") continue;
    const start = new Date(call.scheduledAt);
    const end = new Date(start.getTime() + call.durationMinutes * 60000);
    // One row per recurring slot: same weekday + start time + coach is the
    // same weekly series as far as this cadence view is concerned. Key on the
    // stable coachId (not the display name) so renames or name collisions can't
    // over- or under-collapse slots.
    const slotKey = `${weekdayOrder(start)}|${format(start, "HH:mm")}|${call.coachId}`;
    const existing = weeklyBySlot.get(slotKey);
    if (!existing || start.getTime() < existing.start.getTime()) {
      weeklyBySlot.set(slotKey, { call, start, end });
    }
  }
  const weeklySchedule = [...weeklyBySlot.values()].sort(
    (a, b) =>
      weekdayOrder(a.start) - weekdayOrder(b.start) ||
      a.start.getTime() - b.start.getTime(),
  );

  // One-off strategy / mastermind / VIP sessions. These are NOT recurring, so
  // they live in their own "Upcoming Special Sessions" list ordered by the next
  // session date — never mixed into the weekly cadence above.
  const oneOffSessions = (upcomingCalls ?? [])
    .filter((c) => isOneOffCallType(c.callType))
    .map((call) => {
      const start = new Date(call.scheduledAt);
      const end = new Date(start.getTime() + call.durationMinutes * 60000);
      return { call, start, end, type: call.callType as OneOffCallType };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Video className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Coaching Calls</h1>
          </div>
          <p className="text-muted-foreground">
            Live group coaching six days a week, plus 1-on-1 sessions with the BTS
            Concierge team. We're with you every step of the way for personal,
            productive guidance.
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5 sm:p-8 md:p-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg border border-border/60 bg-muted flex items-center justify-center">
                <Video className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Live Coaching Calls 6 Days/Week</h2>
                <p className="text-sm text-muted-foreground">
                  These sessions critique real student marketing funnels and answer general Q&amp;A.
                </p>
              </div>
            </div>

            {weeklySchedule.length > 0 ? (
              <div className="border border-border/60 rounded-xl overflow-hidden">
                {weeklySchedule.map(({ call, start, end }, i) => (
                  <div
                    key={call.id}
                    data-testid={`weekly-call-${call.id}`}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 ${
                      i !== weeklySchedule.length - 1 ? "border-b border-border/60" : ""
                    } ${i % 2 === 0 ? "bg-background" : "bg-muted/40"}`}
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-foreground">
                        {format(start, "EEEE")} from{" "}
                        <strong className="text-foreground">
                          {format(start, "h:mm a")} – {format(end, "h:mm a")}
                        </strong>{" "}
                        with {call.coachName.split(" ")[0]}
                      </span>
                    </div>
                    <CallAction call={call} onUnlock={navigate} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-border/60 rounded-xl px-5 py-8 text-center text-sm text-muted-foreground">
                No live group calls are scheduled right now. Check back soon — new
                sessions are added every week.
              </div>
            )}

            <p className="text-sm text-muted-foreground mt-5 italic">
              Not able to make the calls? We've got you covered. All calls are recorded and posted in our "Live Q&amp;A" call archive.
            </p>
          </CardContent>
        </Card>

        {oneOffSessions.length > 0 && (
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-5 sm:p-8 md:p-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg border border-border/60 bg-muted flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-foreground" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Upcoming Special Sessions</h2>
                  <p className="text-sm text-muted-foreground">
                    One-off strategy, mastermind, and VIP roundtable calls — reserved for eligible members.
                  </p>
                </div>
              </div>

              <div className="border border-border/60 rounded-xl overflow-hidden">
                {oneOffSessions.map(({ call, start, end, type }, i) => (
                  <div
                    key={call.id}
                    data-testid={`oneoff-call-${call.id}`}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 ${
                      i !== oneOffSessions.length - 1 ? "border-b border-border/60" : ""
                    } ${i % 2 === 0 ? "bg-background" : "bg-muted/40"}`}
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-foreground">
                        <Badge
                          variant="outline"
                          data-testid={`oneoff-call-type-${call.id}`}
                          className="mr-2 align-middle text-[10px]"
                        >
                          {ONE_OFF_CALL_LABELS[type]}
                        </Badge>
                        {format(start, "EEE, MMM d")} from{" "}
                        <strong className="text-foreground">
                          {format(start, "h:mm a")} – {format(end, "h:mm a")}
                        </strong>{" "}
                        with {call.coachName.split(" ")[0]}
                      </span>
                    </div>
                    <SpecialSessionAction call={call} onUnlock={navigate} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {coaches && coaches.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-foreground mb-5">Your Coaches</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {coaches.map((coach, i) => {
                const tint = avatarTints[i % avatarTints.length];
                return (
                  <Card
                    key={coach.id}
                    data-testid={`coach-${coach.id}`}
                    className="border-border/60 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <CardContent className="p-6 text-center">
                      {coach.photoUrl ? (
                        <img
                          src={resolveCoachPhotoUrl(coach.photoUrl) ?? undefined}
                          alt={coach.name}
                          data-testid={`coach-photo-${coach.id}`}
                          className={`w-20 h-20 rounded-full object-cover border ${tint.border} mx-auto mb-4`}
                        />
                      ) : (
                        <div
                          data-testid={`coach-initials-${coach.id}`}
                          className={`w-20 h-20 rounded-full ${tint.bg} ${tint.text} border ${tint.border} mx-auto mb-4 flex items-center justify-center text-2xl font-bold`}
                        >
                          {coachInitials(coach.name)}
                        </div>
                      )}
                      <h3 className="text-sm font-bold text-foreground">{coach.name}</h3>
                      {coach.specialties && (
                        <p
                          data-testid={`coach-specialty-${coach.id}`}
                          className="text-xs font-medium text-primary mt-1"
                        >
                          {coach.specialties}
                        </p>
                      )}
                      {coach.bio && (
                        <p
                          data-testid={`coach-bio-${coach.id}`}
                          className="text-xs text-muted-foreground mt-2 leading-relaxed"
                        >
                          {coach.bio}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
