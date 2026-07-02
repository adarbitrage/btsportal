import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";

// Placeholder for "book your first accountability partner call". EVENT-
// ADVANCED: only advanceOnboardingAfterPartnerCallBooked() (server-side,
// called from the real booking flow) can move a member past this step. Real
// booking UI is built separately; this page keeps the 7-step flow walkable
// and doubles as the waiting screen while a booking is pending.
export default function OnboardingBookPartnerCall() {
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
    <OnboardingLayout currentStep={5} onBack={() => navigate("/onboarding/book-kickoff")}>
      <div className="space-y-6">
        <div className="text-center mb-2">
          <h2 className="text-2xl font-bold text-foreground mb-2">Book Your First Partner Call</h2>
          <p className="text-muted-foreground">
            Next up, schedule your first call with an accountability partner to keep you on track.
          </p>
        </div>

        <Card>
          <CardContent className="p-6 space-y-4 text-center">
            <div className="w-14 h-14 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-primary" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Booking is coming right here shortly. Once your first partner call is on the
              calendar, you'll automatically move on to the next step — no need to do anything else.
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
