import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { useAuth } from "@/lib/auth";
import {
  useGetCurrentMember,
  usePatchOnboardingStep,
} from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";

function getFirstMission(slug: string): { title: string; description: string } {
  switch (slug) {
    case "lifetime":
      return {
        title: "Schedule Your First 1-on-1 Coaching Call",
        description:
          "As a Lifetime member, you have access to weekly 1-on-1 coaching. Head to the Coaching section and book your first session to create a personalized growth plan with your coach.",
      };
    case "1year":
      return {
        title: "Book Your Monthly Coaching Session",
        description:
          "As a 1-Year Mentorship member, you have monthly 1-on-1 coaching available. Schedule your first session to map out your 90-day action plan.",
      };
    case "6month":
    case "3month":
      return {
        title: "Join Your Next Group Coaching Call",
        description:
          "Check the coaching schedule and RSVP for the next live group call. Come prepared with your biggest question or challenge to get personalized feedback.",
      };
    case "launchpad":
      return {
        title: "Start the Advanced Training Track",
        description:
          "As a LaunchPad member, you have access to advanced training content. Head to the Training Library and begin the Advanced Strategies track.",
      };
    default:
      return {
        title: "Complete Your First Training Module",
        description:
          "Head to the Training Library and start with Module 1: The Affiliate Marketing Landscape. This foundational module will set you up for success.",
      };
  }
}

export default function OnboardingQuickStart() {
  const { user, refreshAuth } = useAuth();
  const { data: member, isLoading } = useGetCurrentMember();
  const patchOnboarding = usePatchOnboardingStep();
  const [, navigate] = useLocation();
  const [submitting, setSubmitting] = useState(false);

  const handleComplete = async () => {
    setSubmitting(true);
    try {
      await patchOnboarding.mutateAsync({ data: { step: 5 } });
      await refreshAuth();
      navigate("/");
    } catch (err) {
      console.error("Failed to complete onboarding:", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !member) {
    return (
      <OnboardingLayout currentStep={5} onBack={() => navigate("/onboarding/orientation")}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </OnboardingLayout>
    );
  }

  const entitlements = new Set(member.entitlements || []);
  const slug = member.highestProductSlug || "free";
  const mission = getFirstMission(slug);

  const quickLinks = [
    {
      title: "Training Library",
      description: "Start learning with our comprehensive video training",
      href: "/training",
      icon: "📚",
      show: true,
    },
    {
      title: "Coaching Schedule",
      description: "View and RSVP for upcoming coaching calls",
      href: "/coaching",
      icon: "📅",
      show: entitlements.has("coaching:group"),
    },
    {
      title: "Software Tools",
      description: "Access your included tools and software",
      href: "/tools",
      icon: "🛠️",
      show: entitlements.has("software:base"),
    },
    {
      title: "AI Assistant",
      description: "Get answers and guidance from our AI",
      href: "/ai",
      icon: "🤖",
      show: entitlements.has("chat:basic") || entitlements.has("chat:full"),
    },
    {
      title: "Support Center",
      description: "Get help from our support team",
      href: "/support",
      icon: "🎧",
      show: true,
    },
  ];

  const visibleLinks = quickLinks.filter((l) => l.show);

  return (
    <OnboardingLayout currentStep={5} onBack={() => navigate("/onboarding/orientation")}>
      <div className="space-y-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">You're All Set!</h2>
          <p className="text-muted-foreground">
            Here's your first mission and some quick links to get you started.
          </p>
        </div>

        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-primary" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">Your First Mission</p>
                <h3 className="text-lg font-bold text-foreground mb-2">{mission.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{mission.description}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div>
          <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">Quick Links</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleLinks.map((link) => (
              <Card key={link.href} className="hover:shadow-md transition-shadow group">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{link.icon}</span>
                    <div>
                      <p className="font-semibold text-foreground text-sm">
                        {link.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{link.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-xs text-center text-muted-foreground">
            These sections will be available from your dashboard after completing setup.
          </p>
        </div>

        <div className="flex justify-center pt-4">
          <Button
            size="lg"
            onClick={handleComplete}
            disabled={submitting}
            className="px-12 py-6 text-lg shadow-lg shadow-primary/20"
          >
            {submitting ? "Finishing setup..." : "Go to My Dashboard"}
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  );
}
