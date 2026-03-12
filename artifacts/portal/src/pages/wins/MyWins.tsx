import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useMyWins, useDeleteWin } from "@/hooks/use-wins";
import { Link } from "wouter";
import { Trophy, Eye, Pencil, Trash2, CheckCircle2, Circle, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import type { Win, WinMilestone, WinStreakInfo } from "@/lib/wins-api";

const CATEGORY_ORDER = ["revenue", "campaign", "skill", "lifestyle", "custom"];
const CATEGORY_LABELS: Record<string, string> = {
  revenue: "Revenue",
  campaign: "Campaign",
  skill: "Skill",
  lifestyle: "Lifestyle",
  custom: "Custom",
};

export default function MyWins() {
  const { data, isLoading, error } = useMyWins();
  const deleteWin = useDeleteWin();

  const wins = data?.wins ?? [];
  const streak = data?.streak;

  const handleDelete = (winId: number) => {
    if (confirm("Are you sure you want to delete this win?")) {
      deleteWin.mutate(winId);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/wins">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Wins Wall
            </Button>
          </Link>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Trophy className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Your Wins</h1>
              <p className="text-muted-foreground text-sm">Track your milestone journey</p>
            </div>
          </div>
          <Link href="/wins/submit">
            <Button className="gap-2 shadow-md">
              <Trophy className="w-4 h-4" />
              Log a Win
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">Failed to load your wins. Please try again.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {streak && <MilestoneTracker streak={streak} />}

            <div>
              <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-4">
                Your Win Timeline
              </h2>

              {wins.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                      <Trophy className="w-8 h-8 text-primary/60" />
                    </div>
                    <h3 className="font-semibold text-lg text-foreground mb-1">No wins logged yet</h3>
                    <p className="text-muted-foreground text-sm mb-4">
                      Start logging your achievements to track your progress!
                    </p>
                    <Link href="/wins/submit">
                      <Button className="gap-2">
                        <Trophy className="w-4 h-4" />
                        Log Your First Win
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {wins.map((win) => (
                    <WinTimelineItem
                      key={win.id}
                      win={win}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function MilestoneTracker({ streak }: { streak: WinStreakInfo }) {
  return (
    <Card>
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-base flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-primary" />
          Milestone Tracker
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {streak.achievedCount} of {streak.totalCount} milestones achieved
          </span>
          <span className="font-bold text-primary">{streak.percentage}%</span>
        </div>
        <div className="w-full bg-secondary rounded-full h-2.5">
          <div
            className="bg-primary h-2.5 rounded-full transition-all duration-500"
            style={{ width: `${streak.percentage}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          {streak.achievedMilestoneIds.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {streak.achievedCount} milestones completed
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No milestones achieved yet. Start logging wins!
            </p>
          )}
        </div>
        {streak.nextMilestone && (
          <div className="bg-primary/5 rounded-lg p-3 flex items-center gap-3">
            <span className="text-2xl">{streak.nextMilestone.icon}</span>
            <div>
              <p className="text-xs font-semibold text-primary uppercase tracking-wider">Next Milestone</p>
              <p className="text-sm font-medium text-foreground">{streak.nextMilestone.name}</p>
              <p className="text-xs text-muted-foreground">{streak.nextMilestone.description}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WinTimelineItem({ win, onDelete }: { win: Win; onDelete: (id: number) => void }) {
  return (
    <Card className={cn(
      "border-l-4",
      win.status === "draft" ? "border-l-muted-foreground/30" :
      win.status === "featured" ? "border-l-yellow-400" :
      "border-l-primary"
    )}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{win.milestone.icon}</span>
              <span className="text-sm font-semibold text-foreground">{win.milestone.name}</span>
              {win.status === "draft" && (
                <Badge variant="secondary" className="text-[10px]">Draft</Badge>
              )}
              {win.status === "featured" && (
                <Badge variant="outline" className="text-[10px] bg-yellow-50 border-yellow-300 text-yellow-700">Featured</Badge>
              )}
              {win.proofVerified && (
                <Badge variant="outline" className="text-[10px] bg-green-50 border-green-300 text-green-700 gap-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5" /> Verified
                </Badge>
              )}
            </div>
            <h3 className="font-bold text-foreground mb-1">{win.title}</h3>
            <p className="text-xs text-muted-foreground mb-2">
              {format(new Date(win.winDate), "MMMM d, yyyy")}
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
              {win.description}
            </p>
            {win.revenueAmount && (
              <p className="text-sm font-semibold text-green-600 mt-2">
                Revenue: ${win.revenueAmount.toLocaleString()}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/30">
          <Link href={`/wins/${win.id}`}>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
              <Eye className="w-3 h-3" /> View
            </Button>
          </Link>
          <Link href={`/wins/submit?edit=${win.id}`}>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
              <Pencil className="w-3 h-3" /> Edit
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
            onClick={() => onDelete(win.id)}
          >
            <Trash2 className="w-3 h-3" /> Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
