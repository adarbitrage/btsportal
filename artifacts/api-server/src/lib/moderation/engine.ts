import { scanContent, type WordlistMatch } from "./wordlist";
import { classifyContent, type ClassifierScores } from "./classifier";

export interface EvaluateInput {
  body: string;
  targetType: "post" | "comment";
  authorId: number;
}

export interface EvaluateResult {
  flagged: boolean;
  triggeredBy: string;
  wordlistMatches: WordlistMatch[];
  aiScores: ClassifierScores;
}

export async function evaluate(input: EvaluateInput): Promise<EvaluateResult> {
  const { body } = input;

  const wordlistMatches = await scanContent(body);

  const hardMatches = wordlistMatches.filter((m) => m.severity === "HARD");
  if (hardMatches.length > 0) {
    return {
      flagged: true,
      triggeredBy: "wordlist_hard",
      wordlistMatches,
      aiScores: { toxicity: 0, spam: 0, harassment: 0, hate_speech: 0 },
    };
  }

  const aiScores = await classifyContent(body);

  const softMatches = wordlistMatches.filter((m) => m.severity === "SOFT");
  const aiTriggered = Object.values(aiScores).some((score) => score > 0.5);
  const softTriggered = softMatches.length > 0;

  const flagged = aiTriggered || softTriggered;

  let triggeredBy = "none";
  if (flagged) {
    if (aiTriggered && softTriggered) {
      triggeredBy = "combined";
    } else if (aiTriggered) {
      triggeredBy = "ai_classifier";
    } else {
      triggeredBy = "wordlist_soft";
    }
  }

  return {
    flagged,
    triggeredBy,
    wordlistMatches,
    aiScores,
  };
}
