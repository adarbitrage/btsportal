import { getAnthropicClient } from "@workspace/integrations-anthropic-ai";

export interface ClassifierScores {
  toxicity: number;
  spam: number;
  harassment: number;
  hate_speech: number;
}

const SYSTEM_PROMPT = `You are a content moderation classifier for a professional affiliate marketing mentorship community. Your job is to analyze user-submitted content and return moderation scores.

Analyze the content for:
- toxicity: harmful, offensive, or abusive language (0.0 = clean, 1.0 = extremely toxic)
- spam: promotional spam, repeated content, or irrelevant advertising (0.0 = legitimate, 1.0 = clear spam)
- harassment: targeted harassment or bullying of specific individuals (0.0 = none, 1.0 = severe harassment)
- hate_speech: content targeting protected characteristics (0.0 = none, 1.0 = severe hate speech)

Respond ONLY with valid JSON in this exact format, no other text:
{"toxicity": 0.0, "spam": 0.0, "harassment": 0.0, "hate_speech": 0.0}`;

const ZERO_SCORES: ClassifierScores = {
  toxicity: 0,
  spam: 0,
  harassment: 0,
  hate_speech: 0,
};

export async function classifyContent(body: string): Promise<ClassifierScores> {
  try {
    const client = getAnthropicClient();

    const response = await Promise.race([
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 128,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: body }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Classifier timeout")), 8000),
      ),
    ]);

    const rawText =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    const stripped = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(stripped) as ClassifierScores;
    return {
      toxicity: typeof parsed.toxicity === "number" ? Math.min(1, Math.max(0, parsed.toxicity)) : 0,
      spam: typeof parsed.spam === "number" ? Math.min(1, Math.max(0, parsed.spam)) : 0,
      harassment: typeof parsed.harassment === "number" ? Math.min(1, Math.max(0, parsed.harassment)) : 0,
      hate_speech: typeof parsed.hate_speech === "number" ? Math.min(1, Math.max(0, parsed.hate_speech)) : 0,
    };
  } catch (err) {
    console.error("[Moderation/Classifier] Fail-open:", (err as Error).message);
    return ZERO_SCORES;
  }
}
