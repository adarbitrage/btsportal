import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { useAuth } from "@/lib/auth";
import { useGetCurrentMember, usePatchOnboardingStep } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

const WELCOME_VIDEO_URL = "";

export default function OnboardingWelcome() {
  const { user, refreshAuth } = useAuth();
  const { data: member, isLoading } = useGetCurrentMember();
  const [, navigate] = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const patchOnboarding = usePatchOnboardingStep();

  const handleContinue = async () => {
    setSubmitting(true);
    try {
      await patchOnboarding.mutateAsync({ data: { step: 1 } });
      await refreshAuth();
      navigate("/onboarding/documents");
    } catch (err) {
      console.error("Failed to advance step:", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !member) {
    return (
      <OnboardingLayout currentStep={1}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </OnboardingLayout>
    );
  }

  return (
    <OnboardingLayout currentStep={1}>
      <div className="space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-foreground mb-3">
            Welcome, {user?.name?.split(" ")[0]}!
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            We're excited to have you as a member of Build Test Scale. Let's get your account
            set up so you can start making progress right away.
          </p>
        </div>

        {WELCOME_VIDEO_URL && (
          <div className="aspect-video rounded-xl overflow-hidden border border-border bg-black">
            <iframe
              src={WELCOME_VIDEO_URL}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}

        {member.products && member.products.length > 0 && (
          <Card>
            <CardContent className="p-6">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-primary" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0z" />
                </svg>
                Your Products
              </h3>
              <div className="grid gap-3">
                {member.products.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between p-4 bg-secondary/50 rounded-lg border border-border/50"
                  >
                    <div>
                      <p className="font-medium text-foreground">{product.productName}</p>
                      <p className="text-xs text-muted-foreground capitalize">{product.productType} product</p>
                    </div>
                    <Badge variant={product.status === "active" ? "default" : "secondary"}>
                      {product.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex justify-center">
          <Button
            size="lg"
            onClick={handleContinue}
            disabled={submitting}
            className="px-12 py-6 text-lg shadow-lg shadow-primary/20"
          >
            {submitting ? "Setting up..." : "Let's Go!"}
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  );
}
