import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, FileText, MessageSquare } from "lucide-react";
import { format } from "date-fns";
import {
  useAdminAiFlagged,
  useAdminAiFlaggedSummary,
  type AiFlaggedFilters,
  type AiFlaggedItem,
  type AiFlaggedSummary,
  type ModerationStatus,
} from "@/hooks/useAdminModeration";

type StatusOption = ModerationStatus | "all";

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function scoreColor(score: number, threshold: number | null): string {
  // Anchor color to the active threshold so admins can eyeball "this barely
  // crossed the line" vs "this was a clear flag" against whatever setting
  // was in effect at the time.
  const effective = threshold ?? 0.5;
  const delta = score - effective;
  if (delta >= 0.2) return "bg-red-600 text-white";
  if (delta >= 0.05) return "bg-orange-500 text-white";
  return "bg-yellow-500 text-white";
}

function ScorePill({
  label,
  value,
  threshold,
}: {
  label: string;
  value: number;
  threshold: number | null;
}) {
  const aboveThreshold = threshold !== null && value > threshold;
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs ${
        aboveThreshold ? "border-foreground/30" : "border-muted"
      }`}
      title={
        threshold !== null
          ? `${label}: ${value.toFixed(2)} vs threshold ${threshold.toFixed(2)}`
          : `${label}: ${value.toFixed(2)}`
      }
    >
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-semibold ${aboveThreshold ? "text-foreground" : "text-muted-foreground"}`}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

function FlaggedRow({ item }: { item: AiFlaggedItem }) {
  const scores = item.aiScores ?? {};
  return (
    <Card>
      <CardContent className="py-4 px-5">
        <div className="flex items-start gap-4">
          <Avatar className="h-9 w-9 shrink-0 mt-0.5">
            <AvatarFallback className="text-xs bg-muted">{initials(item.authorName)}</AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{item.authorName ?? "Unknown"}</span>
              {item.authorEmail && (
                <span className="text-xs text-muted-foreground">{item.authorEmail}</span>
              )}
              <Badge variant="outline" className="text-xs gap-1">
                {item.targetType === "post" ? (
                  <FileText className="w-3 h-3" />
                ) : (
                  <MessageSquare className="w-3 h-3" />
                )}
                {item.targetType === "post" ? "Post" : "Comment"}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {item.triggeredBy === "combined" ? "AI + wordlist" : "AI classifier"}
              </Badge>
              <Badge
                className={`text-xs font-mono ${scoreColor(item.maxScore, item.flagThreshold)}`}
                data-testid={`badge-max-score-${item.id}`}
              >
                max {item.maxScore.toFixed(2)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                threshold {item.flagThreshold !== null ? item.flagThreshold.toFixed(2) : "—"}
              </span>
              <span className="text-xs text-muted-foreground ml-auto">
                {format(new Date(item.createdAt), "MMM d, yyyy h:mm a")}
              </span>
            </div>

            <blockquote className="border-l-2 border-muted pl-3 text-sm text-foreground/80 italic line-clamp-3">
              {item.body}
            </blockquote>

            <div className="flex flex-wrap items-center gap-1.5">
              <ScorePill label="toxicity" value={Number(scores.toxicity ?? 0)} threshold={item.flagThreshold} />
              <ScorePill label="spam" value={Number(scores.spam ?? 0)} threshold={item.flagThreshold} />
              <ScorePill label="harassment" value={Number(scores.harassment ?? 0)} threshold={item.flagThreshold} />
              <ScorePill label="hate" value={Number(scores.hate_speech ?? 0)} threshold={item.flagThreshold} />

              <div className="ml-auto flex items-center gap-2">
                <Badge variant="outline" className="text-xs capitalize">{item.status}</Badge>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/admin/moderation/queue?status=${item.status}&itemId=${item.id}`}>
                    Review in queue <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RowsSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <Card key={i}>
          <CardContent className="py-4 px-5">
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}%`;
}

function SummarySkeleton() {
  return (
    <Card>
      <CardContent className="py-4 px-5">
        <Skeleton className="h-40 w-full" />
      </CardContent>
    </Card>
  );
}

/**
 * Human label for the window the summary covers: the explicit From/To range
 * the admin applied to the list, or the default "Last N days" fallback when no
 * range is set. Keeps the card's header in sync with the list below it.
 */
function rangeLabel(summary: AiFlaggedSummary): string {
  if (summary.from || summary.to) {
    const from = summary.from ? format(new Date(summary.from), "MMM d, yyyy") : "earliest";
    const to = summary.to ? format(new Date(summary.to), "MMM d, yyyy") : "now";
    return `${from} – ${to}`;
  }
  return `Last ${summary.sampleWindowDays} days`;
}

/**
 * Summary card for threshold tuning: a per-score-band table (count +
 * approve/reject split) plus a "what-if threshold" slider that previews how
 * many flags in the selected range would still trigger at a hypothetical
 * threshold. Lets an admin see "more confident scores get rejected more often"
 * and pick a threshold from real data instead of guessing.
 */
function ThresholdSummary({ summary }: { summary: AiFlaggedSummary }) {
  // Start the slider at the currently-saved threshold so "would still trigger"
  // reads as a delta from today's behaviour.
  const [whatIf, setWhatIf] = useState<number>(summary.currentThreshold);

  const wouldStillTrigger = useMemo(
    () => summary.maxScores.filter((s) => s > whatIf).length,
    [summary.maxScores, whatIf],
  );
  const triggeringAtCurrent = useMemo(
    () => summary.maxScores.filter((s) => s > summary.currentThreshold).length,
    [summary.maxScores, summary.currentThreshold],
  );

  const totalReviewed = summary.buckets.reduce((n, b) => n + b.approved + b.rejected, 0);
  const totalApproved = summary.buckets.reduce((n, b) => n + b.approved, 0);
  const overallApproveRate = totalReviewed > 0 ? totalApproved / totalReviewed : null;

  const delta = wouldStillTrigger - triggeringAtCurrent;

  return (
    <Card data-testid="ai-flagged-summary">
      <CardContent className="py-4 px-5 space-y-5">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-foreground">Threshold tuning</h2>
          <span className="text-xs text-muted-foreground" data-testid="ai-flagged-summary-range">
            {rangeLabel(summary)} · {summary.sampleSize} AI-flagged item
            {summary.sampleSize === 1 ? "" : "s"}
          </span>
        </div>

        {summary.sampleSize === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No AI-flagged activity in {summary.from || summary.to ? "the selected range" : `the last ${summary.sampleWindowDays} days`} to summarize.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground text-left border-b">
                    <th className="font-medium py-1.5 pr-3">Score band</th>
                    <th className="font-medium py-1.5 px-3 text-right">Flags</th>
                    <th className="font-medium py-1.5 px-3 text-right">Approved</th>
                    <th className="font-medium py-1.5 px-3 text-right">Rejected</th>
                    <th className="font-medium py-1.5 px-3 text-right">Pending</th>
                    <th className="font-medium py-1.5 pl-3 text-right">Approve rate</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.buckets.map((b) => (
                    <tr
                      key={b.label}
                      className="border-b last:border-0"
                      data-testid={`summary-band-${b.label}`}
                    >
                      <td className="py-1.5 pr-3 font-mono">{b.label}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{b.total}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-green-700 dark:text-green-400">
                        {b.approved}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-red-700 dark:text-red-400">
                        {b.rejected}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground">
                        {b.pending}
                      </td>
                      <td
                        className="py-1.5 pl-3 text-right tabular-nums font-medium"
                        data-testid={`summary-band-approve-rate-${b.label}`}
                      >
                        {formatRate(b.approveRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-xs text-muted-foreground">
                    <td className="pt-2 pr-3">Overall</td>
                    <td className="pt-2 px-3 text-right tabular-nums">{summary.sampleSize}</td>
                    <td className="pt-2 px-3 text-right tabular-nums">{totalApproved}</td>
                    <td className="pt-2 px-3 text-right tabular-nums">
                      {totalReviewed - totalApproved}
                    </td>
                    <td className="pt-2 px-3 text-right tabular-nums">
                      {summary.sampleSize - totalReviewed}
                    </td>
                    <td className="pt-2 pl-3 text-right tabular-nums font-medium">
                      {formatRate(overallApproveRate)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              A high approve rate in a band means the classifier flagged a lot of content moderators
              ultimately kept — those flags are candidates to skip by raising the threshold.
            </p>

            <div className="border-t pt-4 space-y-3">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <Label className="text-sm font-medium">What if the threshold were…</Label>
                <span
                  className="font-mono text-sm font-semibold tabular-nums"
                  data-testid="ai-flagged-whatif-value"
                >
                  {whatIf.toFixed(2)}
                </span>
              </div>
              <Slider
                value={[whatIf]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={(v) => setWhatIf(v[0])}
                aria-label="What-if threshold"
                data-testid="ai-flagged-whatif-slider"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>0.00</span>
                <span>current {summary.currentThreshold.toFixed(2)}</span>
                <span>1.00</span>
              </div>
              <p className="text-sm" data-testid="ai-flagged-whatif-result">
                At a threshold of{" "}
                <span className="font-semibold tabular-nums">{whatIf.toFixed(2)}</span>,{" "}
                <span className="font-semibold tabular-nums">{wouldStillTrigger}</span> of the last{" "}
                <span className="tabular-nums">{summary.sampleSize}</span> AI-flagged item
                {summary.sampleSize === 1 ? "" : "s"} would still trigger
                {delta !== 0 ? (
                  <>
                    {" "}
                    <span
                      className={delta < 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}
                    >
                      ({delta < 0 ? "−" : "+"}
                      {Math.abs(delta)} vs the current {summary.currentThreshold.toFixed(2)})
                    </span>
                  </>
                ) : (
                  <> (same as the current {summary.currentThreshold.toFixed(2)})</>
                )}
                .
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const DEFAULT_FILTERS: AiFlaggedFilters & { statusUi: StatusOption } = {
  status: "",
  statusUi: "all",
  from: "",
  to: "",
  minScore: "",
  maxScore: "",
};

export default function AiFlagged() {
  const [draft, setDraft] = useState(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<AiFlaggedFilters>({});

  const query = useAdminAiFlagged(applied);
  const summaryQuery = useAdminAiFlaggedSummary(applied);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect();
      if (!node) return;
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          query.fetchNextPage();
        }
      });
      observerRef.current.observe(node);
    },
    [query],
  );

  const apply = (e?: React.FormEvent) => {
    e?.preventDefault();
    const next: AiFlaggedFilters = {};
    if (draft.statusUi !== "all") next.status = draft.statusUi as ModerationStatus;
    if (draft.from) next.from = new Date(draft.from).toISOString();
    if (draft.to) {
      // Inclusive end-of-day so picking "Mar 5" actually includes Mar 5 events.
      const end = new Date(draft.to);
      end.setHours(23, 59, 59, 999);
      next.to = end.toISOString();
    }
    if (draft.minScore) next.minScore = draft.minScore;
    if (draft.maxScore) next.maxScore = draft.maxScore;
    setApplied(next);
  };

  const reset = () => {
    setDraft(DEFAULT_FILTERS);
    setApplied({});
  };

  const allItems: AiFlaggedItem[] = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Flagged</h1>
          <p className="text-muted-foreground mt-1">
            Recent posts and comments the AI moderator flagged. See the score it gave each one, the threshold in
            effect at the time, and why it triggered — to help tune the threshold setting from real data.
          </p>
        </div>

        {summaryQuery.isLoading ? (
          <SummarySkeleton />
        ) : summaryQuery.isError ? (
          <Card>
            <CardContent className="py-6 text-center text-destructive text-sm">
              Failed to load the threshold tuning summary.
            </CardContent>
          </Card>
        ) : summaryQuery.data ? (
          // Key on the saved threshold so the what-if slider re-seeds to the
          // new baseline if the saved threshold changes between refetches.
          <ThresholdSummary key={summaryQuery.data.currentThreshold} summary={summaryQuery.data} />
        ) : null}

        <Card>
          <CardContent className="py-4 px-5">
            <form
              onSubmit={apply}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
            >
              <div className="space-y-1">
                <Label htmlFor="ai-flagged-from" className="text-xs">From</Label>
                <Input
                  id="ai-flagged-from"
                  type="date"
                  value={draft.from ?? ""}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ai-flagged-to" className="text-xs">To</Label>
                <Input
                  id="ai-flagged-to"
                  type="date"
                  value={draft.to ?? ""}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ai-flagged-min" className="text-xs">Min score</Label>
                <Input
                  id="ai-flagged-min"
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  placeholder="0.00"
                  value={draft.minScore ?? ""}
                  onChange={(e) => setDraft({ ...draft, minScore: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ai-flagged-max" className="text-xs">Max score</Label>
                <Input
                  id="ai-flagged-max"
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  placeholder="1.00"
                  value={draft.maxScore ?? ""}
                  onChange={(e) => setDraft({ ...draft, maxScore: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Review state</Label>
                <Select
                  value={draft.statusUi}
                  onValueChange={(v) => setDraft({ ...draft, statusUi: v as StatusOption })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">Apply</Button>
                <Button type="button" variant="outline" onClick={reset}>Reset</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {query.isLoading ? (
          <RowsSkeleton />
        ) : query.isError ? (
          <Card>
            <CardContent className="py-10 text-center text-destructive">
              Failed to load AI-flagged items.
            </CardContent>
          </Card>
        ) : allItems.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              No AI-flagged items match these filters.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {allItems.map((item) => (
              <FlaggedRow key={item.id} item={item} />
            ))}
            <div ref={sentinelRef} />
            {query.isFetchingNextPage && <RowsSkeleton />}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
