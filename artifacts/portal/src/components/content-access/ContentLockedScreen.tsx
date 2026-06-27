import { Lock } from "lucide-react";
import { useLocation } from "wouter";
import { useGetCurrentMember } from "@workspace/api-client-react";
import { isLifetimeSlug } from "@/components/layout/sidebar-nav";
import { UpgradeFeaturesCard } from "@/components/upgrade/UpgradeFeaturesCard";

/**
 * Full-page locked/upgrade screen shown when a member tries to reach a
 * content-access-gated route they are not entitled to.
 *
 * Intentionally NOT a redirect — the user stays at their URL and sees this
 * screen instead of silently bouncing to the dashboard.
 *
 * Reuses UpgradeFeaturesCard (dashboard variant) for the upgrade prompt so
 * locked-page messaging stays visually consistent with the rest of the portal.
 */
export function ContentLockedScreen() {
  const [, navigate] = useLocation();
  const { data: member } = useGetCurrentMember();

  const entitlements = new Set<string>(member?.entitlements ?? []);
  const highestSlug = member?.highestProductSlug ?? "free";
  const hasLifetime = isLifetimeSlug(highestSlug);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 p-8 max-w-2xl mx-auto w-full">
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-7 h-7 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          This page is locked
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your current membership plan does not include access to this content.
          Upgrade to unlock this page and more.
        </p>
      </div>

      <div className="w-full">
        <UpgradeFeaturesCard
          entitlements={entitlements}
          hasLifetime={hasLifetime}
          variant="dashboard"
          sourceTier={member ? highestSlug : null}
          onCtaClick={() => navigate("/plans")}
        />
      </div>
    </div>
  );
}
