import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Video, ExternalLink, Users, Headphones } from "lucide-react";

const GOOGLE_MEET_LINK = "https://meet.google.com/adz-axqj-pjm";

const liveSchedule = [
  { day: "Mondays", time: "8 - 9am CST", coach: "Todd Rupp" },
  { day: "Mondays", time: "3 - 4pm CST", coach: "Bruce Clark" },
  { day: "Mondays", time: "6 - 7pm CST", coach: "Sasha Bobylev" },
  { day: "Tuesdays", time: "3 - 4pm CST", coach: "Bruce Clark" },
  { day: "Tuesdays", time: "6 - 7pm CST", coach: "Michael Wissbaum" },
  { day: "Wednesdays", time: "6 - 7pm CST", coach: "Sasha Bobylev" },
  { day: "Thursdays", time: "6 - 7pm CST", coach: "Michael Wissbaum" },
  { day: "Fridays", time: "8 - 9am CST", coach: "Todd Rupp" },
  { day: "Saturdays", time: "10 - 11am CST", coach: "Bruce Clark" },
];

type AvatarTint = {
  bg: string;
  border: string;
  text: string;
};

const coaches: { name: string; initials: string; tint: AvatarTint }[] = [
  { name: "Sasha Bobylev", initials: "SB", tint: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" } },
  { name: "Bruce Clark", initials: "BC", tint: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700" } },
  { name: "Michael Wissbaum", initials: "MW", tint: { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-700" } },
  { name: "Todd Rupp", initials: "TR", tint: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" } },
];

const conciergeTeam: { name: string; initials: string; tint: AvatarTint; bookingUrl: string }[] = [
  {
    name: "John Dela Cruz",
    initials: "JD",
    tint: { bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700" },
    bookingUrl: "https://apiv2.getflexy.app/widget/bookings/johndc",
  },
  {
    name: "Neil Warren",
    initials: "NW",
    tint: { bg: "bg-teal-50", border: "border-teal-200", text: "text-teal-700" },
    bookingUrl: "https://apiv2.getflexy.app/widget/bookings/neil-warren-concierge-call",
  },
  {
    name: "Mikha Bechayda",
    initials: "MB",
    tint: { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700" },
    bookingUrl: "https://apiv2.getflexy.app/widget/bookings/1-on-1-call-with-mikha-ella",
  },
];

export default function Coaching() {
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
                  <Button asChild size="sm" className="gap-1.5 font-semibold">
                    <a href={GOOGLE_MEET_LINK} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3.5 h-3.5" />
                      Join Call
                    </a>
                  </Button>
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
          <CardContent className="p-5 sm:p-8 md:p-10">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-lg border border-border/60 bg-muted flex items-center justify-center">
                <Headphones className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">1-on-1 Calls</h2>
                <p className="text-sm text-muted-foreground">
                  Book a private call with a member of the BTS Concierge, 6 days/week.
                </p>
              </div>
            </div>

            <p className="text-muted-foreground leading-relaxed mb-6">
              Elevate your productivity with our skilled BTS Concierge team. We provide
              personalized 1-on-1 consultations to address your specific needs, offering
              expert guidance and support to help you achieve your goals efficiently.
              Simply click a name below to secure your personalized consultation. We are
              available <strong className="text-foreground">Monday to Saturday</strong>.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {conciergeTeam.map((member) => (
                <Card key={member.name} className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-6 text-center">
                    <div
                      className={`w-16 h-16 rounded-full ${member.tint.bg} ${member.tint.text} border ${member.tint.border} mx-auto mb-3 flex items-center justify-center text-xl font-bold`}
                    >
                      {member.initials}
                    </div>
                    <h3 className="text-sm font-bold text-foreground mb-3">{member.name}</h3>
                    <Button asChild size="sm" className="w-full gap-1.5">
                      <a href={member.bookingUrl} target="_blank" rel="noopener noreferrer">
                        <Calendar className="w-3.5 h-3.5" />
                        Book Call
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>

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
