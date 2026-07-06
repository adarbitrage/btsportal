import { PhoneCall, Users, Video, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { useNextCallBooking, usePartnerPanel, type NextCall } from "@/lib/call-bookings-api";
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

function CallCard({ call, timeZone }: { call: NextCall; timeZone: string }) {
  const isKickoff = call.type === "kickoff";
  const displayName = call.staff?.displayName ?? null;
  const photoUrl = call.staff?.photoUrl ?? null;
  const callLabel = isKickoff ? "Kickoff Call" : "Accountability Call";
  const title = displayName ? `${callLabel} with ${displayName}` : callLabel;
  const Icon = isKickoff ? PhoneCall : Users;
  const isToday = isMemberToday(call.scheduledAt, timeZone);

  return (
    <Card data-testid="next-call-panel-card" className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          {photoUrl ? (
            <img
              src={resolveCoachPhotoUrl(photoUrl) ?? undefined}
              alt={displayName ?? callLabel}
              className="w-10 h-10 rounded-full object-cover shrink-0"
            />
          ) : displayName ? (
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
              {initials(displayName)}
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Icon className="w-4 h-4" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{title}</p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              <span data-testid="next-call-panel-datetime">{formatMemberDateTime(call.scheduledAt, timeZone)}</span>
            </div>
          </div>
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
      </CardContent>
    </Card>
  );
}

// Persistent "next booked calls" panel (Task #1688, redesigned in #1696).
// Source of truth is /call-bookings/next — EVERY upcoming booked call across
// BOTH kickoff and partner types, independent of partner assignment. This is
// what makes a LaunchPad member's kickoff call visible everywhere even
// though they have no accountability-partner assignment (usePartnerPanel
// alone would render nothing for them), and what lets a member with BOTH a
// kickoff call AND an accountability call see one clearly-labeled card per
// call instead of a single panel that conflates the two people.
//
// Mounted once in the shared sidebar so it appears on every portal page,
// not just the Dashboard. Renders nothing when there is neither an
// upcoming booked call nor an active partner assignment — no empty frame.
export function NextCallPanel() {
  const { user } = useAuth();
  const { data: nextCallData, isLoading: callLoading } = useNextCallBooking();
  const { data: partnerData, isLoading: partnerLoading } = usePartnerPanel();

  if (callLoading || partnerLoading) return null;

  const calls = nextCallData?.calls ?? [];
  const assignment = partnerData?.assignment ?? null;

  if (calls.length === 0 && !assignment) return null;

  const timeZone = getMemberTimezone(user?.timezone);

  // The context line below the cards only ever names the partner — it must
  // never appear when one of the cards already IS the partner call, or the
  // relationship gets named twice on screen.
  const hasPartnerCard = calls.some((c) => c.type === "partner");
  const showPartnerLine = !!assignment && !hasPartnerCard;

  return (
    <div className="mx-3 mb-4 space-y-3" data-testid="next-call-panel">
      {calls.map((call) => (
        <CallCard key={`${call.type}-${call.scheduledAt}`} call={call} timeZone={timeZone} />
      ))}

      {showPartnerLine && assignment && (
        <p className="text-xs text-muted-foreground px-1" data-testid="next-call-panel-partner-line">
          Your accountability partner:{" "}
          <span className="font-medium text-foreground">{assignment.partner.displayName}</span>
        </p>
      )}
    </div>
  );
}
