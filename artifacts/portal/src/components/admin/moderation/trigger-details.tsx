import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import type { WordlistMatch } from "@/hooks/useAdminModeration";

interface TriggerDetailsProps {
  triggeredBy: string;
  wordlistMatches: WordlistMatch[] | null;
  aiScores: Record<string, number> | null;
}

const SEVERITY_STYLES: Record<string, string> = {
  HARD: "border-red-400 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-400",
  SOFT: "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-400",
};

function TriggerSource({ triggeredBy }: { triggeredBy: string }) {
  const sources: string[] = [];
  if (triggeredBy === "wordlist") sources.push("Wordlist filter");
  else if (triggeredBy === "ai") sources.push("AI classifier");
  else if (triggeredBy === "manual_report") sources.push("Manual report");
  else if (triggeredBy) sources.push(triggeredBy);

  if (sources.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-muted-foreground">Flagged by:</span>
      {sources.map((s) => (
        <Badge key={s} variant="outline" className="text-xs">
          {s}
        </Badge>
      ))}
    </div>
  );
}

export function TriggerDetails({ triggeredBy, wordlistMatches, aiScores }: TriggerDetailsProps) {
  const hasWordlist = wordlistMatches && wordlistMatches.length > 0;
  const hasAiScores = aiScores && Object.keys(aiScores).length > 0;

  return (
    <div className="space-y-2">
      <TriggerSource triggeredBy={triggeredBy} />

      {hasWordlist && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Wordlist Matches
          </p>
          <div className="flex flex-wrap gap-1.5">
            {wordlistMatches!.map((match, i) => (
              <Badge
                key={i}
                variant="outline"
                className={`text-xs gap-1 ${SEVERITY_STYLES[match.severity] ?? SEVERITY_STYLES.SOFT}`}
                title={`Category: ${match.category} · Severity: ${match.severity}`}
              >
                <span className="font-semibold">{match.word}</span>
                <span className="opacity-75">·</span>
                <span className="opacity-75">{match.category}</span>
                <span className="opacity-75">·</span>
                <span className="opacity-75">{match.severity}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {hasAiScores && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            AI Scores
          </p>
          <div className="space-y-1.5">
            {Object.entries(aiScores!).map(([category, score]) => {
              const pct = Math.round(Math.min(Math.max(Number(score), 0), 1) * 100);
              return (
                <div key={category} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-32 shrink-0 capitalize">
                    {category.replace(/_/g, " ")}
                  </span>
                  <Progress value={pct} className="h-1.5 flex-1" />
                  <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
