import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWins, useFeaturedWins, useWinStreak, useToggleWinReaction } from "@/hooks/use-wins";
import { Link } from "wouter";
import { Trophy, Star, Flame, MessageSquare, Loader2, ArrowRight, CheckCircle2, DollarSign } from "lucide-react";
import { format } from "date-fns";
import type { Win } from "@/lib/wins-api";

const CATEGORY_TABS = [
  { key: "all", label: "All", icon: "" },
  { key: "revenue", label: "Revenue", icon: "💰" },
  { key: "campaign", label: "Campaign", icon: "🎯" },
  { key: "skill", label: "Skill", icon: "🎓" },
  { key: "lifestyle", label: "Lifestyle", icon: "🎉" },
];

export default function WinsWall() {
  const [activeCategory, setActiveCategory] = useState("all");
  const {
    data: winsData,
    isLoading: winsLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useWins(activeCategory);
  const { data: featuredData, isLoading: featuredLoading } = useFeaturedWins();
  const { data: streak, isLoading: streakLoading } = useWinStreak();

  const allWins = winsData?.pages.flatMap((p) => p.wins) ?? [];
  const featuredWins = featuredData?.wins ?? [];

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Trophy className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Wins Wall</h1>
              <p className="text-muted-foreground text-sm">Real results from real BTS members.</p>
            </div>
          </div>
          <Link href="/wins/submit">
            <Button className="gap-2 shadow-md">
              <Trophy className="w-4 h-4" />
              Log a Win
            </Button>
          </Link>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveCategory(tab.key)}
              className={cn(
                "px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1.5",
                activeCategory === tab.key
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              {tab.icon && <span>{tab.icon}</span>}
              {tab.label}
            </button>
          ))}
        </div>

        {activeCategory === "all" && featuredWins.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-500" />
              Featured Wins
            </h2>
            <div className="space-y-4">
              {featuredLoading ? (
                <Skeleton className="h-48 w-full rounded-xl" />
              ) : (
                featuredWins.map((win) => (
                  <FeaturedWinCard key={win.id} win={win} />
                ))
              )}
            </div>
          </div>
        )}

        <div>
          {activeCategory === "all" && featuredWins.length > 0 && (
            <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">
              All Wins
            </h2>
          )}

          {winsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-56 w-full rounded-xl" />
              ))}
            </div>
          ) : allWins.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-border">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Trophy className="w-8 h-8 text-primary/60" />
              </div>
              <h3 className="font-semibold text-lg text-foreground mb-1">No wins yet</h3>
              <p className="text-muted-foreground text-sm mb-4">
                Be the first to log a win and inspire the community!
              </p>
              <Link href="/wins/submit">
                <Button className="gap-2">
                  <Trophy className="w-4 h-4" />
                  Log Your First Win
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {allWins.map((win) => (
                <WinCard key={win.id} win={win} />
              ))}
            </div>
          )}

          {hasNextPage && (
            <div className="flex justify-center pt-6">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="gap-2"
              >
                {isFetchingNextPage ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load more wins"
                )}
              </Button>
            </div>
          )}
        </div>

        {!streakLoading && streak && (
          <Card className="bg-gradient-to-r from-primary/5 to-primary/[0.02] border-primary/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                  Your Win Streak
                </h3>
                <span className="text-sm font-bold text-primary">
                  {streak.achievedCount} of {streak.totalCount} milestones
                </span>
              </div>
              <Progress value={streak.percentage} className="h-3 mb-3" />
              {streak.nextMilestone && (
                <p className="text-sm text-muted-foreground">
                  Next: {streak.nextMilestone.icon} {streak.nextMilestone.name}
                </p>
              )}
              <div className="flex justify-end mt-3">
                <Link href="/wins/mine">
                  <Button variant="ghost" size="sm" className="text-primary gap-1">
                    View your wins <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

function FeaturedWinCard({ win }: { win: Win }) {
  const toggleReaction = useToggleWinReaction();

  return (
    <Link href={`/wins/${win.id}`}>
      <Card className="border-primary/20 bg-gradient-to-r from-yellow-50/50 to-white hover:shadow-md transition-shadow cursor-pointer">
        <CardContent className="p-5">
          <div className="flex items-start gap-1.5 mb-3">
            <Badge variant="outline" className="text-[10px] bg-yellow-50 border-yellow-300 text-yellow-700 gap-1">
              <Star className="w-3 h-3" /> Featured
            </Badge>
            {win.proofVerified && (
              <Badge variant="outline" className="text-[10px] bg-green-50 border-green-300 text-green-700 gap-1">
                <CheckCircle2 className="w-3 h-3" /> Verified
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
              {win.author.avatarUrl ? (
                <img src={win.author.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                win.author.name.split(" ").map((n) => n[0]).join("")
              )}
            </div>
            <div>
              <p className="font-semibold text-foreground">{win.author.name}</p>
              <p className="text-xs text-muted-foreground">
                {win.milestone.icon} {win.milestone.name} · {format(new Date(win.winDate), "MMMM d, yyyy")}
              </p>
            </div>
          </div>
          <h3 className="font-bold text-lg text-foreground mb-2">{win.title}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{win.description}</p>
          {win.revenueAmount && (
            <div className="flex items-center gap-1.5 mt-3 text-green-600 font-semibold">
              <DollarSign className="w-4 h-4" />
              Revenue: ${win.revenueAmount.toLocaleString()}
            </div>
          )}
          {win.proofImageUrl && (
            <div className="mt-3">
              <img
                src={win.proofImageUrl}
                alt="Proof"
                className="rounded-lg h-32 object-cover w-full"
                loading="lazy"
              />
            </div>
          )}
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border/30">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleReaction.mutate(win.id);
              }}
              className={cn(
                "flex items-center gap-1.5 text-sm font-medium transition-all",
                win.hasReacted
                  ? "text-orange-500 hover:text-orange-600"
                  : "text-muted-foreground hover:text-orange-500"
              )}
            >
              <Flame className={cn("w-4 h-4", win.hasReacted && "scale-110")} />
              {win.reactionCount > 0 && <span>{win.reactionCount}</span>}
              🔥
            </button>
            {win.commentCount > 0 && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MessageSquare className="w-4 h-4" />
                {win.commentCount}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function WinCard({ win }: { win: Win }) {
  const toggleReaction = useToggleWinReaction();

  return (
    <Link href={`/wins/${win.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full flex flex-col">
        <CardContent className="p-4 flex flex-col flex-1">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
              {win.author.avatarUrl ? (
                <img src={win.author.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                win.author.name.split(" ").map((n) => n[0]).join("")
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{win.author.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {win.milestone.icon} {win.milestone.name}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {format(new Date(win.winDate), "MMM d, yyyy")}
          </p>
          <p className="text-sm text-foreground/90 leading-relaxed line-clamp-3 flex-1">
            {win.description}
          </p>
          {win.revenueAmount && (
            <p className="text-sm font-semibold text-green-600 mt-2">
              ${win.revenueAmount.toLocaleString()}
            </p>
          )}
          {win.proofImageUrl && (
            <div className="mt-2">
              <img
                src={win.proofImageUrl}
                alt="Proof"
                className="rounded h-20 object-cover w-full"
                loading="lazy"
              />
            </div>
          )}
          <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-border/30">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleReaction.mutate(win.id);
              }}
              className={cn(
                "flex items-center gap-1 text-xs font-medium transition-all",
                win.hasReacted
                  ? "text-orange-500"
                  : "text-muted-foreground hover:text-orange-500"
              )}
            >
              <Flame className="w-3.5 h-3.5" />
              {win.reactionCount > 0 && <span>{win.reactionCount}</span>}
            </button>
            {win.commentCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MessageSquare className="w-3.5 h-3.5" />
                {win.commentCount}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
