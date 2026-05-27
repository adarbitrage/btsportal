import { db } from "@workspace/db";
import { moderationWordlistTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const STARTER_WORDLIST = [
  { word: "fuck", category: "profanity", severity: "HARD" },
  { word: "shit", category: "profanity", severity: "HARD" },
  { word: "bitch", category: "profanity", severity: "HARD" },
  { word: "asshole", category: "profanity", severity: "HARD" },
  { word: "bastard", category: "profanity", severity: "HARD" },
  { word: "cunt", category: "profanity", severity: "HARD" },
  { word: "whore", category: "profanity", severity: "HARD" },
  { word: "nigger", category: "hate_speech", severity: "HARD" },
  { word: "faggot", category: "hate_speech", severity: "HARD" },
  { word: "retard", category: "hate_speech", severity: "HARD" },
  { word: "spic", category: "hate_speech", severity: "HARD" },
  { word: "chink", category: "hate_speech", severity: "HARD" },
  { word: "kike", category: "hate_speech", severity: "HARD" },
  { word: "wetback", category: "hate_speech", severity: "HARD" },
  { word: "click here to earn", category: "spam", severity: "HARD" },
  { word: "make money fast", category: "spam", severity: "HARD" },
  { word: "guaranteed income", category: "spam", severity: "HARD" },
  { word: "work from home no experience", category: "spam", severity: "HARD" },
  { word: "earn $1000 a day", category: "spam", severity: "HARD" },
  { word: "buy now limited offer", category: "spam", severity: "HARD" },
  { word: "dm me for details", category: "spam", severity: "HARD" },
  { word: "free money", category: "spam", severity: "HARD" },
  { word: "crap", category: "profanity", severity: "SOFT" },
  { word: "damn", category: "profanity", severity: "SOFT" },
  { word: "hell", category: "profanity", severity: "SOFT" },
  { word: "ass", category: "profanity", severity: "SOFT" },
  { word: "piss", category: "profanity", severity: "SOFT" },
  { word: "jerk", category: "profanity", severity: "SOFT" },
  { word: "idiot", category: "profanity", severity: "SOFT" },
  { word: "moron", category: "profanity", severity: "SOFT" },
  { word: "loser", category: "profanity", severity: "SOFT" },
  { word: "scam", category: "spam", severity: "SOFT" },
  { word: "ponzi", category: "spam", severity: "SOFT" },
  { word: "pyramid scheme", category: "spam", severity: "SOFT" },
  { word: "mlm", category: "spam", severity: "SOFT" },
  { word: "crypto signal", category: "spam", severity: "SOFT" },
  { word: "trading signal", category: "spam", severity: "SOFT" },
  { word: "passive income secret", category: "spam", severity: "SOFT" },
  { word: "no experience needed", category: "spam", severity: "SOFT" },
  { word: "join my team", category: "spam", severity: "SOFT" },
  { word: "referral link", category: "spam", severity: "SOFT" },
  { word: "binary options", category: "spam", severity: "SOFT" },
  { word: "forex signals", category: "spam", severity: "SOFT" },
  { word: "get rich quick", category: "spam", severity: "SOFT" },
  { word: "financial freedom secret", category: "spam", severity: "SOFT" },
  { word: "kill yourself", category: "harassment", severity: "HARD" },
  { word: "kys", category: "harassment", severity: "HARD" },
  { word: "i will find you", category: "harassment", severity: "HARD" },
  { word: "shut up stupid", category: "harassment", severity: "SOFT" },
  { word: "you are an idiot", category: "harassment", severity: "SOFT" },
  { word: "nobody likes you", category: "harassment", severity: "SOFT" },
];

export async function seedModerationWordlist(): Promise<void> {
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(moderationWordlistTable);

    if (count > 0) {
      return;
    }

    await db
      .insert(moderationWordlistTable)
      .values(STARTER_WORDLIST)
      .onConflictDoNothing({ target: moderationWordlistTable.word });

    console.log(`[Seed] Seeded ${STARTER_WORDLIST.length} moderation wordlist entries`);
  } catch (err) {
    console.error("[Seed] Failed to seed moderation wordlist:", err);
  }
}
