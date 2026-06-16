import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { useAuth } from "@/lib/auth";
import {
  useGetCurrentMember,
  usePatchOnboardingStep,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";

interface OrientationItem {
  entitlementKey: string;
  title: string;
  description: string;
  icon: string;
}

const ORIENTATION_ITEMS: OrientationItem[] = [
  {
    entitlementKey: "content:frontend",
    title: "Training Library",
    description: "Access foundational video and text training modules covering affiliate marketing fundamentals.",
    icon: "📚",
  },
  {
    entitlementKey: "content:advanced",
    title: "Advanced Training",
    description: "Pre-recorded advanced strategies including campaign optimization and scaling techniques.",
    icon: "🎓",
  },
  {
    entitlementKey: "software:base",
    title: "Software Tools",
    description: "Access to the base software and tool suite to help you build and test campaigns.",
    icon: "🛠️",
  },
  {
    entitlementKey: "software:expanded",
    title: "Expanded Tools",
    description: "Full expanded software suite including advanced automation and analytics tools.",
    icon: "⚡",
  },
  {
    entitlementKey: "coaching:group",
    title: "Group Coaching",
    description: "Live group coaching calls with experienced coaches covering strategy and Q&A.",
    icon: "👥",
  },
  {
    entitlementKey: "coaching:mastermind",
    title: "Mastermind Sessions",
    description: "Advanced mastermind sessions with small groups for deep-dive strategy discussions.",
    icon: "🧠",
  },
  {
    entitlementKey: "community:access",
    title: "Community Access",
    description: "Connect with fellow members, share wins, and collaborate in our private community.",
    icon: "🤝",
  },
  {
    entitlementKey: "chat:basic",
    title: "AI Assistant",
    description: "AI-powered chat assistant to help answer questions and guide your learning.",
    icon: "🤖",
  },
  {
    entitlementKey: "chat:full",
    title: "Full AI Access",
    description: "Unrestricted AI assistant with advanced capabilities and full knowledge base access.",
    icon: "✨",
  },
  {
    entitlementKey: "support:basic",
    title: "Support",
    description: "Access to our support team for billing, technical, and account questions.",
    icon: "🎧",
  },
];

export default function OnboardingOrientation() {
  const { refreshAuth } = useAuth();
  const { data: member, isLoading } = useGetCurrentMember();
  const patchOnboarding = usePatchOnboardingStep();
  const [, navigate] = useLocation();
  const [submitting, setSubmitting] = useState(false);

  const handleContinue = async () => {
    setSubmitting(true);
    try {
      await patchOnboarding.mutateAsync({ data: { step: 4 } });
      await refreshAuth();
      navigate("/onboarding/quick-start");
    } catch (err) {
      console.error("Failed to advance step:", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !member) {
    return (
      <OnboardingLayout currentStep={4} onBack={() => navigate("/onboarding/profile")}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </OnboardingLayout>
    );
  }

  const entitlements = new Set(member.entitlements || []);

  const ownedItems = ORIENTATION_ITEMS.filter((item) => entitlements.has(item.entitlementKey));
  const upgradeItems = ORIENTATION_ITEMS.filter(
    (item) => !entitlements.has(item.entitlementKey) && !isSubsumedSupport(item.entitlementKey, entitlements)
  );

  return (
    <OnboardingLayout currentStep={4} onBack={() => navigate("/onboarding/profile")}>
      <div className="space-y-6">
        <div className="text-center mb-2">
          <h2 className="text-2xl font-bold text-foreground mb-2">What's Included in Your Plan</h2>
          <p className="text-muted-foreground">
            Here's everything you have access to with your current membership.
          </p>
        </div>

        {ownedItems.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-green-700 uppercase tracking-wider mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Your Access
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {ownedItems.map((item) => (
                <Card key={item.entitlementKey} className="border-green-200 bg-green-50/50">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{item.icon}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-foreground text-sm">{item.title}</p>
                          <svg className="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {upgradeItems.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              Available with Upgrade
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {upgradeItems.map((item) => (
                <Card key={item.entitlementKey} className="opacity-60 border-dashed">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl grayscale">{item.icon}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-muted-foreground text-sm">{item.title}</p>
                          <svg className="w-4 h-4 text-muted-foreground/50 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-center pt-2">
          <Button
            size="lg"
            onClick={handleContinue}
            disabled={submitting}
            className="px-12"
          >
            {submitting ? "Continuing..." : "Continue"}
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  );
}

function isSubsumedSupport(key: string, entitlements: Set<string>): boolean {
  const supportKeys = ["support:basic", "support:standard", "support:enhanced", "support:unlimited", "support:vip"];
  if (!supportKeys.includes(key)) return false;
  const idx = supportKeys.indexOf(key);
  return supportKeys.slice(idx + 1).some((k) => entitlements.has(k));
}
