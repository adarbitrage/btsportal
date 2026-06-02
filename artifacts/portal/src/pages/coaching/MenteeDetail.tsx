import { useParams } from "wouter";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusPill } from "@/components/coaching/StatusPill";
import {
  useGetCoachMenteeDetail,
  type PhaseBreakdown,
  type SectionCompletion,
  type BlitzActivityEvent,
} from "@workspace/api-client-react";
import { ArrowLeft, User, Flame, BookOpen, Clock, CheckCircle2, Circle, MinusCircle } from "lucide-react";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";

// ---------------------------------------------------------------------------
// Phase color accent
// ---------------------------------------------------------------------------

const PHASE_COLORS: Record<string, { bar: string; badge: string }> = {
  intro: { bar: "bg-sky-500",    badge: "bg-sky-100 text-sky-800 border-sky-200" },
  build: { bar: "bg-blue-600",   badge: "bg-blue-100 text-blue-800 border-blue-200" },
  test:  { bar: "bg-violet-600", badge: "bg-violet-100 text-violet-800 border-violet-200" },
  scale: { bar: "bg-emerald-600",badge: "bg-emerald-100 text-emerald-800 border-emerald-200" },
};

function phaseBadgeClass(phase: string) {
  return PHASE_COLORS[phase]?.badge ?? "bg-gray-100 text-gray-700 border-gray-200";
}

function phaseBarClass(phase: string) {
  return PHASE_COLORS[phase]?.bar ?? "bg-primary";
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}

function StatCard({ icon: Icon, label, value, sub }: StatCardProps) {
  return (
    <div className="flex items-center gap-4 bg-white rounded-xl border border-border p-4 shadow-sm">
      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-xl font-bold text-foreground">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity event helpers
// ---------------------------------------------------------------------------

const EVENT_TYPE_LABELS: Record<string, string> = {
  completed:   "Completed",
  viewed:      "Viewed",
  uncompleted: "Uncompleted",
};

function eventTypeLabel(eventType: string) {
  return EVENT_TYPE_LABELS[eventType] ?? eventType.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Section grid status icon
// ---------------------------------------------------------------------------

function SectionStatusIcon({ completed, current }: { completed: boolean; current: boolean }) {
  if (completed) return <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />;
  if (current) return <MinusCircle className="w-4 h-4 text-amber-500 shrink-0" />;
  return <Circle className="w-4 h-4 text-gray-300 shrink-0" />;
}

// ---------------------------------------------------------------------------
// Phase progress bar
// ---------------------------------------------------------------------------

function PhaseProgressRow({ phase }: { phase: PhaseBreakdown }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${phaseBadgeClass(phase.key)}`}>
            {phase.label}
          </span>
          <span className="text-xs text-muted-foreground">
            {phase.completed_sections} / {phase.total_sections} sections
          </span>
        </div>
        <span className="text-sm font-bold text-foreground">{phase.completion_pct}%</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full transition-all duration-500 ease-in-out ${phaseBarClass(phase.key)}`}
          style={{ width: `${phase.completion_pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section grid cell
// ---------------------------------------------------------------------------

function SectionCell({ section, isCurrent }: { section: SectionCompletion; isCurrent: boolean }) {
  return (
    <div
      className={`flex items-start gap-2.5 p-3 rounded-lg border text-sm transition-colors
        ${section.completed
          ? "bg-green-50/50 border-green-200/60"
          : isCurrent
            ? "bg-amber-50/50 border-amber-200/60"
            : "bg-secondary/30 border-border/50"}`}
    >
      <SectionStatusIcon completed={section.completed} current={isCurrent} />
      <div className="min-w-0">
        <p className={`font-medium leading-snug truncate ${section.completed ? "text-foreground" : isCurrent ? "text-amber-900" : "text-muted-foreground"}`}>
          {section.step}
        </p>
        <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{section.name}</p>
        {section.completed && section.completed_at && (
          <p className="text-[10px] text-green-700 mt-1">
            {format(new Date(section.completed_at), "MMM d, yyyy")}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity event row
// ---------------------------------------------------------------------------

function ActivityEventRow({ event }: { event: BlitzActivityEvent }) {
  return (
    <li className="flex items-start gap-4 px-6 py-3 border-b border-border/50 last:border-0 hover:bg-secondary/30 transition-colors">
      <div className="w-2 h-2 rounded-full bg-primary/40 shrink-0 mt-2" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          {eventTypeLabel(event.eventType)}{event.name ? `: ${event.name}` : ""}
        </p>
        {event.phase && (
          <p className="text-xs text-muted-foreground mt-0.5">{event.phase}</p>
        )}
      </div>
      <time className="text-xs text-muted-foreground shrink-0 mt-0.5">
        {formatDistanceToNow(new Date(event.occurredAt), { addSuffix: true })}
      </time>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MenteeDetail() {
  const params = useParams<{ userId: string }>();
  const userId = parseInt(params.userId ?? "", 10);

  const validUserId = !isNaN(userId) && userId > 0 ? userId : null;

  const { data: mentee, isLoading, isError } = useGetCoachMenteeDetail(
    validUserId ?? 0,
    { query: { queryKey: ["coach", "mentee", validUserId], enabled: validUserId !== null } },
  );

  if (validUserId === null) {
    return (
      <AppLayout>
        <p className="text-destructive">Invalid mentee ID.</p>
      </AppLayout>
    );
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4 animate-pulse">
          <div className="h-8 bg-card rounded w-48" />
          <div className="h-32 bg-card rounded-xl" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-card rounded-xl" />)}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (isError || !mentee) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border">
          <h2 className="text-xl font-semibold">Mentee not found</h2>
          <p className="text-muted-foreground mt-2">This account may not exist or is not a member.</p>
          <Link href="/coach/dashboard">
            <a className="inline-flex items-center gap-1 mt-4 text-primary text-sm hover:underline">
              <ArrowLeft className="w-4 h-4" /> Back to dashboard
            </a>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const daysSinceActive = mentee.last_active_at
    ? differenceInDays(new Date(), new Date(mentee.last_active_at))
    : null;

  const firstIncompleteId = mentee.section_completion.find((s: SectionCompletion) => !s.completed)?.section_id ?? null;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Back link */}
        <Link href="/coach/dashboard">
          <a className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Coach Dashboard
          </a>
        </Link>

        {/* Header card */}
        <div className="bg-white rounded-2xl border border-border p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{mentee.name}</h1>
              <p className="text-muted-foreground text-sm">{mentee.email}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs bg-secondary border border-border rounded px-2 py-0.5 font-mono">
                  {mentee.tier_name}
                </span>
                <StatusPill status={mentee.status} />
              </div>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            Member since {format(new Date(mentee.joined_at), "MMMM d, yyyy")}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={BookOpen}
            label="Completion"
            value={`${mentee.blitz_completion_pct}%`}
            sub={`${mentee.section_completion.filter((s: SectionCompletion) => s.completed).length} / ${mentee.section_completion.length} sections`}
          />
          <StatCard
            icon={MinusCircle}
            label="Current Section"
            value={mentee.current_section ? `Step ${mentee.current_section.id}` : "Not started"}
            sub={mentee.current_section?.name ?? undefined}
          />
          <StatCard
            icon={Flame}
            label="Daily Streak"
            value={`${mentee.daily_streak} day${mentee.daily_streak !== 1 ? "s" : ""}`}
          />
          <StatCard
            icon={Clock}
            label="Last Active"
            value={mentee.last_active_at
              ? formatDistanceToNow(new Date(mentee.last_active_at), { addSuffix: true })
              : "Never"}
            sub={daysSinceActive !== null ? `${daysSinceActive} days ago` : undefined}
          />
        </div>

        {/* Phase progress */}
        <Card>
          <CardHeader className="pb-3 border-b border-border/50">
            <h2 className="text-base font-semibold text-foreground">Phase Progress</h2>
          </CardHeader>
          <CardContent className="pt-5 space-y-5">
            {mentee.phase_breakdown.map((phase: PhaseBreakdown) => (
              <PhaseProgressRow key={phase.key} phase={phase} />
            ))}
          </CardContent>
        </Card>

        {/* Section-by-section grid */}
        <Card>
          <CardHeader className="pb-3 border-b border-border/50">
            <h2 className="text-base font-semibold text-foreground">Section Breakdown</h2>
            <p className="text-xs text-muted-foreground mt-0.5">All 23 Blitz sections</p>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {mentee.section_completion.map((section: SectionCompletion) => (
                <SectionCell
                  key={section.section_id}
                  section={section}
                  isCurrent={section.section_id === firstIncompleteId}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Activity timeline */}
        <Card>
          <CardHeader className="pb-3 border-b border-border/50">
            <h2 className="text-base font-semibold text-foreground">Recent Activity</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Last 20 events</p>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            {mentee.recent_events.length === 0 ? (
              <p className="px-6 py-8 text-center text-muted-foreground text-sm">No activity recorded yet.</p>
            ) : (
              <ol className="relative">
                {mentee.recent_events.map((event: BlitzActivityEvent, idx: number) => (
                  <ActivityEventRow key={`${event.courseId}-${idx}`} event={event} />
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
