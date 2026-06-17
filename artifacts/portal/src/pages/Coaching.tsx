import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Video, Users, Lock, Clock } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { useListCoachingCalls, useGetCurrentMember } from "@workspace/api-client-react";

const GOOGLE_MEET_LINK = "https://meet.google.com/adz-axqj-pjm";

// The weekly recurring group calls require the same entitlement the dynamic
// "Upcoming Calls" section gates on. Members without it must see an upgrade CTA
// instead of a working Join Call link. `coaching:group` is first granted by the
// 3-month mentorship (mirrors CALL_ENTITLEMENT_TO_PLAN on the API).
const GROUP_COACHING_ENTITLEMENT = "coaching:group";
const GROUP_COACHING_UPGRADE_URL = "/plans?highlight=3month";

const liveSchedule = [
  { day: "Mondays", time: "8 - 9am CST", coach: "Todd" },
  { day: "Mondays", time: "3 - 4pm CST", coach: "Bruce" },
  { day: "Mondays", time: "6 - 7pm CST", coach: "Sasha" },
  { day: "Tuesdays", time: "3 - 4pm CST", coach: "Bruce" },
  { day: "Tuesdays", time: "6 - 7pm CST", coach: "Michael" },
  { day: "Wednesdays", time: "6 - 7pm CST", coach: "Sasha" },
  { day: "Thursdays", time: "6 - 7pm CST", coach: "Michael" },
  { day: "Fridays", time: "8 - 9am CST", coach: "Todd" },
  { day: "Saturdays", time: "10 - 11am CST", coach: "Bruce" },
];

type AvatarTint = {
  bg: string;
  border: string;
  text: string;
};

const coaches: { name: string; initials: string; tint: AvatarTint }[] = [
  { name: "Sasha", initials: "SB", tint: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" } },
  { name: "Bruce", initials: "BC", tint: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700" } },
  { name: "Michael", initials: "MW", tint: { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-700" } },
  { name: "Todd", initials: "TR", tint: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" } },
];

export default function Coaching() {
  const [, navigate] = useLocation();
  const { data: upcomingCalls } = useListCoachingCalls({ upcoming: true });
  const { data: member } = useGetCurrentMember();
  const hasGroupCoaching = (member?.entitlements ?? []).includes(
    GROUP_COACHING_ENTITLEMENT,
  );

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

        {upcomingCalls && upcomingCalls.length > 0 && (
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-5 sm:p-8 md:p-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg border border-border/60 bg-muted flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-foreground" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Upcoming Calls</h2>
                  <p className="text-sm text-muted-foreground">
                    Your next scheduled coaching sessions.
                  </p>
                </div>
              </div>

              <div className="border border-border/60 rounded-xl overflow-hidden">
                {upcomingCalls.map((call, i) => (
                  <div
                    key={call.id}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 ${
                      i !== upcomingCalls.length - 1 ? "border-b border-border/60" : ""
                    } ${i % 2 === 0 ? "bg-background" : "bg-muted/40"}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-foreground truncate">
                          {call.title}
                        </span>
                        <Badge variant="outline" className="text-[10px] bg-white shrink-0">
                          {call.callType.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 shrink-0" />
                          {format(new Date(call.scheduledAt), "EEE, MMM d • h:mm a")}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          {call.durationMinutes} min
                        </span>
                        <span>with {call.coachName.split(" ")[0]}</span>
                      </div>
                    </div>
                    {call.isAccessible ? (
                      <Button asChild size="sm" className="font-semibold shrink-0">
                        <a
                          href={call.meetLink ?? GOOGLE_MEET_LINK}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Join Call
                        </a>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="font-semibold shrink-0 gap-1.5"
                        onClick={() => navigate(call.upgradeUrl ?? "/plans")}
                      >
                        <Lock className="w-3.5 h-3.5" />
                        Unlock
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

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

            <div className="border border-border/60 rounded-xl overflow-hidden">
              {liveSchedule.map((session, i) => (
                <div
                  key={i}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 ${
                    i !== liveSchedule.length - 1 ? "border-b border-border/60" : ""
                  } ${i % 2 === 0 ? "bg-background" : "bg-muted/40"}`}
                >
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground">
                      {session.day} from{" "}
                      <strong className="text-foreground">{session.time}</strong> with{" "}
                      {session.coach}
                    </span>
                  </div>
                  {hasGroupCoaching ? (
                    <Button asChild size="sm" className="font-semibold">
                      <a href={GOOGLE_MEET_LINK} target="_blank" rel="noopener noreferrer">
                        Join Call
                      </a>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-semibold shrink-0 gap-1.5"
                      onClick={() => navigate(GROUP_COACHING_UPGRADE_URL)}
                    >
                      <Lock className="w-3.5 h-3.5" />
                      Unlock
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <p className="text-sm text-muted-foreground mt-5 italic">
              Not able to make the calls? We've got you covered. All calls are recorded and posted in our "Live Q&amp;A" call archive.
            </p>
          </CardContent>
        </Card>

        <div>
          <h2 className="text-xl font-bold text-foreground mb-5">Your Coaches</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {coaches.map((coach) => (
              <Card key={coach.name} className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6 text-center">
                  <div
                    className={`w-20 h-20 rounded-full ${coach.tint.bg} ${coach.tint.text} border ${coach.tint.border} mx-auto mb-4 flex items-center justify-center text-2xl font-bold`}
                  >
                    {coach.initials}
                  </div>
                  <h3 className="text-sm font-bold text-foreground">{coach.name}</h3>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-10 h-10 rounded-lg border border-border/60 bg-muted flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-foreground" />
            </div>
            <div>
              <h3 className="font-bold text-foreground mb-1">Have a question?</h3>
              <p className="text-sm text-muted-foreground">
                Submit it before the next Q&amp;A call so the coaches can prepare, or post in the BTS Community for peer support anytime.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
