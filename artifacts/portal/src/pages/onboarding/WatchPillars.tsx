import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { useAuth } from "@/lib/auth";
import { usePatchOnboardingStep } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";

// Step 6: watch the 7 Pillars training. This is CLIENT-ADVANCEABLE — a simple
// click-to-confirm, no server-side prerequisite check (unlike documents/profile).
export default function OnboardingWatchPillars() {
  const { refreshAuth } = useAuth();
  const patchOnboarding = usePatchOnboardingStep();
  const [, navigate] = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleContinue = async () => {
    setError("");
    setSubmitting(true);
    try {
      await patchOnboarding.mutateAsync({ data: { step: 6 } });
      await refreshAuth();
      navigate("/onboarding/partner-call-pending");
    } catch (err: any) {
      setError(err?.message || "Failed to advance. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OnboardingLayout currentStep={6} onBack={() => navigate("/onboarding/book-partner-call")}>
      <div className="space-y-6">
        <div className="text-center mb-2">
          <h2 className="text-2xl font-bold text-foreground mb-2">Watch the 7 Pillars</h2>
          <p className="text-muted-foreground">
            Before your first call, watch our 7 Pillars training to learn the foundation of the program.
          </p>
        </div>

        <Card>
          <CardContent className="p-6 space-y-4 text-center">
            <div className="w-14 h-14 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-primary" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm14.553 1.106A1 1 0 0017 8v4a1 1 0 00.553.894l2 1A1 1 0 0021 13V7a1 1 0 00-1.447-.894l-2 1z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Head over to the 7 Pillars training to watch it now. When you're done, come back here
              and mark it as complete.
            </p>
            <Link href="/core-training/7-pillars">
              <Button variant="outline">Open the 7 Pillars Training</Button>
            </Link>
          </CardContent>
        </Card>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-center">
          <Button size="lg" onClick={handleContinue} disabled={submitting} className="px-12">
            {submitting ? "Saving..." : "I've watched it — Continue"}
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  );
}
