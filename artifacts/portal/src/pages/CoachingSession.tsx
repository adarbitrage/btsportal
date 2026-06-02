import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  UserCheck, CheckCircle2, ArrowRight, Clock,
  Video, Mail, AlertTriangle
} from "lucide-react";

const packages = [
  {
    sessions: 1,
    price: "$135",
    description: "A single session for targeted guidance.",
    highlight: false,
  },
  {
    sessions: 3,
    price: "$375",
    description: "A short-term package for focused support.",
    highlight: true,
  },
  {
    sessions: 5,
    price: "$600",
    description: "A comprehensive package for continued strategic development.",
    highlight: false,
  },
];

const coaches = [
  { name: "Sasha", initials: "SB" },
  { name: "Robin", initials: "RS" },
  { name: "Todd", initials: "TR" },
  { name: "Bruce", initials: "BC" },
  { name: "Michael", initials: "MW" },
];

const benefits = [
  { text: "Get Unstuck, Fast", detail: "Walk away from each session knowing exactly what to do next." },
  { text: "Answers in Real Time", detail: "No more waiting days for a response — get clarity now." },
  { text: "Stronger Creatives & Strategies", detail: "Get expert feedback and direction to improve your campaigns immediately." },
  { text: "Personalized Roadmap", detail: "A step-by-step plan designed just for you." },
  { text: "Maximum Use of Your Time", detail: "Every minute is focused on moving you forward." },
];

const steps = [
  "Pick your package (1, 3, or 5 sessions).",
  "Choose your coach(es).",
  "Schedule your 60-minute Zoom session.",
  "Get expert help, right there on the call.",
  "Receive the recording in your inbox so you can revisit it anytime.",
];

export default function CoachingSession() {
  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">

        <div className="bg-[#1a56db] rounded-2xl p-8 md:p-10 text-white shadow-lg">
          <h1 className="text-3xl md:text-4xl font-bold font-['Roboto'] tracking-tight mb-2">
            Private Coaching Sessions
          </h1>
          <p className="text-lg opacity-90">
            Your direct line to clarity, strategy, and momentum.
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-5">
            <h2 className="text-2xl font-bold text-foreground">
              Struggling to Get Moving? Feeling Stuck? We've Got Your Solution.
            </h2>
            <div className="text-muted-foreground space-y-3 leading-relaxed">
              <p>If you've ever thought…</p>
              <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-5 space-y-2 text-sm italic">
                <p>"I don't know where to start."</p>
                <p>"I can't get clear answers fast enough."</p>
                <p>"I wish someone could just walk me through it."</p>
                <p>"My creatives and strategies need help — now."</p>
              </div>
              <p>…you're not alone. We hear these concerns from mentees all the time.</p>
              <p>
                <strong className="text-foreground">Now you can book private time with a coach to fix this.</strong> No waiting for the next group call. No more piecing together answers from multiple places. Just you + your chosen coach, focused on solving your specific challenges — fast.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-5">
            <h2 className="text-xl font-bold text-foreground">Here's How It Helps You:</h2>
            <div className="space-y-3">
              {benefits.map((b) => (
                <div key={b.text} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#2d8a4e] mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-foreground text-sm">{b.text}</p>
                    <p className="text-sm text-muted-foreground">{b.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-5">
            <h2 className="text-xl font-bold text-foreground">Your Flexible Options</h2>
            <p className="text-muted-foreground text-sm">
              Choose what works best for you. You can even mix and match coaches — one for strategy, another for creatives, another for optimization.
            </p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              Each session is 60 minutes via Zoom
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-5">
            <h2 className="text-xl font-bold text-foreground">How It Works:</h2>
            <div className="space-y-3">
              {steps.map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="w-7 h-7 rounded-full bg-[#1a56db]/10 flex items-center justify-center text-sm font-bold text-[#1a56db] shrink-0">
                    {i + 1}
                  </span>
                  <p className="text-sm text-muted-foreground pt-1">{step}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <section id="purchase">
          <h2 className="text-xl font-bold text-foreground mb-4">Purchase Your Sessions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {packages.map((pkg) => (
              <Card
                key={pkg.sessions}
                className={`border-border/60 shadow-sm overflow-hidden ${pkg.highlight ? "ring-2 ring-[#1a56db]" : ""}`}
              >
                {pkg.highlight && (
                  <div className="bg-[#1a56db] text-white text-center text-xs font-bold py-1.5 uppercase tracking-widest">
                    Most Popular
                  </div>
                )}
                <CardContent className="p-6 text-center space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">
                      {pkg.sessions}-Session{pkg.sessions > 1 ? " Pack" : ""}
                    </p>
                    <p className="text-sm text-muted-foreground">(60 minutes each)</p>
                  </div>
                  <p className="text-4xl font-bold text-foreground">{pkg.price}</p>
                  <p className="text-sm text-muted-foreground">{pkg.description}</p>
                  <Button className="w-full bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-2">
                    <ArrowRight className="w-4 h-4" />
                    Purchase Session{pkg.sessions > 1 ? "s" : ""}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section id="book">
          <h2 className="text-xl font-bold text-foreground mb-4">Book Your Session</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Select a coach below to schedule your private 60-minute Zoom session.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {coaches.map((coach) => (
              <Card key={coach.name} className="border-border/60 shadow-sm hover:border-[#1a56db]/40 hover:shadow-md transition-all">
                <CardContent className="p-5 flex flex-col items-center text-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-[#1a56db]/10 flex items-center justify-center">
                    <span className="text-xl font-bold text-[#1a56db]">{coach.initials}</span>
                  </div>
                  <p className="font-bold text-foreground">{coach.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Video className="w-3.5 h-3.5" />
                    60-min Zoom Session
                  </div>
                  <Button variant="outline" size="sm" className="w-full text-[#1a56db] border-[#1a56db]/30 hover:bg-[#1a56db]/5">
                    Book with {coach.name.split(" ")[0]}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Card className="border-amber-200 bg-amber-50/50 shadow-sm">
          <CardContent className="p-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">Disclaimer:</p>
              <p>All coaching call bookings are final. No refunds will be issued for calls that have already been performed or for no-shows. Rescheduling is only possible if requested at least 24 hours in advance, subject to coach availability.</p>
            </div>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  );
}
