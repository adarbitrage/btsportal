import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const tierColors: Record<string, string> = {
  frontend: "bg-blue-100 text-blue-700 border-blue-200",
  launchpad: "bg-orange-100 text-orange-700 border-orange-200",
  "3month": "bg-purple-100 text-purple-700 border-purple-200",
  "6month": "bg-purple-100 text-purple-700 border-purple-200",
  "1year": "bg-amber-100 text-amber-700 border-amber-200",
  lifetime: "bg-amber-100 text-amber-700 border-amber-200",
  free: "bg-gray-100 text-gray-600 border-gray-200",
};

const tierNames: Record<string, string> = {
  frontend: "Front-End",
  launchpad: "LaunchPad",
  "3month": "3-Month",
  "6month": "6-Month",
  "1year": "1-Year",
  lifetime: "Lifetime",
  free: "Free",
};

export function TierBadge({ slug, className }: { slug: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] px-1.5 py-0 font-medium border",
        tierColors[slug] ?? tierColors.free,
        className
      )}
    >
      {tierNames[slug] ?? slug}
    </Badge>
  );
}

export function EngagementBadge({ badge, className }: { badge: string; className?: string }) {
  const badgeConfig: Record<string, { label: string; color: string }> = {
    first_post: { label: "First Post", color: "bg-green-100 text-green-700 border-green-200" },
    helpful: { label: "Helpful", color: "bg-blue-100 text-blue-700 border-blue-200" },
    prolific: { label: "Prolific", color: "bg-purple-100 text-purple-700 border-purple-200" },
    conversation_starter: { label: "Starter", color: "bg-orange-100 text-orange-700 border-orange-200" },
    top_contributor: { label: "Top Contributor", color: "bg-amber-100 text-amber-700 border-amber-200" },
  };

  const config = badgeConfig[badge] ?? { label: badge, color: "bg-gray-100 text-gray-600 border-gray-200" };

  return (
    <Badge
      variant="outline"
      className={cn("text-[9px] px-1.5 py-0 font-medium border", config.color, className)}
    >
      {config.label}
    </Badge>
  );
}
