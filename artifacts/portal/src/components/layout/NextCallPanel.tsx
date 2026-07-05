import { PhoneCall, Users, Video, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { useNextCallBooking, usePartnerPanel } from "@/lib/call-bookings-api";
import { getMemberTimezone, formatMemberDateTime, isMemberToday } from "@/lib/member-timezone";
import { resolveCoachPhotoUrl } from "@/lib/coaches-admin-api";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Persistent "next booked call" panel (Task #1688). Source of truth is
// /call-bookings/next — the member's soonest booked call across BOTH
// kickoff and partner types, independent of partner assignment. This is
// what makes a LaunchPad member's kickoff call visible everywhere even
// though they have no accountability-partner assignment (usePartnerPanel
// alone would render nothing for them).
//
// Mounted once in the shared sidebar so it appears on every portal page,
// not just the Dashboard. Renders nothing when there is neither an
// upcoming booked call nor an active partner assignment — no empty frame.
export function NextCallPanel() {
  const { user } = useAuth();
  const { data: nextCallData, isLoading: callLoading } = useNextCallBooking();
  const { data: partnerData, isLoading: partnerLoading } = usePartnerPanel();

  if (callLoading || partnerLoading) return null;

  const call = nextCallData?.call ?? null;
  const assignment = partnerData?.assignment ?? null;

  if (!call && !assignment) return null;

  const timeZone = getMemberTimezone(user?.timezone);

  // The headline name/photo is whoever the next CALL is with (kickoff coach
  // or partner). If there's no upcoming call at all, fall back to the
  // assigned partner so the relationship still has a face. This is
  // deliberately separate from the "relationship line" below — a member
  // could have an upcoming KICKOFF call and a separately-assigned partner
  // at the same time, and the relationship line must always name the real
  // partner rather than whichever staff member the headline happens to show.
  const displayName = call?.staff?.displayName ?? assignment?.partner.displayName ?? null;
  const photoUrl = call?.staff?.photoUrl ?? assignment?.partner.photoUrl ?? null;
  const isKickoff = call?.type === "kickoff";
  const callLabel = isKickoff ? "Kickoff Call" : "Accountability Partner Call";
  const Icon = isKickoff ? PhoneCall : Users;
  const isToday = call ? isMemberToday(call.scheduledAt, timeZone) : false;

  // Only show a separate relationship line when the headline above isn't
  // already the partner (i.e. no call, or the call is a kickoff call).
  const showSeparatePartnerLine = !!assignment && (!call || call.type !== "partner");

  return (
    <Card data-testid="next-call-panel" className="mx-3 mb-4">
      <CardContent className="p-4 space-y-3">
        {displayName && (
          <div className="flex items-center gap-3">
            {photoUrl ? (
              <img
                src={resolveCoachPhotoUrl(photoUrl) ?? undefined}
                alt={displayName}
                className="w-10 h-10 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                {initials(displayName)}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
              {assignment && !showSeparatePartnerLine && (
                <p className="text-xs text-muted-foreground truncate" data-testid="next-call-panel-partner-line">
                  Your Accountability Partner
                  {assignment.cadencePerWeek ? ` · ${assignment.cadencePerWeek}x per week` : ""}
                </p>
              )}
            </div>
          </div>
        )}

        {showSeparatePartnerLine && assignment && (
          <p className="text-xs text-muted-foreground" data-testid="next-call-panel-partner-line">
            Your Accountability Partner: <span className="font-medium text-foreground">{assignment.partner.displayName}</span>
            {assignment.cadencePerWeek ? ` · ${assignment.cadencePerWeek}x per week` : ""}
          </p>
        )}

        {call && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{callLabel}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span data-testid="next-call-panel-datetime">{formatMemberDateTime(call.scheduledAt, timeZone)}</span>
            </div>
            {call.meetingUrl && (
              <a
                href={call.meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="next-call-panel-join-link"
                className={cn(
                  "inline-flex items-center gap-1.5 w-full justify-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  isToday
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-secondary text-foreground hover:bg-secondary/80",
                )}
              >
                <Video className="w-3.5 h-3.5" />
                {isToday ? "Join Call Now" : "Join Call"}
              </a>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
