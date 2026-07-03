import { db, smsTemplatesTable, sequenceStepsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Task #1635 (trademark marking) added a full-name trademark mark to
 * `Build Test Scale` wherever it appears as the FULL brand display name in
 * outbound comms. Email templates get this via `starter_hash`-driven
 * refresh (see `ensureRequiredEmailTemplates`), but SMS bodies and sequence
 * step subjects have no such refresh mechanism — this module is the
 * one-time, idempotent data-fix pass that reaches existing/prod databases on
 * the next boot, mirroring the `ensureRequiredSmsTemplates` insert-only
 * pattern but for an UPDATE instead of an INSERT.
 *
 * Both passes only overwrite a row when its CURRENT content matches the
 * known prior (unmarked) starter copy exactly — an admin who has already
 * customized the copy is left untouched, same guarantee
 * `ensureRequiredEmailTemplates` gives email rows.
 */

/**
 * SMS decision: use the ASCII "(TM)" instead of the U+2122 glyph.
 *
 * The U+2122 glyph is outside the GSM-7 character set, so a single ™ in an
 * SMS body forces the WHOLE message into UCS-2 encoding, which HALVES the
 * per-segment character budget (70 vs. 160 chars, and 67 vs. 153 per segment
 * once concatenated). That risks silently splitting short transactional
 * texts (OTPs, links) into two carrier-billed segments over one glyph.
 * "(TM)" stays inside GSM-7, costs zero encoding overhead, and is a
 * widely-understood ASCII trademark notation for SMS. Applies to SMS only —
 * email and portal UI use the real ™ glyph.
 */
const PRIOR_SMS_BODIES: Record<string, { prior: string; next: string }> = {
  welcome: {
    prior: "Welcome to Build Test Scale, {{member_name}}! Log in to get started: {{portal_url}}",
    next: "Welcome to Build Test Scale (TM), {{member_name}}! Log in to get started: {{portal_url}}",
  },
};

export async function ensureSmsTrademarkMarking(): Promise<{ updated: string[] }> {
  const result = { updated: [] as string[] };
  try {
    for (const [slug, { prior, next }] of Object.entries(PRIOR_SMS_BODIES)) {
      const rows = await db
        .select({ id: smsTemplatesTable.id, body: smsTemplatesTable.body })
        .from(smsTemplatesTable)
        .where(eq(smsTemplatesTable.slug, slug));
      for (const row of rows) {
        if (row.body !== prior) continue;
        await db.update(smsTemplatesTable).set({ body: next }).where(eq(smsTemplatesTable.id, row.id));
        result.updated.push(slug);
      }
    }
    if (result.updated.length) {
      console.log(`[Seed] ensureSmsTrademarkMarking: updated=[${result.updated.join(",")}]`);
    }
  } catch (err) {
    console.error("[Seed] ensureSmsTrademarkMarking failed:", err);
  }
  return result;
}

/**
 * `sequence_steps.subject` rows seeded by `seed.ts` (dev-only, not run
 * against prod) can also carry the full brand name — e.g. the onboarding
 * welcome email's subject line. Prod's sequence rows were created by an
 * earlier boot/admin action using the pre-trademark copy, so this pass
 * updates only the one known prior subject, again matched exactly so any
 * admin-edited subject is left alone.
 */
const PRIOR_SEQUENCE_STEP_SUBJECTS: Array<{ prior: string; next: string }> = [
  { prior: "Welcome to Build Test Scale!", next: "Welcome to Build Test Scale\u2122!" },
];

export async function ensureSequenceTrademarkMarking(): Promise<{ updated: number }> {
  let updated = 0;
  try {
    for (const { prior, next } of PRIOR_SEQUENCE_STEP_SUBJECTS) {
      const rows = await db
        .select({ id: sequenceStepsTable.id, subject: sequenceStepsTable.subject })
        .from(sequenceStepsTable)
        .where(eq(sequenceStepsTable.subject, prior));
      for (const row of rows) {
        await db.update(sequenceStepsTable).set({ subject: next }).where(eq(sequenceStepsTable.id, row.id));
        updated += 1;
      }
    }
    if (updated) {
      console.log(`[Seed] ensureSequenceTrademarkMarking: updated=${updated} row(s)`);
    }
  } catch (err) {
    console.error("[Seed] ensureSequenceTrademarkMarking failed:", err);
  }
  return { updated };
}
