import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { PartnerRevealCard } from "@/components/onboarding/PartnerRevealCard";
import { useAuth } from "@/lib/auth";
import { usePatchOnboardingStep, useGetOnboardingSendOff } from "@workspace/api-client-react";
import { usePartnerInfo } from "@/lib/call-bookings-api";
import { resolveCoachPhotoUrl } from "@/lib/coaches-admin-api";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Small null-graceful avatar for a "Your Booked Calls" recap card (Task
// #1696), matching the sidebar next-call panel's one-card-per-call look.
function CallAvatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const resolved = resolveCoachPhotoUrl(photoUrl);
  if (resolved) {
    return <img src={resolved} alt={name} className="w-9 h-9 rounded-full object-cover shrink-0" />;
  }
  return (
    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
      {initials(name)}
    </div>
  );
}

// "send_off" (Task #1666): the LAST step for both variants — LAUNCHPAD (4)
// and FULL (5). Replaces the old pillars_watched + partner_call_completed
// steps entirely. CLIENT-ADVANCEABLE: the single CTA here completes
// onboarding directly for both variants (no more webhook-driven completion).
// The server's validateStepPrerequisites still checks that the member has a
// booked kickoff call (and, for "full", a booked partner call) on file
// before allowing this PATCH to succeed.
export default function OnboardingSendOffPage() {
  const { user, refreshAuth } = useAuth();
  const patchOnboarding = usePatchOnboardingStep();
  const { data: partnerInfo } = usePartnerInfo();
  const { data: sendOff, isLoading } = useGetOnboardingSendOff();
  const partner = partnerInfo?.partner ?? null;
  const [, navigate] = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isLaunchpad = user?.onboardingVariant === "launchpad";
  const thisStep = isLaunchpad ? 4 : 5;

  const handleBack = () => {
    navigate(isLaunchpad ? "/onboarding/book-kickoff" : "/onboarding/book-partner-call");
  };

  const handleContinue = async () => {
    setError("");
    setSubmitting(true);
    try {
      await patchOnboarding.mutateAsync({ data: { step: thisStep } });
      await refreshAuth();
      navigate("/core-training/7-pillars");
    } catch (err: any) {
      setError(err?.message || "Failed to complete onboarding. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OnboardingLayout stepName="send_off" onBack={handleBack}>
      <div className="space-y-6">
        <div className="text-center mb-2">
          <h2 className="text-2xl font-bold text-foreground mb-2">You're All Set!</h2>
          <p className="text-muted-foreground">
            Here's a quick recap of what's booked and what's next.
          </p>
        </div>

        {partner && <PartnerRevealCard partner={partner} />}

        {isLoading ? (
          <div className="animate-pulse h-40 bg-card rounded-xl" />
        ) : (
          <>
            {sendOff?.videoUrl && (
              <div className="aspect-video rounded-xl overflow-hidden border border-border bg-black">
                <iframe
                  src={sendOff.videoUrl}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}

            <Card>
              <CardContent className="p-6 space-y-4">
                <h3 className="font-semibold text-foreground">Your Booked Calls</h3>

                {sendOff?.kickoff ? (
                  <div className="flex items-start gap-3 p-4 bg-secondary/50 rounded-lg border border-border/50">
                    <CallAvatar name={sendOff.kickoff.coachName} photoUrl={sendOff.kickoff.photoUrl} />
                    <div>
                      <p className="font-medium text-foreground">Kickoff Call with {sendOff.kickoff.coachName}</p>
                      <p className="text-sm text-muted-foreground">
                        {sendOff.kickoff.date} at {sendOff.kickoff.time}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No kickoff call on file.</p>
                )}

                {!isLaunchpad &&
                  (sendOff?.partnerCall ? (
                    <div className="flex items-start gap-3 p-4 bg-secondary/50 rounded-lg border border-border/50">
                      <CallAvatar name={sendOff.partnerCall.coachName} photoUrl={sendOff.partnerCall.photoUrl} />
                      <div>
                        <p className="font-medium text-foreground">
                          Partner Call with {sendOff.partnerCall.coachName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {sendOff.partnerCall.date} at {sendOff.partnerCall.time}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No partner call on file.</p>
                  ))}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  You'll get a confirmation email now, another email reminder 24 hours before each call,
                  and a text message 1 hour before it starts. You can always find your booked calls under
                  Coaching in the portal.
                </p>
              </CardContent>
            </Card>
          </>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
        )}

        <div className="flex justify-center">
          <Button size="lg" onClick={handleContinue} disabled={submitting} className="px-12">
            {submitting ? "Saving..." : "Start with the 7 Pillars \u2192"}
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  );
}
