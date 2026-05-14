import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Headphones, CheckCircle2, Send,
  ClipboardList, Phone
} from "lucide-react";
import { useState } from "react";

const FLEXY_BOOKING_BASE = "https://apiv2.getflexy.app/widget/bookings";

type AvatarTint = { bg: string; border: string; text: string };

const conciergeMembers: { name: string; booking: string; tint: AvatarTint }[] = [
  {
    name: "John Dela Cruz",
    booking: "johndc",
    tint: { bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700" },
  },
  {
    name: "Neil Warren",
    booking: "neil-warren-concierge-call",
    tint: { bg: "bg-teal-50", border: "border-teal-200", text: "text-teal-700" },
  },
  {
    name: "Mikha Bechayda",
    booking: "1-on-1-call-with-mikha-ella",
    tint: { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700" },
  },
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

const inputClass =
  "w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/40";

const pillClass = (selected: boolean, mono = false) =>
  `px-3 py-1.5 rounded-lg text-sm border transition-colors ${mono ? "font-mono" : ""} ${
    selected
      ? "bg-primary text-primary-foreground border-primary"
      : "bg-background border-border text-muted-foreground hover:border-foreground/30"
  }`;

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
      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-emerald-700" />
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
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Last Name *</label>
          <input
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputClass}
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
          className={inputClass}
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
              className={pillClass(networks.includes(n))}
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
          className={inputClass}
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
          className={inputClass}
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
              className={pillClass(traffic.includes(t))}
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
              className={pillClass(phase === p)}
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
                  className="mt-1 accent-primary"
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
                className={pillClass(selectedSizes.includes(s), true)}
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
          className={`${inputClass} resize-none`}
        />
      </div>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1 accent-primary"
          required
        />
        <span className="text-sm text-muted-foreground">
          I confirm I have selected no more than {maxTasks} option{maxTasks > 1 ? "s" : ""} from above (24-hour turnaround time). *
        </span>
      </label>

      <Button type="submit" className="gap-2 w-full sm:w-auto">
        <Send className="w-4 h-4" />
        Submit Your Task
      </Button>
    </form>
  );
}

export default function Concierge() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Headphones className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">The BTS Concierge™</h1>
          </div>
          <p className="text-muted-foreground">
            Your personal digital marketing assistants — a team of skilled specialists ready to take work off your plate.
          </p>
        </div>

        <Card className="border-border/60 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="aspect-video bg-black overflow-hidden">
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
          <Button asChild>
            <a href="#task">Submit a Task for the Concierge™</a>
          </Button>
          <Button asChild variant="outline">
            <a href="#call">1-on-1 Call with a VA</a>
          </Button>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5 sm:p-8 md:p-10 space-y-5">
            <h2 className="text-xl font-bold text-foreground">Welcome To The BTS Concierge™</h2>
            <p className="text-muted-foreground leading-relaxed">
              The BTS Concierge™ is one of the most valuable resources available to you as a Build Test Scale member. This service was designed to eliminate bottlenecks, save you time, and give you the professional edge you need to thrive in affiliate marketing.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              This isn't your typical virtual assistant team. These are industry professionals — skilled specialists who are paid premium rates to support our members. Whether you're looking to:
            </p>
            <div className="bg-muted/40 border border-border/60 rounded-xl p-6">
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" /> Build complete landing pages from scratch</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" /> Create animated GIFs for banner ads and landing page hero shots</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" /> Design and deliver high-quality banners</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" /> Connect landing pages to proprietary tools within the portal</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" /> Optimize your campaigns after they've launched</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" /> Get overviews of each proprietary software application in the portal</li>
              </ul>
            </div>
            <p className="text-muted-foreground leading-relaxed">
              Our Concierge team is here to make it happen. These experts are committed to ensuring nothing stands in the way of your success. <strong className="text-foreground">Most tasks are turned around within 24 hours</strong>, depending on complexity.
            </p>
          </CardContent>
        </Card>

        <section id="task">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-5 sm:p-8 md:p-10 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg border border-border/60 bg-muted flex items-center justify-center">
                  <ClipboardList className="w-5 h-5 text-foreground" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Submit A Task For The Concierge™</h2>
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
            <CardContent className="p-5 sm:p-8 md:p-10 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg border border-border/60 bg-muted flex items-center justify-center">
                  <Phone className="w-5 h-5 text-foreground" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">1-on-1 Calls</h2>
                  <p className="text-sm text-muted-foreground">
                    Book a private call with a member of the BTS Concierge™.
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Elevate your productivity with personalized 1-on-1 consultations focused on practical, hands-on assistance. Our team can support you with banner creation, landing page setup, Flexy configuration, MetricMover variations, DIYTrax campaign setup, and much more. Available <strong className="text-foreground">Monday through Saturday</strong>.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                {conciergeMembers.map((member) => (
                  <Card key={member.booking} className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-6 text-center">
                      <div
                        className={`w-16 h-16 rounded-full ${member.tint.bg} ${member.tint.text} border ${member.tint.border} mx-auto mb-3 flex items-center justify-center text-xl font-bold`}
                      >
                        {member.name.split(" ").map((n) => n[0]).join("")}
                      </div>
                      <h3 className="text-sm font-bold text-foreground mb-3">{member.name}</h3>
                      <Button asChild size="sm" className="w-full">
                        <a
                          href={`${FLEXY_BOOKING_BASE}/${member.booking}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Book a Call
                        </a>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppLayout>
  );
}
