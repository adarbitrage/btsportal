import { useEffect, useMemo, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  Crown,
  Check,
  X as XIcon,
  Sparkles,
  ArrowLeft,
  Mail,
  Star,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGetCurrentMember } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { getProductDisplayName } from "@/components/layout/sidebar-nav";
import { PRODUCT_RANK } from "@/lib/upgrade-plans";

interface Plan {
  slug: string;
  name: string;
  tagline: string;
  priceDisplay: string;
  durationLabel: string;
  highlights: string[];
  entitlements: string[];
  recommended?: boolean;
  rank: number;
}

const PLANS: Plan[] = [
  {
    slug: "launchpad",
    name: "BTS LaunchPad",
    tagline: "Get the BTS app suite and start building.",
    priceDisplay: "Talk to us",
    durationLabel: "One-time",
    rank: 1,
    highlights: [
      "Full BTS app suite",
      "Compliance review submissions",
      "Standard support",
      "Full chat assistant access",
    ],
    entitlements: [
      "content:frontend",
      "content:advanced",
      "software:base",
      "support:standard",
      "chat:full",
    ],
  },
  {
    slug: "3month",
    name: "BTS 3-Month Mentorship",
    tagline: "Group coaching, community, and commissions kick in.",
    priceDisplay: "Talk to us",
    durationLabel: "90 days",
    rank: 2,
    highlights: [
      "Everything in LaunchPad",
      "Live group coaching calls",
      "Member community access",
      "Entry-tier commissions",
      "Enhanced support",
    ],
    entitlements: [
      "content:frontend",
      "content:advanced",
      "software:base",
      "coaching:group",
      "community:access",
      "commissions:entry",
      "support:enhanced",
      "chat:full",
    ],
  },
  {
    slug: "6month",
    name: "BTS 6-Month Mentorship",
    tagline: "Expanded software and mastermind coaching.",
    priceDisplay: "Talk to us",
    durationLabel: "180 days",
    rank: 3,
    highlights: [
      "Everything in 3-Month",
      "Expanded software access",
      "Mastermind coaching",
      "Mid-tier commissions",
      "Unlimited support",
    ],
    entitlements: [
      "content:frontend",
      "content:advanced",
      "software:base",
      "software:expanded",
      "coaching:group",
      "coaching:mastermind",
      "community:access",
      "commissions:mid",
      "support:unlimited",
      "chat:full",
    ],
  },
  {
    slug: "1year",
    name: "BTS 1-Year Mentorship",
    tagline: "Adds private monthly 1-on-1 coaching.",
    priceDisplay: "Talk to us",
    durationLabel: "365 days",
    rank: 4,
    recommended: true,
    highlights: [
      "Everything in 6-Month",
      "Monthly 1-on-1 coaching",
      "Premium-tier commissions",
      "Unlimited support",
    ],
    entitlements: [
      "content:frontend",
      "content:advanced",
      "software:base",
      "software:expanded",
      "coaching:group",
      "coaching:mastermind",
      "coaching:one_on_one:monthly",
      "community:access",
      "commissions:premium",
      "support:unlimited",
      "chat:full",
    ],
  },
  {
    slug: "lifetime",
    name: "BTS Lifetime Mentorship",
    tagline: "Weekly 1-on-1 coaching and lifetime access.",
    priceDisplay: "Talk to us",
    durationLabel: "Lifetime",
    rank: 5,
    highlights: [
      "Everything in 1-Year",
      "Weekly 1-on-1 coaching",
      "Top-tier commissions",
      "VIP support",
      "Custom chat assistant",
      "No expiration",
    ],
    entitlements: [
      "content:frontend",
      "content:advanced",
      "software:base",
      "software:expanded",
      "coaching:group",
      "coaching:mastermind",
      "coaching:one_on_one:weekly",
      "community:access",
      "commissions:top",
      "support:vip",
      "chat:custom",
      "access:lifetime",
    ],
  },
];

const COMPARISON_FEATURES: Array<{ key: string; label: string }> = [
  { key: "software:base", label: "BTS app suite & compliance review" },
  { key: "software:expanded", label: "Expanded software access" },
  { key: "coaching:group", label: "Group coaching calls" },
  { key: "coaching:mastermind", label: "Mastermind coaching" },
  { key: "coaching:one_on_one:monthly", label: "Monthly 1-on-1 coaching" },
  { key: "coaching:one_on_one:weekly", label: "Weekly 1-on-1 coaching" },
  { key: "community:access", label: "Member community" },
  { key: "commissions:entry", label: "Affiliate commissions" },
  { key: "support:unlimited", label: "Unlimited support" },
  { key: "support:vip", label: "VIP support" },
  { key: "access:lifetime", label: "Lifetime access" },
];

function useQueryParam(name: string): string | null {
  const [location] = useLocation();
  return useMemo(() => {
    const queryStart = location.indexOf("?");
    const search = queryStart >= 0
      ? location.slice(queryStart)
      : typeof window !== "undefined" ? window.location.search : "";
    if (!search) return null;
    return new URLSearchParams(search).get(name);
  }, [location, name]);
}

export default function Plans() {
  const { data: member } = useGetCurrentMember();
  const currentSlug = member?.sourceProduct ?? "free";
  const currentRank = PRODUCT_RANK[currentSlug] ?? 0;
  const highlightSlug = useQueryParam("highlight");
  const highlightedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (highlightSlug && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightSlug]);

  return (
    <AppLayout>
      <div className="space-y-8" data-testid="plans-page">
        <div>
          <Link href="/dashboard">
            <Button
              variant="ghost"
              size="sm"
              className="mb-4 -ml-2"
              data-testid="plans-back-button"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to dashboard
            </Button>
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-6 h-6 text-primary" />
                <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
                  Upgrade your BTS membership
                </h1>
              </div>
              <p className="text-muted-foreground max-w-2xl">
                Compare what's included at each tier and pick the level that fits where
                you're going. Upgrades unlock new training, coaching, software, and
                commissions.
              </p>
            </div>
            <div className="text-sm text-muted-foreground" data-testid="plans-current-tier">
              Current plan:{" "}
              <span className="font-semibold text-foreground">
                {PLANS.find((p) => p.slug === currentSlug)?.name ??
                  getProductDisplayName(currentSlug)}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = plan.slug === currentSlug;
            const isHighlighted = highlightSlug === plan.slug;
            const isLowerTier = (PRODUCT_RANK[plan.slug] ?? 0) < currentRank;
            return (
              <Card
                key={plan.slug}
                ref={isHighlighted ? highlightedRef : undefined}
                className={cn(
                  "relative flex flex-col transition-all",
                  isHighlighted &&
                    "ring-2 ring-primary ring-offset-2 shadow-lg",
                  plan.recommended && !isHighlighted && "border-primary/40 shadow-md",
                  isLowerTier && "opacity-60",
                )}
                data-testid={`plan-card-${plan.slug}`}
                data-highlighted={isHighlighted ? "true" : undefined}
              >
                {plan.recommended && !isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground gap-1">
                      <Star className="w-3 h-3" />
                      Most popular
                    </Badge>
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge variant="secondary" className="gap-1">
                      <Check className="w-3 h-3" />
                      Your current plan
                    </Badge>
                  </div>
                )}
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Crown className="w-4 h-4 text-primary" />
                    <h3 className="font-bold text-lg text-foreground">{plan.name}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{plan.tagline}</p>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-xl font-bold text-foreground">
                      {plan.priceDisplay}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {plan.durationLabel}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  <ul className="space-y-2 mb-5 flex-1">
                    {plan.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2 text-sm text-foreground">
                        <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant={plan.recommended ? "default" : "outline"}
                    className="w-full"
                    disabled={isCurrent || isLowerTier}
                    data-testid={`plan-cta-${plan.slug}`}
                    onClick={() => {
                      window.location.href = `mailto:support@bts.example?subject=${encodeURIComponent(
                        `Upgrade to ${plan.name}`,
                      )}`;
                    }}
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    {isCurrent
                      ? "You're on this plan"
                      : isLowerTier
                        ? "Lower than current"
                        : "Talk to us about upgrading"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card data-testid="plans-comparison">
          <CardHeader className="pb-3 border-b border-border/50">
            <h2 className="font-semibold text-foreground">Feature comparison</h2>
            <p className="text-sm text-muted-foreground">
              See exactly what's included at each tier.
            </p>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-muted-foreground">
                <tr>
                  <th className="text-left p-3 font-medium">Feature</th>
                  {PLANS.map((p) => (
                    <th
                      key={p.slug}
                      className="text-center p-3 font-medium whitespace-nowrap"
                    >
                      {p.name.replace("BTS ", "").replace(" Mentorship", "")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_FEATURES.map((feature) => (
                  <tr key={feature.key} className="border-t border-border/40">
                    <td className="p-3 text-foreground">{feature.label}</td>
                    {PLANS.map((p) => {
                      const has = p.entitlements.includes(feature.key);
                      return (
                        <td key={p.slug} className="p-3 text-center">
                          {has ? (
                            <Check className="w-4 h-4 text-primary inline" />
                          ) : (
                            <XIcon className="w-4 h-4 text-muted-foreground/40 inline" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="bg-secondary/40 border border-border/60 rounded-xl p-5 text-center">
          <p className="text-sm text-muted-foreground">
            Have a question about which plan is right for you?{" "}
            <Link
              href="/support/contact"
              className="text-primary font-medium hover:underline"
              data-testid="plans-contact-support"
            >
              Reach out to support
            </Link>{" "}
            and the team will help.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
