import { useState } from "react";
import { useParams, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ShieldAlert,
  ExternalLink,
  Bot,
  UserCog,
  UserCheck,
  ChevronDown,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { format } from "date-fns";
import {
  useAdminUserStrikes,
  type BanHistoryEntry,
  type UserStrikesDetail as UserStrikesDetailData,
} from "@/lib/admin-api";
import { BanControls } from "@/components/admin/moderation/ban-controls";

function BanEventRow({
  entry,
  isCurrentReason,
}: {
  entry: BanHistoryEntry;
  isCurrentReason: boolean;
}) {
  const highlightClass = "ring-2 ring-offset-1 ring-primary/60";
  const isAuto = entry.actionType === "auto_ban_posting";
  const isUnban = entry.actionType === "unban_posting";
  const strikesCleared = entry.metadata?.strikesCleared === true;

  const containerClass = isUnban
    ? "border-green-200 bg-green-50/50"
    : "border-red-200 bg-red-50/50";

  const iconWrapClass = isUnban
    ? "bg-green-100 text-green-700"
    : "bg-red-100 text-red-700";

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${containerClass} ${
        isCurrentReason ? highlightClass : ""
      }`}
    >
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${iconWrapClass}`}
      >
        {isAuto ? (
          <Bot className="w-4 h-4" />
        ) : isUnban ? (
          <UserCheck className="w-4 h-4" />
        ) : (
          <UserCog className="w-4 h-4" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          {isAuto
            ? "Auto-banned on"
            : isUnban
            ? "Manually unbanned on"
            : "Manually banned on"}{" "}
          {format(new Date(entry.createdAt), "MMM d, yyyy 'at' h:mm a")}
          {entry.actorEmail && (
            <>
              {" "}by <span className="font-semibold">{entry.actorEmail}</span>
            </>
          )}
          {isAuto && entry.metadata?.triggeringQueueId != null && (
            <> via queue #{entry.metadata.triggeringQueueId}</>
          )}
        </p>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {isCurrentReason && (
            <Badge className="text-xs bg-primary text-primary-foreground border-transparent">
              Current reason
            </Badge>
          )}
          {isAuto && entry.metadata?.strikeCount != null && (
            <Badge variant="outline" className="text-xs bg-white">
              {entry.metadata.strikeCount} strikes at ban
            </Badge>
          )}
          {isAuto && entry.metadata?.triggeringStrikeId != null && (
            <Badge variant="outline" className="text-xs bg-white">
              Strike #{entry.metadata.triggeringStrikeId}
            </Badge>
          )}
          {isUnban && (
            <Badge variant="outline" className="text-xs bg-white">
              {strikesCleared ? "Strikes cleared" : "Strikes retained"}
            </Badge>
          )}
          {isAuto && entry.metadata?.triggeringQueueId != null && (
            <Link
              href={`/admin/moderation/queue/${entry.metadata.triggeringQueueId}`}
            >
              <span className="inline-flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer">
                View triggering queue item
                <ExternalLink className="w-3 h-3" />
              </span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function BanHistoryCard({ data }: { data: UserStrikesDetailData }) {
  const [showEarlier, setShowEarlier] = useState(false);

  // Prefer the full chronological banHistory. Fall back to the legacy
  // single-latest autoBan/manualBan fields so the card keeps working against
  // older API responses (and unit tests) that don't include banHistory.
  const history: BanHistoryEntry[] =
    data.banHistory && data.banHistory.length > 0
      ? data.banHistory
      : [
          ...(data.autoBan
            ? [{ ...data.autoBan, actionType: "auto_ban_posting" as const }]
            : []),
          ...(data.manualBan ? [data.manualBan] : []),
        ].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

  if (history.length === 0 && !data.user.isBanned) return null;

  const [current, ...earlier] = history;

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base font-semibold">Ban Details</CardTitle>
        {history.length > 1 && (
          <Badge variant="outline" className="text-xs">
            {history.length} events
          </Badge>
        )}
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {history.length === 0 ? (
          <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
              <UserCog className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Banned by admin</p>
              {data.user.postingBannedAt && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {format(
                    new Date(data.user.postingBannedAt),
                    "MMM d, yyyy 'at' h:mm a",
                  )}
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            <BanEventRow entry={current} isCurrentReason />
            {earlier.length > 0 && (
              <Collapsible open={showEarlier} onOpenChange={setShowEarlier}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${
                        showEarlier ? "rotate-180" : ""
                      }`}
                    />
                    {showEarlier ? "Hide" : "Show"} earlier history (
                    {earlier.length})
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-1">
                  {earlier.map((entry) => (
                    <BanEventRow
                      key={entry.id}
                      entry={entry}
                      isCurrentReason={false}
                    />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function UserStrikesDetail() {
  const params = useParams<{ userId: string }>();
  const userId = parseInt(params.userId ?? "0", 10);

  const { data, isLoading, error } = useAdminUserStrikes(userId);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/admin/moderation/strikes">
            <Button variant="outline" size="sm" className="gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to strikes
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading...</div>
        ) : error ? (
          <Card>
            <CardContent className="py-12 text-center text-destructive">
              Failed to load strike data. Please refresh and try again.
            </CardContent>
          </Card>
        ) : !data ? null : (
          <>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-2xl font-bold text-foreground">{data.user.name}</h1>
                <p className="text-muted-foreground mt-0.5">{data.user.email}</p>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <Badge
                  className={
                    data.user.isBanned
                      ? "bg-red-100 text-red-700 border-red-200"
                      : data.strikeCount >= 3
                      ? "bg-amber-100 text-amber-700 border-amber-200"
                      : "bg-yellow-50 text-yellow-700 border-yellow-200"
                  }
                  variant="outline"
                >
                  {data.strikeCount} {data.strikeCount === 1 ? "strike" : "strikes"}
                </Badge>
                {data.user.isBanned && (
                  <Badge className="bg-red-100 text-red-700 border-red-200" variant="outline">
                    Posting banned
                    {data.user.postingBannedAt && (
                      <span className="ml-1 opacity-70">
                        since {format(new Date(data.user.postingBannedAt), "MMM d")}
                      </span>
                    )}
                  </Badge>
                )}
                <BanControls
                  userId={data.user.id}
                  isBanned={data.user.isBanned}
                  userName={data.user.name}
                />
              </div>
            </div>

            <BanHistoryCard data={data} />

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Strike History</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {data.strikes.length === 0 ? (
                  <div className="py-8 text-center">
                    <ShieldAlert className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                    <p className="text-sm text-muted-foreground">No strikes on record.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data.strikes.map((strike, idx) => (
                      <div
                        key={strike.id}
                        className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20"
                      >
                        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold">
                          {data.strikes.length - idx}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{strike.reason}</p>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(strike.createdAt), "MMM d, yyyy 'at' h:mm a")}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {strike.targetType} #{strike.targetId}
                            </Badge>
                            {strike.queueId && (
                              <Link href={`/admin/moderation/queue/${strike.queueId}`}>
                                <span className="inline-flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer">
                                  Queue item #{strike.queueId}
                                  <ExternalLink className="w-3 h-3" />
                                </span>
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
