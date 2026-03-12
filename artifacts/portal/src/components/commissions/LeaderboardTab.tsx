import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trophy, Medal, Award } from "lucide-react";
import { useLeaderboard } from "@/lib/commission-api";
import { cn } from "@/lib/utils";

const PERIOD_OPTIONS = [
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "last_90_days", label: "Last 90 Days" },
  { value: "all_time", label: "All Time" },
];

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy className="w-5 h-5 text-yellow-500" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-gray-400" />;
  if (rank === 3) return <Award className="w-5 h-5 text-amber-600" />;
  return <span className="text-sm font-bold text-muted-foreground w-5 text-center">{rank}</span>;
}

export function LeaderboardTab() {
  const [period, setPeriod] = useState("this_month");
  const { data, isLoading } = useLeaderboard(period);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-12 bg-card rounded-xl animate-pulse" />
        <div className="h-96 bg-card rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-foreground">Top Affiliates</h3>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 text-center">Rank</TableHead>
                <TableHead>Affiliate</TableHead>
                <TableHead className="text-center">Referrals</TableHead>
                <TableHead className="text-right">Earnings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data && data.length > 0 ? (
                data.map((entry) => (
                  <TableRow
                    key={entry.rank}
                    className={cn(
                      entry.isCurrentUser && "bg-primary/5 border-l-2 border-l-primary"
                    )}
                  >
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center">
                        <RankBadge rank={entry.rank} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {entry.firstName} {entry.lastInitial}.
                        </span>
                        {entry.isCurrentUser && (
                          <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                            YOU
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">{entry.referralCount}</TableCell>
                    <TableCell className="text-right font-medium">
                      ${entry.totalEarnings.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    No leaderboard data for this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
