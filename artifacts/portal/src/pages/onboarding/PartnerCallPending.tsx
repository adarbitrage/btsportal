import { OnboardingLayout, getOnboardingRouteForStep } from "@/components/onboarding/OnboardingLayout";
import { PartnerRevealCard } from "@/components/onboarding/PartnerRevealCard";
import { useAuth } from "@/lib/auth";
import { usePartnerInfo } from "@/lib/call-bookings-api";
import { useLocation, Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";

// "partner_call_completed": full-tier only, waiting on the first partner call
// to actually happen. EVENT-ADVANCED: only completeOnboardingAfterPartnerCallDone()
// (server-side, triggered by the GHL webhook once the call is confirmed)
// completes onboarding from here — there is no client PATCH for this step.
// LaunchPad members have no such step at all (their onboarding completes
// right after pillars_watched) — this page should never be reachable for them.
export default function OnboardingPartnerCallPending() {
  const { user, refreshAuth } = useAuth();
  const { data: partnerInfo } = usePartnerInfo();
  const partner = partnerInfo?.partner ?? null;
  const [, navigate] = useLocation();
  const [checking, setChecking] = useState(false);

  const handleCheckStatus = async () => {
    setChecking(true);
    try {
      await refreshAuth();
    } finally {
      setChecking(false);
    }
  };

  if (user?.onboardingVariant === "launchpad") {
    return <Redirect to={getOnboardingRouteForStep(user.onboardingStep || 1, user.onboardingVariant)} />;
  }

  return (
    <OnboardingLayout stepName="partner_call_completed" onBack={() => navigate("/onboarding/pillars")}>
      <div className="space-y-6">
        <div className="text-center mb-2">
          <h2 className="text-2xl font-bold text-foreground mb-2">Almost There!</h2>
          <p className="text-muted-foreground">
            You're all set up — just complete your first partner call to unlock the full member portal, including Blitz.
          </p>
        </div>

        {partner && <PartnerRevealCard partner={partner} />}

        <Card>
          <CardContent className="p-6 space-y-4 text-center">
            <div className="w-14 h-14 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-primary" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Once your call is complete, onboarding wraps up automatically and you'll be dropped
              into Blitz. Nothing else to do here — check back after your call if this page doesn't move on its own.
            </p>
            <Button variant="outline" onClick={handleCheckStatus} disabled={checking}>
              {checking ? "Checking..." : "Check status"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </OnboardingLayout>
  );
}
