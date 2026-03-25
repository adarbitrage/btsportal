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

const coaches = [
  { name: "Sasha Bobylev", initials: "SB", color: "bg-blue-500" },
  { name: "Bruce Clark", initials: "BC", color: "bg-emerald-600" },
  { name: "Michael Wissbaum", initials: "MW", color: "bg-violet-600" },
  { name: "Todd Rupp", initials: "TR", color: "bg-amber-600" },
];

const conciergeTeam = [
  { name: "John Dela Cruz", initials: "JD", color: "bg-sky-600", bookingUrl: "https://apiv2.getflexy.app/widget/bookings/johndc" },
  { name: "Neil Warren", initials: "NW", color: "bg-teal-600", bookingUrl: "https://apiv2.getflexy.app/widget/bookings/neil-warren-concierge-call" },
  { name: "Mikha Bechayda", initials: "MB", color: "bg-rose-600", bookingUrl: "https://apiv2.getflexy.app/widget/bookings/1-on-1-call-with-mikha-ella" },
];

export default function Coaching() {
  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-10">

        <div className="bg-[#1a56db] rounded-2xl p-8 md:p-10 text-white shadow-lg">
          <p className="text-sm font-semibold uppercase tracking-widest text-white/70 mb-2">Ask The Masters</p>
          <h1 className="text-3xl md:text-4xl font-bold font-['Roboto'] tracking-tight mb-2">
            Live Coaching Calls
          </h1>
          <p className="text-lg md:text-xl opacity-90">
            We're with you every step of the way for personal, productive guidance.
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center">
                <Video className="w-5 h-5 text-[#1a56db]" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Live Coaching Calls 6 Days/Week</h2>
                <p className="text-sm text-muted-foreground">These sessions critique real student marketing funnels and answer general Q&A.</p>
              </div>
            </div>

            <div className="border border-[#e8e4dc] rounded-xl overflow-hidden">
              {liveSchedule.map((session, i) => (
                <div
                  key={i}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 ${
                    i !== liveSchedule.length - 1 ? "border-b border-[#e8e4dc]" : ""
                  } ${i % 2 === 0 ? "bg-white" : "bg-[#faf9f7]"}`}
                >
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground">
                      {session.day} from <strong className="text-[#2d8a4e]">{session.time}</strong> with {session.coach}
                    </span>
                  </div>
                  <a
                    href={GOOGLE_MEET_LINK}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button size="sm" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white font-bold gap-1.5">
                      <ExternalLink className="w-3.5 h-3.5" />
                      JOIN CALL
                    </Button>
                  </a>
                </div>
              ))}
            </div>

            <p className="text-sm text-muted-foreground mt-5 italic">
              Not able to make the calls? We got you covered. All calls are recorded and posted in our "Live Q&A" call archive.
            </p>
          </CardContent>
        </Card>

        <div>
          <h2 className="text-xl font-bold text-foreground mb-5">Your Coaches</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {coaches.map((coach) => (
              <Card key={coach.name} className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6 text-center">
                  <div className={`w-20 h-20 rounded-full ${coach.color} mx-auto mb-4 flex items-center justify-center text-2xl font-bold text-white shadow-md`}>
                    {coach.initials}
                  </div>
                  <h3 className="text-sm font-bold text-foreground">{coach.name}</h3>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="border-t border-[#e8e4dc] pt-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center">
              <Headphones className="w-5 h-5 text-[#1a56db]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">1-on-1 Calls</h2>
              <p className="text-sm text-muted-foreground">Book a private call with a member of the BTS Concierge, 6 days/week.</p>
            </div>
          </div>

          <Card className="border-border/60 shadow-sm mt-5">
            <CardContent className="p-8 md:p-10">
              <p className="text-muted-foreground leading-relaxed mb-6">
                Elevate your productivity with our skilled BTS Concierge team. We provide personalized 1-on-1
                consultations to address your specific needs, offering expert guidance and support to help you
                achieve your goals efficiently. Simply click a name below to secure your personalized consultation.
                We are available <strong className="text-foreground">Monday to Saturday</strong>.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                {conciergeTeam.map((member) => (
                  <Card key={member.name} className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-6 text-center">
                      <div className={`w-16 h-16 rounded-full ${member.color} mx-auto mb-3 flex items-center justify-center text-xl font-bold text-white shadow-md`}>
                        {member.initials}
                      </div>
                      <h3 className="text-sm font-bold text-foreground mb-3">{member.name}</h3>
                      <a
                        href={member.bookingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button size="sm" className="w-full bg-[#1a56db] hover:bg-[#1648b8] gap-1.5">
                          <Calendar className="w-3.5 h-3.5" />
                          Book Call
                        </Button>
                      </a>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-gradient-to-r from-[#1a56db]/5 to-transparent border-[#1a56db]/20">
          <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-[#1a56db]" />
            </div>
            <div>
              <h3 className="font-bold text-foreground mb-1">Have a question?</h3>
              <p className="text-sm text-muted-foreground">
                Submit it before the next Q&A call so the coaches can prepare, or post in the BTS Community for peer support anytime.
              </p>
            </div>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  );
}
