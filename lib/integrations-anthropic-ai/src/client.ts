import Anthropic from "@anthropic-ai/sdk";

let _anthropic: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (_anthropic) return _anthropic;

  const hasIntegration = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const hasDirectKey = process.env.ANTHROPIC_API_KEY;

  if (!hasIntegration && !hasDirectKey) {
    throw new Error(
      "Anthropic AI not configured. Either provision the Replit AI integration (AI_INTEGRATIONS_ANTHROPIC_BASE_URL + AI_INTEGRATIONS_ANTHROPIC_API_KEY) or set ANTHROPIC_API_KEY.",
    );
  }

  _anthropic = hasIntegration
    ? new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      })
    : new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

  return _anthropic;
}

export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop, receiver) {
    const client = getAnthropicClient();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});
