import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Users, TrendingUp, DollarSign, Wrench, Infinity,
  Handshake, CheckCircle2, Send, UserPlus
} from "lucide-react";
import { useState } from "react";

const benefits = [
  {
    icon: TrendingUp,
    title: "Grow Your Own Business While Coaching",
    desc: "Teaching others keeps you sharp. You'll reinforce your own skills, test strategies in real time, and stay ahead in the competitive affiliate marketing space.",
  },
  {
    icon: DollarSign,
    title: "Earn from Private 1:1 Sessions",
    desc: "Book one-on-one coaching sessions with mentees and get paid for your expertise while making a real impact on their progress.",
  },
  {
    icon: Wrench,
    title: "Continued Access to BTS Tools",
    desc: "Even after your mentorship ends, you'll maintain access to the BTS tools, resources, and systems that help you thrive.",
  },
  {
    icon: Infinity,
    title: "Unlimited Income Potential",
    desc: "The only cap on your earnings is the one you set for yourself. More sessions, more clients, more income — it's that simple.",
  },
  {
    icon: Handshake,
    title: "Work With a Like-Minded Team",
    desc: "You'll collaborate with driven professionals who share the same vision: creating success for ourselves and for the mentees we serve.",
  },
];

const duties = [
  "Host private 1:1 coaching sessions",
  "Guide mentees through creatives, campaigns, and optimization strategies",
  "Help mentees find clarity, focus, and executable plans",
  "Motivate, inspire, and keep mentees accountable for results",
];

const requirements = [
  "Must have an active campaign running that is producing revenue",
  "Must possess strong knowledge of all BTS software and tools",
  "Must be able to clearly communicate strategies and mentor with patience and enthusiasm",
  "Coaches will be required to host 1–2 coaching calls per week",
];

const tierOptions = ["Frontend", "Launchpad", "3-Month", "6-Month", "1-Year", "Lifetime"];

const preQualQuestions = [
  "Why are you interested in joining the BTS Coaching Program?",
  "What experience do you have in coaching or mentoring others (formal or informal)?",
  "What specific strengths or expertise would you bring to the program?",
  "How much time can you realistically commit each week to coaching?",
  "What is your biggest goal in becoming part of this coaching program?",
];

export default function CoachingRecruitment() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto">
          <Card className="border-[#2d8a4e]/30 shadow-sm bg-gradient-to-br from-[#2d8a4e]/5 to-transparent">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-[#2d8a4e]/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-[#2d8a4e]" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Application Submitted!</h3>
              <p className="text-muted-foreground">
                Our team will review your application and Mark Blyn, CEO of Build Test Scale, will reach out directly with next steps.
              </p>
              <Button onClick={() => setSubmitted(false)} variant="outline" className="mt-4">
                Submit Another Application
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">

        <div className="bg-[#1a56db] rounded-2xl p-8 md:p-10 text-white shadow-lg">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <UserPlus className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold font-['Roboto'] tracking-tight">
                Coaching Recruitment
              </h1>
              <p className="text-sm opacity-90 mt-1">
                Build Your Business, Grow Your Skills, and Help Others Win
              </p>
            </div>
          </div>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-6 md:p-8 space-y-3">
            <p className="text-muted-foreground leading-relaxed">
              This is your opportunity to step into a leadership role, share your expertise, and get paid — all while sharpening your own skills as an affiliate marketer.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              We're looking for motivated, results-driven coaches to join our team and work directly with mentees, guiding them toward success and helping them break through roadblocks.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-6 md:p-8">
            <h2 className="text-lg font-bold text-foreground mb-5">Why Become a BTS Coach?</h2>
            <div className="space-y-4">
              {benefits.map((b, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-lg bg-[#1a56db]/10 flex items-center justify-center shrink-0 mt-0.5">
                    <b.icon className="w-4 h-4 text-[#1a56db]" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{b.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{b.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6">
              <h3 className="font-bold text-foreground mb-3">What You'll Do as a Coach</h3>
              <div className="space-y-2">
                {duties.map((d) => (
                  <div key={d} className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" />
                    <p className="text-sm text-muted-foreground">{d}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6">
              <h3 className="font-bold text-foreground mb-3">Requirements to Apply</h3>
              <div className="space-y-2">
                {requirements.map((r) => (
                  <div key={r} className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#1a56db] mt-0.5 shrink-0" />
                    <p className="text-sm text-muted-foreground">{r}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-6 md:p-8">
            <h2 className="text-lg font-bold text-foreground mb-1">Ready to Apply?</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Tell us about your experience, your results, and why you're ready to help lead our mentees to success.
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">Basic Information</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Full Name *</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Email Address *</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">BTS Mentorship Tier *</label>
                    <select
                      required
                      value={tier}
                      onChange={(e) => setTier(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30"
                    >
                      <option value="">Select your tier...</option>
                      {tierOptions.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Phone Number</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30"
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-foreground mb-1.5">Current Role/Position</label>
                  <input
                    type="text"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30"
                  />
                </div>
              </div>

              <div className="border-t border-border pt-5">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">Pre-Qualifying Questions</h3>
                <div className="space-y-4">
                  {preQualQuestions.map((q, i) => (
                    <div key={i}>
                      <label className="block text-sm font-medium text-foreground mb-1.5">{q}</label>
                      <textarea
                        rows={3}
                        value={answers[i] || ""}
                        onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30 resize-none"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-xs text-muted-foreground italic">
                Once submitted, our team will review your application and Mark Blyn, CEO of Build Test Scale, will reach out directly with next steps.
              </p>

              <Button type="submit" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-2">
                <Send className="w-4 h-4" />
                Submit Application
              </Button>
            </form>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  );
}
