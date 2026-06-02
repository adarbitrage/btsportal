import { useGetBlitzStreak, getGetBlitzStreakQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Flame, Zap } from "lucide-react";

function HeatmapCell({ count }: { count: number }) {
  let bg: string;
  if (count === 0) bg = "bg-muted";
  else if (count <= 2) bg = "bg-primary/30";
  else if (count <= 5) bg = "bg-primary/60";
  else bg = "bg-primary";

  return (
    <div
      className={`w-3 h-3 rounded-sm ${bg} transition-colors`}
      title={count > 0 ? `${count} action${count !== 1 ? "s" : ""}` : "No activity"}
    />
  );
}

export function BlitzStreakWidget() {
  const { data, isLoading } = useGetBlitzStreak({
    query: { queryKey: getGetBlitzStreakQueryKey(), staleTime: 0, refetchInterval: 5_000 },
  });

  if (isLoading) {
    return (
      <Card className="animate-pulse">
        <CardContent className="p-6">
          <div className="h-28 bg-secondary rounded" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { dailyStreak, longestDailyStreak, weeksActiveLast4, heatmap } = data;

  const last12Weeks = heatmap.slice(-84);

  const weeks: { date: string; count: number }[][] = [];
  for (let i = 0; i < last12Weeks.length; i += 7) {
    weeks.push(last12Weeks.slice(i, i + 7));
  }

  return (
    <Card>
      <CardHeader className="pb-4 border-b border-border/50">
        <div className="flex items-center gap-2 text-foreground font-semibold">
          <Flame className="w-5 h-5 text-primary" />
          Blitz Streak
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-secondary/50 rounded-xl p-3 text-center">
            <p className={`text-3xl font-bold ${dailyStreak > 0 ? "text-primary" : "text-muted-foreground"}`}>
              {dailyStreak}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">Day Streak</p>
            <p className="text-xs text-muted-foreground mt-1">Best: {longestDailyStreak}</p>
          </div>
          <div className="bg-secondary/50 rounded-xl p-3 text-center">
            <p className={`text-3xl font-bold ${weeksActiveLast4 > 0 ? "text-primary" : "text-muted-foreground"}`}>
              {weeksActiveLast4}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">Active Weeks</p>
            <p className="text-xs text-muted-foreground mt-1">of last 4</p>
          </div>
        </div>

        {dailyStreak === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500 shrink-0" />
            <p className="text-xs text-amber-700">Complete a Blitz section today to start your streak!</p>
          </div>
        )}

        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">12-Week Activity</p>
          <div className="flex gap-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-1">
                {week.map((day) => (
                  <HeatmapCell key={day.date} count={day.count} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
