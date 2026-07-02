import { format } from "date-fns";
import { Video, Users, PhoneCall } from "lucide-react";
import { useTodayCallBooking } from "@/lib/call-bookings-api";

export function CallDayBanner() {
  const { data } = useTodayCallBooking();
  const booking = data?.booking ?? null;

  if (!booking) return null;

  const isKickoff = booking.type === "kickoff";
  const label = isKickoff ? "Kickoff Call" : "Accountability Partner Call";
  const Icon = isKickoff ? PhoneCall : Users;

  return (
    <div
      className="w-full bg-primary text-primary-foreground px-4 py-3 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-sm font-medium"
      data-testid="call-day-banner"
    >
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 shrink-0" />
        <span>
          Today's {label} is at {format(new Date(booking.scheduledAt), "h:mm a")}
        </span>
      </div>
      {booking.meetingUrl && (
        <a
          href={booking.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 transition-colors rounded-full px-3 py-1"
        >
          <Video className="w-3.5 h-3.5" />
          Join Call
        </a>
      )}
    </div>
  );
}
