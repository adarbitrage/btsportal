import { retrieveFromKB } from "../../lib/rag-retriever.js";

export const CONFIDENCE_THRESHOLD = 0.5;
const BATCH_SIZE = 5;

export interface VerifyOptions {
  categories?: string[];
  kbDocIds?: number[];
}

export interface VerificationResult {
  questionText: string;
  retrievalConfidence: number;
  sourceKbDocIds: number[];
  passed: boolean;
}

export async function verifyQuestion(
  questionText: string,
  opts?: VerifyOptions,
): Promise<VerificationResult> {
  const results = await retrieveFromKB(questionText, {
    limit: 3,
    categories: opts?.categories,
    kbDocIds: opts?.kbDocIds,
  });
  const topScore = results.length > 0 ? results[0].rank : 0;
  const sourceIds = results.map((r) => r.id);
  return {
    questionText,
    retrievalConfidence: topScore,
    sourceKbDocIds: sourceIds,
    passed: topScore >= CONFIDENCE_THRESHOLD,
  };
}

export async function verifyQuestionBatch(
  questions: string[],
  opts?: VerifyOptions,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    const batch = questions.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((q) => verifyQuestion(q, opts)));
    results.push(...batchResults);
  }

  return results;
}
