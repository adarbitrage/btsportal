import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/coaching/StatusPill";
import {
  useGetPartnerRoster,
  useGetPartnerToday,
  type PartnerRosterMentee,
  type PartnerTodayCall,
  type MenteeStatus,
} from "@workspace/api-client-react";
import {
  Users,
  AlertTriangle,
  Video,
  Calendar,
  Clock,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useAuth } from "@/lib/auth";
import { getMemberTimezone, formatMemberDateTime, formatMemberTime } from "@/lib/member-timezone";

// ---------------------------------------------------------------------------
// Admin-viewer support: ?partnerId= lets an admin with partners:view impersonate
// a specific partner's roster/today view (no dropdown yet — deep-link only).
// ---------------------------------------------------------------------------

function usePartnerIdParam(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = new URLSearchParams(window.location.search).get("partnerId");
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return !isNaN(parsed) && parsed > 0 ? parsed : undefined;
}

type Tab = "roster" | "today";

// ---------------------------------------------------------------------------
// Roster row
// ---------------------------------------------------------------------------

function RosterRow({ mentee, timeZone }: { mentee: PartnerRosterMentee; timeZone: string }) {
  return (
    <Link
      href={`/partner/mentees/${mentee.member_id}`}
      className="flex items-center gap-4 px-5 py-4 border-b border-border/50 last:border-0 hover:bg-secondary/30 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-foreground truncate">{mentee.name}</p>
          {mentee.vip && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-violet-700 bg-violet-100 border border-violet-200 rounded px-1.5 py-0.5 shrink-0">
              VIP{mentee.vip_is_lifetime
                ? " · Lifetime"
                : mentee.vip_mentorship_expires_at
                  ? ` · expires ${format(new Date(mentee.vip_mentorship_expires_at), "MMM d, yyyy")}`
                  : ""}
            </span>
          )}
          {mentee.has_concern && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">
              <AlertTriangle className="w-3 h-3" /> Concern
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{mentee.email}</p>
      </div>

      <div className="hidden sm:block w-40 shrink-0">
        <p className="text-sm text-foreground truncate">
          {mentee.current_section ? mentee.current_section.name : "Not started"}
        </p>
        <StatusPill status={mentee.blitz_status as MenteeStatus} />
      </div>

      <div className="hidden md:block w-32 shrink-0 text-sm text-muted-foreground">
        {mentee.cadence_per_week
          ? `${mentee.cadence_per_week}x / week`
          : "No cadence set"}
      </div>

      <div className="hidden lg:block w-44 shrink-0 text-sm text-muted-foreground">
        {mentee.next_call ? (
          <span className="text-foreground">
            Next: {formatMemberDateTime(mentee.next_call.scheduled_at, timeZone)}
          </span>
        ) : (
          "No call scheduled"
        )}
      </div>

      <div className="hidden xl:flex w-40 shrink-0 flex-col gap-0.5 text-xs text-muted-foreground">
        <span>
          {mentee.days_since_last_completed_call === null
            ? "No completed calls"
            : `${mentee.days_since_last_completed_call}d since last call`}
        </span>
        {mentee.consecutive_no_shows > 0 && (
          <span className="text-red-700 font-medium">
            {mentee.consecutive_no_shows} consecutive no-show{mentee.consecutive_no_shows === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Call status badge (booking status, distinct from Blitz MenteeStatus)
// ---------------------------------------------------------------------------

const CALL_STATUS_CLASSES: Record<string, string> = {
  booked: "bg-blue-100 text-blue-800 border-blue-200",
  completed: "bg-green-100 text-green-800 border-green-200",
  canceled: "bg-gray-100 text-gray-600 border-gray-200",
  no_show: "bg-red-100 text-red-800 border-red-200",
};

function CallStatusBadge({ status }: { status: string }) {
  const classes = CALL_STATUS_CLASSES[status] ?? "bg-gray-100 text-gray-600 border-gray-200";
  const label = status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border shrink-0 ${classes}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Today's call row
// ---------------------------------------------------------------------------

function TodayCallRow({ call, timeZone }: { call: PartnerTodayCall; timeZone: string }) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-border/50 last:border-0">
      <div className="w-16 shrink-0 text-center">
        <p className="text-sm font-semibold text-foreground">
          {formatMemberTime(call.scheduled_at, timeZone)}
        </p>
        <p className="text-[10px] text-muted-foreground">{call.duration_minutes}m</p>
      </div>

      <div className="min-w-0 flex-1">
        <Link
          href={`/partner/mentees/${call.member_id}`}
          className="font-medium text-foreground hover:text-primary transition-colors truncate block"
        >
          {call.member_name}
        </Link>
        <p className="text-xs text-muted-foreground truncate">{call.member_email}</p>
      </div>

      <CallStatusBadge status={call.status} />

      {call.meeting_url && (
        <a
          href={call.meeting_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline shrink-0"
        >
          <Video className="w-4 h-4" /> Join <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PartnerDashboard() {
  const partnerId = usePartnerIdParam();
  const [tab, setTab] = useState<Tab>("today");
  const { user } = useAuth();
  const timeZone = getMemberTimezone(user?.timezone);

  const { data: roster, isLoading: rosterLoading, isError: rosterError } = useGetPartnerRoster(
    { partnerId },
    { query: { queryKey: ["partner", "roster", partnerId] } },
  );
  const { data: today, isLoading: todayLoading, isError: todayError } = useGetPartnerToday(
    { partnerId },
    { query: { queryKey: ["partner", "today", partnerId] } },
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Partner Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {partnerId ? "Viewing as admin" : "Your assigned mentees and today's calls"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-white px-4 py-3 text-center shadow-sm">
              <p className="text-xl font-bold text-primary">{roster?.mentees.length ?? "–"}</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Mentees</p>
            </div>
            <div className="rounded-xl border border-border bg-white px-4 py-3 text-center shadow-sm">
              <p className="text-xl font-bold text-primary">{today?.calls.length ?? "–"}</p>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Calls Today</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          <button
            type="button"
            onClick={() => setTab("today")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5
              ${tab === "today" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Clock className="w-4 h-4" /> Today
          </button>
          <button
            type="button"
            onClick={() => setTab("roster")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5
              ${tab === "roster" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Users className="w-4 h-4" /> Roster
          </button>
        </div>

        {tab === "today" && (
          <Card>
            <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">
                {format(new Date(), "EEEE, MMMM d")}
              </h2>
            </div>
            {todayLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading calls…</div>
            ) : todayError ? (
              <div className="p-8 text-center text-destructive text-sm">Couldn't load today's calls.</div>
            ) : !today || today.calls.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No calls scheduled today.</div>
            ) : (
              <div>
                {today.calls.map((call) => (
                  <TodayCallRow key={call.id} call={call} timeZone={timeZone} />
                ))}
              </div>
            )}
          </Card>
        )}

        {tab === "roster" && (
          <Card>
            {rosterLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading roster…</div>
            ) : rosterError ? (
              <div className="p-8 text-center text-destructive text-sm">Couldn't load your roster.</div>
            ) : !roster || roster.mentees.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No mentees assigned yet.</div>
            ) : (
              <div>
                {roster.mentees.map((mentee) => (
                  <RosterRow key={mentee.member_id} mentee={mentee} timeZone={timeZone} />
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
