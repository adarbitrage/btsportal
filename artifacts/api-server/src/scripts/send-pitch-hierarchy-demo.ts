/**
 * send-pitch-hierarchy-demo.ts — visual acceptance demo of the pitch-stack
 * hierarchy (primary / secondary / tertiary, single divider).
 *
 * WHY THIS EXISTS: the normal acceptance re-send script sends by raw email
 * address with no userId, so the pitch resolver (correctly) skips the pitch
 * stack entirely — and the acceptance recipient's real member account owns
 * nearly every product, so their live stack resolves to a single pitch.
 * Neither path can visually demonstrate the three-tier hierarchy.
 *
 * This script renders a DEMO stack of three compliance-safe pitch blocks
 * (LaunchPad primary, Mentorship secondary, Machine tertiary — VIP
 * Arbitrage is deliberately NOT used; it stays behind the counsel-review
 * gate) through the real `renderGatedPitchBlock` seam and the same stack
 * wrapper markup as `renderPitchStackHtml`, then supplies it as a
 * caller-provided `pitch_block_html` variable on a userId-less send — the
 * one seam where a caller override is honored.
 *
 * Same pre-flight discipline as resend-acceptance-email-polish.ts: capture
 * rendered HTML with a monkey-patched sgMail.send, verify every <img src>
 * is an absolute prod-host URL returning 200 + image/*, and only then send
 * for real.
 *
 * Run via a temporary console workflow so SENDGRID_API_KEY is in
 * process.env (bash/sandbox processes never have it):
 *
 *   PORTAL_URL=https://portal.buildtestscale.com \
 *   DEV_EMAIL_ALLOWLIST=adam@cherringtonmedia.com \
 *     node_modules/.bin/tsx src/scripts/send-pitch-hierarchy-demo.ts
 */

import sgMail from "@sendgrid/mail";
import { CommunicationService } from "../lib/communication-service.js";
import {
  getPortalUrl,
  __invalidatePortalUrlCacheForTests,
} from "../lib/portal-url-settings.js";
import { ensureSendGridInitialized } from "../lib/oncall-dispatcher.js";
import { renderGatedPitchBlock } from "../lib/pitch-resolver.js";
import { getAllPitchContent, type PitchBlockKey } from "../lib/pitch-content-settings.js";

const RECIPIENT = "adam@cherringtonmedia.com";
const EXPECTED_PORTAL_URL = "https://portal.buildtestscale.com";

/**
 * Demo stack: three compliance-safe blocks in descending visual weight.
 * VIP_ARBITRAGE_PITCH is deliberately excluded — its copy is gated behind
 * securities-counsel review and must never reach an inbox unreviewed, even
 * in a demo.
 */
const DEMO_STACK: PitchBlockKey[] = ["LAUNCHPAD_PITCH", "MENTORSHIP_PITCH", "MACHINE_PITCH"];

async function buildDemoPitchStackHtml(): Promise<string> {
  const contentByKey = await getAllPitchContent();
  const rows = DEMO_STACK.map((key, index) => {
    const emphasis = index === 0 ? "primary" : index === 1 ? "secondary" : "tertiary";
    const block = renderGatedPitchBlock(key, contentByKey[key], emphasis);
    if (!block) throw new Error(`Demo pitch block ${key} rendered empty — cannot demo the hierarchy.`);
    const topPadding = index === 0 ? "20px" : "14px";
    return `<tr><td style="padding:${topPadding} 0 0;">${block}</td></tr>`;
  });
  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;border-top:1px solid #e5e7eb;">
${rows.join("\n")}
</table>`;
}

function initSendGrid(): void {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("SENDGRID_API_KEY is not set — cannot send emails");
  sgMail.setApiKey(key);
  ensureSendGridInitialized();
}

async function assertPortalUrlPinned(): Promise<void> {
  __invalidatePortalUrlCacheForTests();
  const resolved = await getPortalUrl();
  if (resolved !== EXPECTED_PORTAL_URL) {
    throw new Error(
      `PORTAL_URL did not resolve to the production host. Got "${resolved}", expected "${EXPECTED_PORTAL_URL}". ABORTING — no email sent.`,
    );
  }
  console.log(`[init] Portal URL pinned: ${resolved}`);
}

function extractImgSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

async function checkImageUrl(
  url: string,
): Promise<{ ok: boolean; status?: number; contentType?: string; error?: string }> {
  try {
    const res = await fetch(url, { method: "GET" });
    const contentType = res.headers.get("content-type") ?? "";
    return { ok: res.ok && contentType.startsWith("image/"), status: res.status, contentType };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log("  Pitch-hierarchy visual demo send");
  console.log(`  Recipient: ${RECIPIENT}`);
  console.log(`  Stack:     ${DEMO_STACK.join(" > ")} (primary > secondary > tertiary)`);
  console.log(`  Date:      ${new Date().toUTCString()}`);
  console.log("=".repeat(72));

  initSendGrid();
  await assertPortalUrlPinned();

  const pitchBlockHtml = await buildDemoPitchStackHtml();
  console.log(`[demo] Built demo pitch stack (${pitchBlockHtml.length} chars, ${DEMO_STACK.length} blocks).`);

  const job = {
    templateSlug: "streak_milestone",
    variables: {
      member_name: "Adam Test",
      streak_count: "30",
      streak_label: "30-Day Streak",
      pitch_block_html: pitchBlockHtml,
    },
  };

  // ── PRE-FLIGHT ───────────────────────────────────────────────────────────
  console.log("\n[preflight] Monkey-patching sgMail.send to capture rendered HTML (no delivery)...");
  let capturedHtml = "";
  const originalSend = sgMail.send.bind(sgMail);
  (sgMail as unknown as { send: unknown }).send = async (msg: Parameters<typeof sgMail.send>[0]) => {
    const m = Array.isArray(msg) ? msg[0] : msg;
    const htmlContent =
      typeof m === "object" && m !== null && "content" in m
        ? (m as { content?: Array<{ type: string; value: string }> }).content?.find((c) => c.type === "text/html")?.value
        : typeof m === "object" && m !== null && "html" in m
          ? (m as { html?: string }).html
          : undefined;
    if (htmlContent) capturedHtml = htmlContent;
    return [{ statusCode: 202, headers: {}, body: "" }, {}] as unknown as ReturnType<typeof originalSend>;
  };

  const preflightResult = await CommunicationService.sendEmailNow({
    templateSlug: job.templateSlug,
    to: RECIPIENT,
    variables: job.variables,
  });
  sgMail.send = originalSend;
  if (preflightResult.status !== "sent" || !capturedHtml) {
    throw new Error(
      `[preflight] Unexpected result status=${preflightResult.status}; capturedHtml=${capturedHtml.length} chars. Aborting.`,
    );
  }

  const missing = DEMO_STACK.filter((key) => {
    const headingProbe = key === "LAUNCHPAD_PITCH" ? "LaunchPad" : key === "MENTORSHIP_PITCH" ? "Mentorship" : "Machine";
    return !capturedHtml.includes(headingProbe);
  });
  if (missing.length > 0) {
    throw new Error(`[preflight] Rendered email is missing expected pitch content for: ${missing.join(", ")}. Aborting.`);
  }
  console.log("[preflight] All three demo pitch blocks present in rendered HTML.");

  const imgSrcs = [...new Set(extractImgSrcs(capturedHtml))];
  console.log(`[preflight] Found ${imgSrcs.length} unique img src(s):`);
  const failures: Array<{ src: string; status?: number; contentType?: string; error?: string }> = [];
  for (const src of imgSrcs) {
    if (!/^https:\/\/portal\.buildtestscale\.com\//i.test(src)) {
      failures.push({ src, error: "not an absolute https://portal.buildtestscale.com/... URL" });
      continue;
    }
    const result = await checkImageUrl(src);
    if (!result.ok) failures.push({ src, ...result });
    else console.log(`[preflight] \u2713 ${src} \u2192 ${result.status} ${result.contentType}`);
  }
  if (failures.length > 0) {
    console.error("\n[preflight] FAILED — invalid image assets:");
    for (const f of failures) {
      console.error(`  \u2717 ${f.src}${f.status ? ` HTTP ${f.status} ${f.contentType}` : ""}${f.error ? ` error: ${f.error}` : ""}`);
    }
    console.error("\nABORTING — no real email sent.");
    process.exitCode = 1;
    return;
  }

  // ── REAL SEND ────────────────────────────────────────────────────────────
  console.log(`\n[send] Pre-flight passed. Sending demo email to ${RECIPIENT}...`);
  const result = await CommunicationService.sendEmailNow({
    templateSlug: job.templateSlug,
    to: RECIPIENT,
    variables: job.variables,
  });
  if (result.status !== "sent") {
    console.error(`[send] \u2717 unexpected result: status=${result.status} reason=${"reason" in result ? result.reason : "(none)"}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[send] \u2713 streak_milestone (with demo pitch stack) sent. logId=${result.logId ?? "(none)"}`);

  console.log("\nWhat to verify in this email:");
  console.log("  \u2022 ONE subtle divider line above the whole pitch area (none between pitches).");
  console.log("  \u2022 LaunchPad = the big primary offer (large heading, solid button).");
  console.log("  \u2022 Mentorship = smaller secondary mention (compact outline button).");
  console.log("  \u2022 Machine = one quiet fine-print line with a text link (no button).");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("[send-pitch-hierarchy-demo] fatal:", err);
    process.exit(1);
  });
