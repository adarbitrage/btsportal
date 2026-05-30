/**
 * update-system-prompt.ts
 *
 * Updates the active system prompt in the live database to the current
 * anti-hallucination version. Safe to re-run; uses the `name = 'default'`
 * record as the target and upserts it.
 *
 * Usage:
 *   npx tsx src/scripts/update-system-prompt.ts
 */

import { db } from "@workspace/db";
import { chatSystemPromptsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ANTI_HALLUCINATION_SYSTEM_PROMPT } from "../lib/chat-system-prompt.js";

async function main() {
  console.log("[update-system-prompt] Checking for existing active prompt...");

  const [existing] = await db
    .select({ id: chatSystemPromptsTable.id, name: chatSystemPromptsTable.name })
    .from(chatSystemPromptsTable)
    .where(eq(chatSystemPromptsTable.isActive, true))
    .limit(1);

  if (existing) {
    await db
      .update(chatSystemPromptsTable)
      .set({ content: ANTI_HALLUCINATION_SYSTEM_PROMPT })
      .where(eq(chatSystemPromptsTable.id, existing.id));
    console.log(`[update-system-prompt] Updated active prompt (id=${existing.id}, name="${existing.name}") with anti-hallucination grounding rules.`);
  } else {
    await db.insert(chatSystemPromptsTable).values({
      name: "default",
      content: ANTI_HALLUCINATION_SYSTEM_PROMPT,
      isActive: true,
    });
    console.log("[update-system-prompt] No active prompt found — inserted new default prompt.");
  }

  console.log("[update-system-prompt] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[update-system-prompt] Error:", err);
  process.exit(1);
});
