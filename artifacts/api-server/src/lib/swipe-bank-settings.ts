/**
 * Swipe Resource Bank disclaimer copy (Task #2104).
 *
 * The disclaimer is legally load-bearing: it explains that the swipes are
 * third-party creatives collected for research/education, disclaims
 * ownership, and offers takedown. The copy is admin-editable via a reserved
 * `system_settings` row (same DB-value-over-shipped-default pattern as
 * pitch-content-settings.ts); the shipped default below is the neutralized
 * port of the old WordPress disclaimer — site references replaced with
 * portal-neutral "we / this resource" language and NO legal-entity naming.
 */
import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const SWIPE_BANK_DISCLAIMER_SETTING_KEY = "swipe_bank.disclaimer";
const CATEGORY = "swipe_bank";

export interface SwipeBankDisclaimer {
  /** Short one-liner rendered at the top of the gallery, linking down. */
  topNote: string;
  /** Heading of the full disclaimer block at the bottom of the gallery. */
  heading: string;
  /** Full disclaimer body, one entry per paragraph. */
  paragraphs: string[];
}

export function getDefaultSwipeBankDisclaimer(): SwipeBankDisclaimer {
  return {
    topNote:
      "The creatives in this resource are third-party examples provided for research and education only — please read the full ownership & use disclaimer below.",
    heading: "Ownership & Use Disclaimer",
    paragraphs: [
      "We do not claim ownership of any of the banner ads, advertorials, landing pages, or other creative materials collected in this resource. Every item was gathered from publicly available advertising placements and is reproduced here solely for research, education, and market-analysis purposes.",
      "All trademarks, product names, brand names, images, and copy remain the property of their respective owners. Their inclusion in this resource does not imply any affiliation with, sponsorship by, or endorsement from those owners.",
      "These materials are provided as inspiration and market research only. Do not copy any creative verbatim. You are solely responsible for ensuring that any advertising you produce complies with all applicable laws, network policies, and intellectual-property rights.",
      "If you are the rights holder of any material included in this resource and would like it removed, contact our support team with a link to the item and proof of ownership, and we will promptly remove it.",
    ],
  };
}

function parseStored(raw: unknown): SwipeBankDisclaimer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const topNote = typeof obj.topNote === "string" ? obj.topNote : null;
  const heading = typeof obj.heading === "string" ? obj.heading : null;
  const paragraphs = Array.isArray(obj.paragraphs)
    ? obj.paragraphs.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : null;
  if (topNote === null || heading === null || paragraphs === null) return null;
  if (!topNote.trim() || !heading.trim() || paragraphs.length === 0) return null;
  return { topNote, heading, paragraphs };
}

/** Stored value wins field-set-wise as a whole; malformed/absent → default. */
export async function getSwipeBankDisclaimer(): Promise<SwipeBankDisclaimer> {
  const [row] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, SWIPE_BANK_DISCLAIMER_SETTING_KEY))
    .limit(1);
  return parseStored(row?.value) ?? getDefaultSwipeBankDisclaimer();
}

/** Validates + upserts the disclaimer. Throws on invalid input. */
export async function setSwipeBankDisclaimer(
  input: unknown,
  updatedBy: string,
): Promise<SwipeBankDisclaimer> {
  const parsed = parseStored(input);
  if (!parsed) {
    throw new Error(
      "Disclaimer must include a non-empty topNote, heading, and at least one paragraph",
    );
  }
  await db
    .insert(systemSettingsTable)
    .values({
      key: SWIPE_BANK_DISCLAIMER_SETTING_KEY,
      value: parsed,
      category: CATEGORY,
      description: "Swipe Resource Bank ownership/use disclaimer blocks",
      updatedBy,
    })
    .onConflictDoUpdate({
      target: systemSettingsTable.key,
      set: { value: parsed, updatedBy, updatedAt: new Date() },
    });
  return parsed;
}
