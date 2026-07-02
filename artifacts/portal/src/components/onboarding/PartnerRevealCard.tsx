import { resolveCoachPhotoUrl } from "@/lib/coaches-admin-api";
import type { StaffProfile } from "@/lib/call-bookings-api";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Reveal card for the member's accountability partner. Shown from the moment
// the partner call is booked (step 5) through steps 6-7, so the partner's
// face becomes a familiar, reassuring presence for the rest of onboarding.
export function PartnerRevealCard({ partner, subtitle }: { partner: StaffProfile; subtitle?: string }) {
  return (
    <div className="flex items-center justify-center gap-3" data-testid="partner-reveal-card">
      {partner.photoUrl ? (
        <img
          src={resolveCoachPhotoUrl(partner.photoUrl) ?? undefined}
          alt={partner.displayName}
          className="w-12 h-12 rounded-full object-cover"
        />
      ) : (
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
          {initials(partner.displayName)}
        </div>
      )}
      <div className="text-left">
        <p className="font-semibold text-foreground">{partner.displayName}</p>
        <p className="text-xs text-muted-foreground">{subtitle ?? "Your accountability partner"}</p>
      </div>
    </div>
  );
}
