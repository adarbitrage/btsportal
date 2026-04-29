import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Crown,
  Users,
  Video,
  UserCheck,
  DollarSign,
  AppWindow,
  ShieldCheck,
  Megaphone,
  Sparkles,
  Lock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface LockedFeature {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  matches: (entitlements: Set<string>) => boolean;
}

function hasPrefix(entitlements: Set<string>, prefix: string): boolean {
  for (const e of entitlements) {
    if (e.startsWith(prefix)) return true;
  }
  return false;
}

const FEATURE_CATALOG: LockedFeature[] = [
  {
    key: "software",
    label: "Apps & Compliance Review",
    description: "Use the BTS app suite and submit compliance reviews.",
    icon: AppWindow,
    matches: (e) => !e.has("software:base"),
  },
  {
    key: "coaching-group",
    label: "Group Coaching Calls",
    description: "Live group coaching calls with BTS coaches.",
    icon: Video,
    matches: (e) => !e.has("coaching:group"),
  },
  {
    key: "coaching-1on1",
    label: "1-on-1 Coaching",
    description: "Private monthly sessions with a dedicated coach.",
    icon: UserCheck,
    matches: (e) => !hasPrefix(e, "coaching:one_on_one:"),
  },
  {
    key: "community",
    label: "Community Access",
    description: "Join the private member community and discussion forums.",
    icon: Users,
    matches: (e) => !e.has("community:access"),
  },
  {
    key: "commissions",
    label: "Commissions & Promote BTS",
    description: "Earn commissions for referrals and promote BTS to your network.",
    icon: DollarSign,
    matches: (e) => !hasPrefix(e, "commissions:"),
  },
];

export function getLockedFeatures(entitlements: Set<string>): LockedFeature[] {
  return FEATURE_CATALOG.filter((f) => f.matches(entitlements));
}

interface UpgradeFeaturesCardProps {
  entitlements: Set<string>;
  hasLifetime: boolean;
  variant?: "dashboard" | "sidebar";
  onCtaClick?: () => void;
  onFeatureClick?: (featureKey: string) => void;
}

export function UpgradeFeaturesCard({
  entitlements,
  hasLifetime,
  variant = "dashboard",
  onCtaClick,
  onFeatureClick,
}: UpgradeFeaturesCardProps) {
  if (hasLifetime) return null;

  const locked = getLockedFeatures(entitlements);
  if (locked.length === 0) return null;

  if (variant === "sidebar") {
    return (
      <Card
        className="bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] border-blue-100/50 mb-4 shadow-sm"
        data-testid="upgrade-features-card-sidebar"
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Crown className="w-4 h-4 text-primary" />
            <h4 className="font-semibold text-sm text-foreground">What you'd unlock</h4>
          </div>
          <ul className="space-y-1.5 mb-3">
            {locked.slice(0, 4).map((f) => (
              <li
                key={f.key}
                className="flex items-center gap-2 text-xs text-muted-foreground"
                data-testid={`upgrade-feature-sidebar-${f.key}`}
              >
                <f.icon className="w-3.5 h-3.5 shrink-0 text-primary/70" />
                <span className="truncate">{f.label}</span>
              </li>
            ))}
            {locked.length > 4 && (
              <li className="text-[11px] text-muted-foreground/80 pl-5">
                +{locked.length - 4} more
              </li>
            )}
          </ul>
          <Button
            className="w-full text-xs h-8"
            variant="default"
            onClick={onCtaClick}
            data-testid="upgrade-features-cta-sidebar"
          >
            View Plans
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="upgrade-features-card-dashboard">
      <CardHeader className="pb-4 border-b border-border/50">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <Sparkles className="w-5 h-5 text-primary" />
            What you'd unlock
          </div>
          <span className="text-xs text-muted-foreground">
            {locked.length} {locked.length === 1 ? "feature" : "features"} on higher plans
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          {locked.map((f) => {
            const clickable = !!onFeatureClick;
            const className =
              "flex items-start gap-3 p-3 rounded-lg border border-border/60 bg-secondary/30 text-left w-full" +
              (clickable
                ? " hover:bg-secondary/60 hover:border-primary/40 transition-colors cursor-pointer"
                : "");
            const inner = (
              <>
                <div className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0 relative">
                  <f.icon className="w-4 h-4" />
                  <Lock className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 bg-white rounded-full p-[1px] text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{f.label}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                    {f.description}
                  </p>
                </div>
              </>
            );
            return (
              <li key={f.key}>
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => onFeatureClick?.(f.key)}
                    className={className}
                    data-testid={`upgrade-feature-dashboard-${f.key}`}
                  >
                    {inner}
                  </button>
                ) : (
                  <div
                    className={className}
                    data-testid={`upgrade-feature-dashboard-${f.key}`}
                  >
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <Button
          className="w-full sm:w-auto"
          onClick={onCtaClick}
          data-testid="upgrade-features-cta-dashboard"
        >
          <Crown className="w-4 h-4 mr-2" />
          See upgrade options
        </Button>
      </CardContent>
    </Card>
  );
}

export const _featureCatalogForTests = FEATURE_CATALOG;
