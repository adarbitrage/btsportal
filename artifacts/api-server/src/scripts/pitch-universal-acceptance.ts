/**
 * Owner-inbox acceptance sends for Task #1819 (universal pitch slot at the
 * layout seam).
 *
 * Sends 3 real emails through the actual production send path
 * (`CommunicationService.sendEmailNow`) to a live inbox, to visually confirm:
 *
 *  1. `streak_milestone` (formerly `category: "marketing"`, previously
 *     pitch-skipped) now DOES carry a pitch when sent with a ranked userId
 *     — proving the category gate is gone and the seam is universal.
 *  2. `partner_call_confirmation` (a booking-confirmation lifecycle email)
 *     carries the pitch stack exactly once — proving the seam-authoritative
 *     change doesn't double-stack it alongside the send site's own
 *     person-block variables.
 *  3. `password_reset` — one of the 3 security-excluded slugs — stays
 *     pitch-free even when sent with the SAME ranked userId, proving the
 *     exclusion list (not category) is what's gating now.
 *
 * Usage (from the repo root):
 *
 *   PREVIEW_SEND_TO=you@gmail.com \
 *     pnpm --filter @workspace/api-server exec tsx src/scripts/pitch-universal-acceptance.ts
 *
 * Requires SENDGRID_API_KEY + a configured portal URL to actually deliver.
 * Uses a real dev-seeded member account (creates one with an active
 * "launchpad" product grant if $PITCH_ACCEPTANCE_USER_ID isn't given) so the
 * pitch resolver has real rank data to render from.
 */
import { db, usersTable, productsTable, userProductsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { CommunicationService } from "../lib/communication-service.js";

async function ensureAcceptanceMember(): Promise<number> {
  const envUserId = process.env.PITCH_ACCEPTANCE_USER_ID;
  if (envUserId) return Number(envUserId);

  const email = `pitch-acceptance-${randomUUID().slice(0, 8)}@example.test`;
  const passwordHash = await bcrypt.hash("acceptance-test-only", 4);
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Pitch Acceptance Test",
      passwordHash,
      role: "member",
      sourceProduct: null,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });

  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, "launchpad"));
  if (!product) throw new Error('Expected dev-seeded product "launchpad" to exist');
  await db.insert(userProductsTable).values({
    userId: user.id,
    productId: product.id,
    status: "active",
    purchasedAt: new Date(),
  });

  console.log(`[acceptance] created member ${user.id} (${email}) with an active launchpad grant`);
  return user.id;
}

async function main() {
  const to = process.env.PREVIEW_SEND_TO;
  if (!to) {
    console.error("[acceptance] requires PREVIEW_SEND_TO=you@example.com");
    process.exitCode = 1;
    return;
  }

  const userId = await ensureAcceptanceMember();
  console.log(`\n[acceptance] sending 3 verification emails to ${to} using ranked member userId=${userId}...\n`);

  const streakResult = await CommunicationService.sendEmailNow({
    templateSlug: "streak_milestone",
    to,
    userId,
    variables: {
      member_name: "Alex Morgan",
      streak_count: "7",
    },
  });
  console.log(
    `[acceptance] streak_milestone (formerly marketing-gated, EXPECT pitch present) -> ${streakResult.status}`,
  );

  const passwordResetResult = await CommunicationService.sendEmailNow({
    templateSlug: "password_reset",
    to,
    userId,
    variables: {
      member_name: "Alex Morgan",
      reset_url: "https://portal.buildtestscale.com/reset-password?token=acceptance-test-token",
    },
  });
  console.log(
    `[acceptance] password_reset (security-excluded, EXPECT pitch absent) -> ${passwordResetResult.status}`,
  );

  const bookingConfirmationResult = await CommunicationService.sendEmailNow({
    templateSlug: "partner_call_confirmation",
    to,
    userId,
    variables: {
      member_name: "Alex Morgan",
      call_type_label: "Partner Call",
      datetime_label: "Tuesday, July 14 at 2:00 PM EDT",
      meeting_url: "https://meet.google.com/abc-defg-hij",
      person_block_html: "<p><strong>Jordan Rivera</strong> — your accountability partner</p>",
    },
  });
  console.log(
    `[acceptance] partner_call_confirmation (booking confirmation, EXPECT pitch present exactly once) -> ${bookingConfirmationResult.status}`,
  );

  console.log(
    "\n[acceptance] Visually confirm in the inbox: streak_milestone and partner_call_confirmation each show a single pitch block near the footer; password_reset does NOT.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[acceptance] failed:", err);
    process.exit(1);
  });
