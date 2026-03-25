import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Headphones, CheckCircle2, ExternalLink, Send,
  ClipboardList, Phone
} from "lucide-react";
import { useState } from "react";

const FLEXY_BOOKING_BASE = "https://apiv2.getflexy.app/widget/bookings";

const conciergeMembers = [
  { name: "John Dela Cruz", booking: "johndc" },
  { name: "Neil Warren", booking: "neil-warren-concierge-call" },
  { name: "Mikha Bechayda", booking: "1-on-1-call-with-mikha-ella" },
];

const networkOptions = ["Clickbank", "MediaMavens"];
const trafficSources = ["Grasshopper", "Crane", "Caterpillar", "Meta", "Other"];
const phases = ['"Build" Phase', '"Test" Phase', '"Scale" Phase'];

const buildTasks = [
  "Create Banner Headlines (20 Max)",
  "Create Banner Images (10 Max)",
  "Create Full Banner",
  "Create Jump Page Hero Shot Images (10 images max)",
  "Create Jump Page Headlines (10 headlines max)",
  "Set Up Initial DIYTrax™ Campaign",
  "Create Split Tests With MetricMover™ & Integrate With DIYTrax™ (25 Variations)",
  "Other",
];

const testTasks = [
  "Optimize Campaign Banners (1 campaign max)",
  "Optimize Jump Pages (1 campaign max)",
  "Iterate Off Of Promising Banners (20 new banners max)",
  "Iterate Off Of Promising Landing Pages (20 new pages max)",
  "Other",
];

const scaleTasks = [
  "Build Dedicated Email Creative (1 creative max)",
  "Create Promising Banners In Other Sizes",
  "Other",
];

const bannerSizes = ["300x250", "970x250", "970x550", "900x750", "1536x864"];

function ConciergeForm() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [networks, setNetworks] = useState<string[]>([]);
  const [offerName, setOfferName] = useState("");
  const [offerUrl, setOfferUrl] = useState("");
  const [traffic, setTraffic] = useState<string[]>([]);
  const [phase, setPhase] = useState("");
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [otherInfo, setOtherInfo] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const toggleItem = (list: string[], setList: (v: string[]) => void, item: string) => {
    setList(list.includes(item) ? list.filter((i) => i !== item) : [...list, item]);
  };

  const phaseTasks = phase === '"Build" Phase' ? buildTasks
    : phase === '"Test" Phase' ? testTasks
    : phase === '"Scale" Phase' ? scaleTasks
    : [];

  const maxTasks = phase === '"Build" Phase' ? 2 : 1;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <Card className="border-[#2d8a4e]/30 shadow-sm bg-gradient-to-br from-[#2d8a4e]/5 to-transparent">
        <CardContent className="p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-[#2d8a4e]/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-[#2d8a4e]" />
          </div>
          <h3 className="text-xl font-bold text-foreground">Task Submitted!</h3>
          <p className="text-muted-foreground">
            Your request has been received. Our BTS Concierge™ team will get back to you within 24 hours.
          </p>
          <Button onClick={() => setSubmitted(false)} variant="outline" className="mt-4">
            Submit Another Task
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">First Name *</label>
          <input
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Last Name *</label>
          <input
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Email *</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Affiliate Network *</label>
        <div className="flex flex-wrap gap-2">
          {networkOptions.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => toggleItem(networks, setNetworks, n)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                networks.includes(n)
                  ? "bg-[#1a56db] text-white border-[#1a56db]"
                  : "bg-background border-border text-muted-foreground hover:border-[#1a56db]/40"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Offer Name *</label>
        <input
          type="text"
          required
          value={offerName}
          onChange={(e) => setOfferName(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Offer URL (exact link to the VSL) *</label>
        <input
          type="url"
          required
          value={offerUrl}
          onChange={(e) => setOfferUrl(e.target.value)}
          placeholder="https://"
          className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Traffic Source *</label>
        <div className="flex flex-wrap gap-2">
          {trafficSources.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleItem(traffic, setTraffic, t)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                traffic.includes(t)
                  ? "bg-[#1a56db] text-white border-[#1a56db]"
                  : "bg-background border-border text-muted-foreground hover:border-[#1a56db]/40"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Which Phase Are You On? *</label>
        <div className="flex flex-wrap gap-2">
          {phases.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { setPhase(p); setSelectedTasks([]); }}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                phase === p
                  ? "bg-[#1a56db] text-white border-[#1a56db]"
                  : "bg-background border-border text-muted-foreground hover:border-[#1a56db]/40"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Refer to the Quick-Start Guide if you are unsure.
        </p>
      </div>

      {phase && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            What tasks would you like us to do? (Max {maxTasks}) *
          </label>
          <div className="space-y-2">
            {phaseTasks.map((task) => (
              <label key={task} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedTasks.includes(task)}
                  onChange={() => {
                    if (selectedTasks.includes(task)) {
                      setSelectedTasks(selectedTasks.filter((t) => t !== task));
                    } else if (selectedTasks.length < maxTasks) {
                      setSelectedTasks([...selectedTasks, task]);
                    }
                  }}
                  className="mt-1 accent-[#1a56db]"
                />
                <span className="text-sm text-muted-foreground">{task}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {(selectedTasks.includes("Create Full Banner") || selectedTasks.includes("Create Promising Banners In Other Sizes")) && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Banner Sizes Needed</label>
          <div className="flex flex-wrap gap-2">
            {bannerSizes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleItem(selectedSizes, setSelectedSizes, s)}
                className={`px-3 py-1.5 rounded-lg text-sm border font-mono transition-colors ${
                  selectedSizes.includes(s)
                    ? "bg-[#1a56db] text-white border-[#1a56db]"
                    : "bg-background border-border text-muted-foreground hover:border-[#1a56db]/40"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Any Other Info We Might Need?</label>
        <textarea
          rows={4}
          value={otherInfo}
          onChange={(e) => setOtherInfo(e.target.value)}
          placeholder="Please be as specific and detailed as possible..."
          className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30 resize-none"
        />
      </div>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1 accent-[#1a56db]"
          required
        />
        <span className="text-sm text-muted-foreground">
          I confirm I have selected no more than {maxTasks} option{maxTasks > 1 ? "s" : ""} from above (24-hour turnaround time). *
        </span>
      </label>

      <Button type="submit" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-2 w-full sm:w-auto">
        <Send className="w-4 h-4" />
        Submit Your Task
      </Button>
    </form>
  );
}

export default function Concierge() {
  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">

        <div className="bg-[#1a56db] rounded-2xl p-8 md:p-10 text-white shadow-lg">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <Headphones className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold font-['Roboto'] tracking-tight">
                The BTS Concierge™
              </h1>
              <p className="text-lg opacity-90">
                Your Personal Digital Marketing Assistants
              </p>
            </div>
          </div>
        </div>

        <Card className="border-border/60 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="aspect-video bg-black rounded-t-lg overflow-hidden">
              <iframe
                src="https://fast.vidalytics.com/embeds/trR5xdVa/W2EWjAXnSz8UjQvB/"
                className="w-full h-full border-0"
                allow="autoplay; fullscreen"
                allowFullScreen
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <a href="#task" className="flex items-center gap-2 px-4 py-2.5 bg-[#2d8a4e] text-white rounded-lg text-sm font-medium hover:bg-[#246e3e] transition-colors">
            <ClipboardList className="w-4 h-4" />
            Submit a Task for the Concierge™
          </a>
          <a href="#call" className="flex items-center gap-2 px-4 py-2.5 bg-[#1a56db] text-white rounded-lg text-sm font-medium hover:bg-[#1548b8] transition-colors">
            <Phone className="w-4 h-4" />
            1-on-1 Call with a VA
          </a>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10 space-y-5">
            <h2 className="text-2xl font-bold text-foreground">Welcome To The BTS Concierge™</h2>
            <p className="text-muted-foreground leading-relaxed">
              The BTS Concierge™ is one of the most valuable resources available to you as a Build Test Scale member. This service was designed to eliminate bottlenecks, save you time, and give you the professional edge you need to thrive in affiliate marketing.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              This isn't your typical virtual assistant team. These are industry professionals — skilled specialists who are paid premium rates to support our members. Whether you're looking to:
            </p>
            <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-6">
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" /> Build complete landing pages from scratch</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" /> Create animated GIFs for banner ads and landing page hero shots</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" /> Design and deliver high-quality banners</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" /> Connect landing pages to proprietary tools within the portal</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" /> Optimize your campaigns after they've launched</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" /> Get overviews of each proprietary software application in the portal</li>
              </ul>
            </div>
            <p className="text-muted-foreground leading-relaxed">
              Our Concierge team is here to make it happen. These experts are committed to ensuring nothing stands in the way of your success. <strong className="text-foreground">Most tasks are turned around within 24 hours</strong>, depending on complexity.
            </p>
          </CardContent>
        </Card>

        <section id="task">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-8 md:p-10 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#2d8a4e]/10 flex items-center justify-center">
                  <ClipboardList className="w-5 h-5 text-[#2d8a4e]" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Submit A Task For The Concierge™</h2>
                  <p className="text-sm text-muted-foreground">
                    Fill out the form below and let us know how we can assist. Turnaround time: 24 hours.
                  </p>
                </div>
              </div>
              <ConciergeForm />
            </CardContent>
          </Card>
        </section>

        <section id="call">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-8 md:p-10 space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground">1-On-1 Calls</h2>
                <p className="text-lg text-muted-foreground mt-1">
                  Book a private call with a member of the BTS Concierge™
                </p>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Elevate your productivity with personalized 1-on-1 consultations focused on practical, hands-on assistance. Our team can support you with banner creation, landing page setup, Flexy configuration, MetricMover variations, DIYTrax campaign setup, and much more. Available Monday through Saturday.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {conciergeMembers.map((member) => (
                  <a
                    key={member.booking}
                    href={`${FLEXY_BOOKING_BASE}/${member.booking}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Card className="border-border/60 hover:border-[#1a56db]/40 hover:shadow-md transition-all cursor-pointer h-full">
                      <CardContent className="p-5 flex flex-col items-center text-center gap-3">
                        <div className="w-16 h-16 rounded-full bg-[#1a56db]/10 flex items-center justify-center">
                          <span className="text-xl font-bold text-[#1a56db]">
                            {member.name.split(" ").map((n) => n[0]).join("")}
                          </span>
                        </div>
                        <p className="font-bold text-foreground">{member.name}</p>
                        <span className="flex items-center gap-1 text-xs text-[#1a56db] font-medium">
                          <ExternalLink className="w-3 h-3" />
                          Book a Call
                        </span>
                      </CardContent>
                    </Card>
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

      </div>
    </AppLayout>
  );
}
