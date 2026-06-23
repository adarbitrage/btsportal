import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Headphones, CheckCircle2, Send,
  ClipboardList, Phone, AlertCircle,
  Calendar, Clock, Video, Lock, CalendarClock, X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { isAdminRole, isCoachRole } from "@workspace/auth";
import { useGetCurrentMember } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { resolveCoachPhotoUrl } from "@/lib/coaches-admin-api";
import {
  useMyVaCalls,
  useCancelVaCall,
  type VaCall,
} from "@/lib/va-calls-api";

const API_BASE = `${import.meta.env.BASE_URL}api`;

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

type SubmitResult =
  | { kind: "success"; ticketNumber: string; confirmationEmailSent: boolean }
  | { kind: "error"; message: string };

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
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const toggleItem = (list: string[], setList: (v: string[]) => void, item: string) => {
    setList(list.includes(item) ? list.filter((i) => i !== item) : [...list, item]);
  };

  const phaseTasks = phase === '"Build" Phase' ? buildTasks
    : phase === '"Test" Phase' ? testTasks
    : phase === '"Scale" Phase' ? scaleTasks
    : [];

  const maxTasks = phase === '"Build" Phase' ? 2 : 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/tickets/concierge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName, lastName, email,
          networks, offerName, offerUrl,
          traffic, phase, selectedTasks, selectedSizes,
          otherInfo,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = typeof data?.error === "string" ? data.error : "Failed to submit. Please try again.";
        setResult({ kind: "error", message: msg });
        return;
      }
      const data = await res.json();
      setResult({
        kind: "success",
        ticketNumber: data.ticketNumber,
        confirmationEmailSent: data.confirmationEmailSent !== false,
      });
    } catch {
      setResult({ kind: "error", message: "Network error. Please check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  };

  if (result?.kind === "success") {
    return (
      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-emerald-700" />
          </div>
          <h3 className="text-xl font-bold text-foreground">Task Submitted!</h3>
          <p className="text-muted-foreground">
            Your request has been received and logged under reference{" "}
            <span className="font-mono font-semibold text-foreground" data-testid="text-ticket-number">{result.ticketNumber}</span>.
            Our BTS Concierge™ team will get back to you within 24–72 hours.
            {result.confirmationEmailSent ? " Check your email for a confirmation." : ""}
          </p>
          {!result.confirmationEmailSent && (
            <div
              className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 text-left"
              data-testid="alert-confirmation-email-failed"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
              <p>
                Your request was logged successfully, but we couldn't send a confirmation email
                right now. No need to resubmit — note your reference number above, and our team
                will still receive your request.
              </p>
            </div>
          )}
          <Button
            onClick={() => {
              setResult(null);
              setFirstName(""); setLastName(""); setEmail(""); setNetworks([]);
              setOfferName(""); setOfferUrl(""); setTraffic([]); setPhase("");
              setSelectedTasks([]); setSelectedSizes([]); setOtherInfo(""); setConfirmed(false);
            }}
            variant="outline"
            className="mt-4"
          >
            Submit Another Task
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {result?.kind === "error" && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
          <p>{result.message}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">First Name *</label>
          <input
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClass}
            data-testid="input-first-name"
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
            data-testid="input-last-name"
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
          data-testid="input-email"
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
          data-testid="input-offer-name"
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
          data-testid="input-offer-url"
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
          data-testid="checkbox-confirm"
        />
        <span className="text-sm text-muted-foreground">
          I confirm I have selected no more than {maxTasks} option{maxTasks > 1 ? "s" : ""} from above (24-hour turnaround time). *
        </span>
      </label>

      <Button type="submit" className="gap-2 w-full sm:w-auto" isLoading={submitting} disabled={submitting} data-testid="button-submit">
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
          <Button asChild>
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
              Our Concierge team is here to make it happen. These experts are committed to ensuring nothing stands in the way of your success. <strong className="text-foreground">Most tasks are turned around within 24-72 hours</strong>, depending on complexity.
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
                    Fill out the form below and let us know how we can assist. Turnaround time: 24-72 hours.
                  </p>
                </div>
              </div>
              <ConciergeForm />
            </CardContent>
          </Card>
        </section>

        <ConciergeCallSection />
      </div>
    </AppLayout>
  );
}

function VaCallRow({ call }: { call: VaCall }) {
  const { toast } = useToast();
  const cancelCall = useCancelVaCall();
  const photo = resolveCoachPhotoUrl(call.coachPhotoUrl);
  const scheduled = new Date(call.scheduledAt);
  const isUpcoming = call.status === "booked" && scheduled.getTime() > Date.now();

  const handleCancel = async () => {
    try {
      await cancelCall.mutateAsync({ bookingId: call.id });
      toast({ title: "Call cancelled", description: "Your 1-on-1 VA call has been cancelled." });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not cancel",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {photo ? (
          <img
            src={photo}
            alt={call.coachName}
            className="w-12 h-12 rounded-full object-cover border border-border/60 shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-muted text-foreground border border-border/60 shrink-0 flex items-center justify-center text-sm font-bold">
            {call.coachName.split(" ").map((n) => n[0]).join("")}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground truncate">{call.coachName}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {format(scheduled, "EEE, MMM d, yyyy")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {format(scheduled, "h:mm a")} · {call.durationMinutes} min
            </span>
          </div>
          {call.discussionTopic && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              <span className="font-medium text-foreground">Topic:</span> {call.discussionTopic}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isUpcoming ? (
          <>
            {call.meetLink && (
              <Button asChild size="sm" variant="default">
                <a href={call.meetLink} target="_blank" rel="noopener noreferrer">
                  <Video className="w-4 h-4 mr-1.5" />
                  Join
                </a>
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href={`/concierge/book-va-call?reschedule=${call.id}`}>
                <CalendarClock className="w-4 h-4 mr-1.5" />
                Reschedule
              </Link>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                  <X className="w-4 h-4 mr-1.5" />
                  Cancel
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this call?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your 1-on-1 VA call with {call.coachName} on{" "}
                    {format(scheduled, "EEE, MMM d 'at' h:mm a")} will be cancelled. You can book
                    another one any time.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep call</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleCancel}
                    disabled={cancelCall.isPending}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {cancelCall.isPending ? "Cancelling..." : "Cancel call"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <span className="text-xs font-medium text-muted-foreground capitalize">
            {call.status === "booked" ? "completed" : call.status}
          </span>
        )}
      </div>
    </div>
  );
}

function ConciergeCallSection() {
  const { user } = useAuth();
  const { data: member } = useGetCurrentMember();
  const isAdmin = isAdminRole(user?.role) || isAdminRole(member?.role);
  const isCoach = isCoachRole(user?.role) || isCoachRole(member?.role);
  const entitlements = new Set(member?.entitlements ?? []);
  const eligible = isAdmin || isCoach || entitlements.has("coaching:group");

  const { data: calls, isLoading } = useMyVaCalls({ enabled: eligible });
  const now = Date.now();
  const upcoming = (calls ?? [])
    .filter((c) => c.status === "booked" && new Date(c.scheduledAt).getTime() > now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const past = (calls ?? [])
    .filter((c) => !(c.status === "booked" && new Date(c.scheduledAt).getTime() > now))
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  return (
    <section id="call">
      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-5 sm:p-8 md:p-10 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg border border-border/60 bg-muted flex items-center justify-center">
              <Phone className="w-5 h-5 text-foreground" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">1-on-1 VA Calls</h2>
              <p className="text-sm text-muted-foreground">
                Book a free 30-minute private call with a member of the BTS Concierge™.
              </p>
            </div>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Elevate your productivity with personalized 1-on-1 consultations focused on practical, hands-on assistance. Our team can support you with banner creation, landing page setup, Flexy configuration, MetricMover variations, DIYTrax campaign setup, and much more. Available <strong className="text-foreground">Monday through Saturday</strong>.
          </p>

          {!eligible ? (
            <div className="rounded-lg border border-border/60 bg-muted/40 p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-muted border border-border/60 mx-auto flex items-center justify-center">
                <Lock className="w-5 h-5 text-muted-foreground" />
              </div>
              <h3 className="text-base font-bold text-foreground">Full membership required</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Free 1-on-1 VA calls are included with full BTS memberships. Upgrade your membership to book a call with the Concierge™ team.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-border/60 bg-muted/40 p-5">
                <div>
                  <h3 className="text-base font-bold text-foreground">Ready to book?</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose a VA, pick a time, and you're set — completely free.
                  </p>
                </div>
                <Button asChild size="lg" className="shrink-0">
                  <Link href="/concierge/book-va-call">
                    <Phone className="w-4 h-4 mr-2" />
                    Book a 1-on-1 VA Call
                  </Link>
                </Button>
              </div>

              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading your calls…</p>
              ) : (
                <>
                  {upcoming.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-foreground">Upcoming calls</h3>
                      <div className="space-y-3">
                        {upcoming.map((call) => (
                          <VaCallRow key={call.id} call={call} />
                        ))}
                      </div>
                    </div>
                  )}

                  {past.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-foreground">Past calls</h3>
                      <div className="space-y-3">
                        {past.map((call) => (
                          <VaCallRow key={call.id} call={call} />
                        ))}
                      </div>
                    </div>
                  )}

                  {upcoming.length === 0 && past.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      You have no VA calls yet. Book your first one above.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
