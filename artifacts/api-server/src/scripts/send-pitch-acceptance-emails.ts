/**
 * send-pitch-acceptance-emails.ts — Task #1899
 *
 * Sends two `streak_milestone` acceptance previews to adam@cherringtonmedia.com,
 * each showing a different tier of the Task #1899 pitch-block stack:
 *
 *   Send 1 — Rank 0 (FRONT-END member, no paid product)
 *             Primary:   LAUNCHPAD_PITCH
 *             Secondary: MACHINE_INTRO_PITCH  ← new softer pitch, no commission claim
 *             Tertiary:  VIP_ARBITRAGE_PITCH  (suppressed by default: reviewed=false)
 *
 *   Send 2 — Rank 2 (3-MONTH member)
 *             Primary:   MACHINE_PITCH  ← full pitch with commission claim
 *             Secondary: VIP_ARBITRAGE_PITCH  (suppressed by default: reviewed=false)
 *
 * All rendering goes through `renderGatedPitchBlock` (the single gated seam),
 * so VIP_ARBITRAGE_PITCH is silently suppressed unless `reviewed: true` is set
 * in the DB.  The emails will still send — the pitch slot will simply be empty.
 *
 * Usage (run via a temporary workflow so process.env has SENDGRID_API_KEY):
 *
 *   /home/runner/workspace/artifacts/api-server/node_modules/.bin/tsx \
 *     artifacts/api-server/src/scripts/send-pitch-acceptance-emails.ts
 */

import { CommunicationService } from "../lib/communication-service.js";
import { pitchStackForRank, renderGatedPitchBlock } from "../lib/pitch-resolver.js";
import { getAllPitchContent } from "../lib/pitch-content-settings.js";
import { ensureSendGridInitialized } from "../lib/oncall-dispatcher.js";

const RECIPIENT = "adam@cherringtonmedia.com";
const MEMBER_NAME = "Adam";
const PORTAL_URL = process.env.PORTAL_URL ?? "https://portal.buildtestscale.com";

// ─── helpers ─────────────────────────────────────────────────────────────────

function initSendGrid(): void {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("SENDGRID_API_KEY is not set — run via a temporary workflow");
  ensureSendGridInitialized();
  console.log("[init] SendGrid initialized ✓");
}

async function renderPitchHtmlForRank(rank: number): Promise<string> {
  const stack = pitchStackForRank(rank, false, false);
  if (stack.length === 0) return "";
  const contentByKey = await getAllPitchContent();
  return stack.map((key) => renderGatedPitchBlock(key, contentByKey[key])).join("");
}

// ─── manifest ────────────────────────────────────────────────────────────────

interface Entry {
  num: string;
  label: string;
  subject: string;
  ok: boolean;
  failReason?: string;
}
const manifest: Entry[] = [];
let counter = 0;

async function send(opts: {
  label: string;
  pitchHtml: string;
}): Promise<void> {
  counter++;
  const num = String(counter).padStart(2, "0");
  const slug = "streak_milestone";

  process.stdout.write(`  ${num}. ${opts.label} ... `);

  let subject = "You're on a 7-day streak! Keep it up!";
  try {
    const result = await CommunicationService.sendEmailNow({
      templateSlug: slug,
      to: RECIPIENT,
      variables: {
        member_name: MEMBER_NAME,
        portal_url: PORTAL_URL,
        streak_count: "7",
        pitch_block_html: opts.pitchHtml,
      },
      category: "marketing",
    });
    const ok = result.status === "sent";
    const r = result as { status: string; reason?: string; error?: string };
    const failReason = ok ? undefined : r.reason ?? r.error ?? r.status;
    console.log(ok ? "✓" : `✗ ${failReason}`);
    manifest.push({ num, label: opts.label, subject, ok, failReason });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    console.log(`✗ ERROR: ${reason}`);
    manifest.push({ num, label: opts.label, subject, ok: false, failReason: reason });
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log("  Task #1899 Pitch-Block Acceptance Emails");
  console.log("=".repeat(72));
  console.log(`  Recipient: ${RECIPIENT}`);
  console.log(`  Date:      ${new Date().toUTCString()}`);
  console.log("=".repeat(72));

  initSendGrid();

  console.log("\n[init] Pre-rendering pitch stacks from live DB settings...");
  const pitchRank0 = await renderPitchHtmlForRank(0);
  const pitchRank2 = await renderPitchHtmlForRank(2);

  const vipNote = pitchRank0.includes("VIP") || pitchRank2.includes("VIP")
    ? "(VIP Arbitrage slot IS active — reviewed=true is set in DB)"
    : "(VIP Arbitrage slot suppressed — reviewed=false, as expected by default)";

  console.log(`  rank-0 pitch HTML: ${pitchRank0.length} chars — LaunchPad + MachineIntro + VIP Arb`);
  console.log(`  rank-2 pitch HTML: ${pitchRank2.length} chars — full Machine + VIP Arb`);
  console.log(`  ${vipNote}`);

  console.log("\n── Sends ─────────────────────────────────────────────────────────────────");
  await send({
    label: "streak_milestone (rank 0 — FRONT-END member: LaunchPad primary + MachineIntro secondary)",
    pitchHtml: pitchRank0,
  });

  await send({
    label: "streak_milestone (rank 2 — 3-MONTH member: full Machine primary)",
    pitchHtml: pitchRank2,
  });

  const sent = manifest.filter((e) => e.ok);
  const failed = manifest.filter((e) => !e.ok);

  console.log("\n" + "─".repeat(72));
  console.log("  MANIFEST");
  console.log("─".repeat(72));
  console.log(`  Sent:   ${sent.length}`);
  console.log(`  Failed: ${failed.length}`);
  console.log();

  for (const entry of manifest) {
    const status = entry.ok ? "✓" : `✗ [${entry.failReason ?? "unknown"}]`;
    console.log(`  ${status} ${entry.num}. ${entry.label}`);
    console.log(`       Subject: ${entry.subject}`);
    console.log();
  }

  if (failed.length > 0) {
    console.log(`  ⚠  ${failed.length} send(s) did not go through. See manifest above.`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ Both acceptance emails delivered to ${RECIPIENT}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error("[acceptance] Fatal error:", err);
    process.exit(1);
  });
}
