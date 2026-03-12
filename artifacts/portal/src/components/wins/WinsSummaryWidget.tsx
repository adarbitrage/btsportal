import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Trophy, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { useWinsSummary } from "@/hooks/use-wins";
import { format } from "date-fns";

export function WinsSummaryWidget() {
  const { data, isLoading, error } = useWinsSummary();

  if (isLoading) {
    return (
      <Card className="animate-pulse">
        <CardContent className="p-6">
          <div className="h-32 bg-secondary rounded" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) return null;

  return (
    <Card>
      <CardHeader className="pb-4 border-b border-border/50">
        <div className="flex items-center gap-2 text-foreground font-semibold">
          <Trophy className="w-5 h-5 text-primary" />
          Your Wins
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">
              Milestones achieved: {data.achievedCount} of {data.totalCount}
            </span>
            <span className="font-bold text-primary">{data.percentage}%</span>
          </div>
          <Progress value={data.percentage} className="h-2.5" />
        </div>

        {data.latestWin && (
          <div className="bg-secondary/50 rounded-lg p-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Latest</p>
            <p className="text-sm font-medium text-foreground">
              {data.latestWin.milestone.icon} {data.latestWin.milestone.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {format(new Date(data.latestWin.winDate), "MMMM d")}
            </p>
          </div>
        )}

        {data.nextMilestone && (
          <div className="bg-primary/5 rounded-lg p-3">
            <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1">Next</p>
            <p className="text-sm font-medium text-foreground">
              {data.nextMilestone.icon} {data.nextMilestone.name}
            </p>
            <p className="text-xs text-muted-foreground">{data.nextMilestone.description}</p>
          </div>
        )}

        <Link href="/wins">
          <Button variant="ghost" className="w-full text-primary hover:text-primary/80">
            View Wins Wall
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
