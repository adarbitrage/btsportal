import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";

// Placeholder for the "book your kickoff call" step. This step is
// EVENT-ADVANCED: only advanceOnboardingAfterKickoffBooked() (server-side,
// called from the real booking flow) can move a member past it — there is no
// client PATCH that completes this step. The real booking UI is built
// separately; this page exists so the 7-step flow stays walkable in the
// meantime, and it doubles as the waiting screen while a booking is pending.
export default function OnboardingBookKickoff() {
  const { refreshAuth } = useAuth();
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

  return (
    <OnboardingLayout currentStep={4} onBack={() => navigate("/onboarding/profile")}>
      <div className="space-y-6">
        <div className="text-center mb-2">
          <h2 className="text-2xl font-bold text-foreground mb-2">Book Your Kickoff Call</h2>
          <p className="text-muted-foreground">
            The next step is scheduling a quick kickoff call with your coach to map out your plan.
          </p>
        </div>

        <Card>
          <CardContent className="p-6 space-y-4 text-center">
            <div className="w-14 h-14 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-primary" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm10 6H4v8h12V8z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Booking is coming right here shortly. Once your kickoff call is on the calendar,
              you'll automatically move on to the next step — no need to do anything else.
            </p>
            <Button variant="outline" onClick={handleCheckStatus} disabled={checking}>
              {checking ? "Checking..." : "I've already booked — check status"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </OnboardingLayout>
  );
}
