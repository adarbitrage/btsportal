/**
 * send-pitch-thumbnail-verification.ts — Task #1820 acceptance send
 *
 * Sends ONE session_feedback email to adam@cherringtonmedia.com with the
 * LAUNCHPAD_PITCH block populated, using its default thumbnail
 * (/images/pitch-thumbnails/launchpad-placeholder.gif). Before the real send,
 * a PRE-FLIGHT PASS monkey-patches sgMail.send (nothing delivered), collects
 * every unique <img src> in the rendered HTML, and fetch-verifies each
 * returns 200 + image/*. If any asset fails (e.g. the placeholder GIF hasn't
 * been published to the live portal host yet), the entire run ABORTS with a
 * report — no real email is sent.
 *
 * IMPORTANT: this script can only pass once the placeholder GIF asset has
 * been published to production (task agents cannot publish — see the
 * publish-and-canary-required-closeout pattern). Run this AFTER publish, via
 * a temporary console workflow so SENDGRID_API_KEY is in process.env:
 *
 *   PORTAL_URL=https://portal.buildtestscale.com \
 *     npx tsx artifacts/api-server/src/scripts/send-pitch-thumbnail-verification.ts
 */

import sgMail from "@sendgrid/mail";
import { CommunicationService } from "../lib/communication-service.js";
import { renderPitchBlock } from "../lib/seed-templates.js";
import { getAllPitchContent } from "../lib/pitch-content-settings.js";
import {
  getPortalUrl,
  __invalidatePortalUrlCacheForTests,
} from "../lib/portal-url-settings.js";
import { ensureSendGridInitialized } from "../lib/oncall-dispatcher.js";

const RECIPIENT = "adam@cherringtonmedia.com";
const MEMBER_NAME = "Adam Test";
const EXPECTED_PORTAL_URL = "https://portal.buildtestscale.com";

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
      `PORTAL_URL did not resolve to the production host. Got "${resolved}", expected "${EXPECTED_PORTAL_URL}". ` +
      `Set PORTAL_URL=${EXPECTED_PORTAL_URL} before running. ABORTING — no email sent.`,
    );
  }
  console.log(`[init] Portal URL pinned: ${resolved}`);
}

function extractImgSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}

async function checkImageUrl(
  url: string,
): Promise<{ ok: boolean; status?: number; contentType?: string; error?: string }> {
  try {
    const res = await fetch(url, { method: "GET" });
    const contentType = res.headers.get("content-type") ?? "";
    const ok = res.ok && contentType.startsWith("image/");
    return { ok, status: res.status, contentType };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log("  Task #1820 — acceptance send: pitch thumbnail verification");
  console.log(`  Recipient: ${RECIPIENT}`);
  console.log(`  Date:      ${new Date().toUTCString()}`);
  console.log("=".repeat(72));

  initSendGrid();
  await assertPortalUrlPinned();

  const contentByKey = await getAllPitchContent();
  const launchpad = contentByKey.LAUNCHPAD_PITCH;
  if (!launchpad) {
    throw new Error("LAUNCHPAD_PITCH content not found — aborting.");
  }
  if (!launchpad.thumbnailUrl || !launchpad.thumbnailLinkUrl) {
    throw new Error(
      "LAUNCHPAD_PITCH has no thumbnail configured — expected the default placeholder GIF to be wired in. Aborting.",
    );
  }
  console.log(`[content] LAUNCHPAD_PITCH thumbnailUrl=${launchpad.thumbnailUrl}`);

  const pitchBlockHtml = renderPitchBlock(launchpad);

  const variables = {
    member_name: MEMBER_NAME,
    pitch_block_html: pitchBlockHtml,
  };

  // ── PRE-FLIGHT PASS ──────────────────────────────────────────────────────
  console.log("\n[preflight] Monkey-patching sgMail.send to capture rendered HTML (no delivery)...");
  const capturedHtmlParts: string[] = [];
  const originalSend = sgMail.send.bind(sgMail);
  (sgMail as unknown as { send: unknown }).send = async (msg: Parameters<typeof sgMail.send>[0]) => {
    const m = Array.isArray(msg) ? msg[0] : msg;
    const htmlContent = typeof m === "object" && m !== null && "content" in m
      ? (m as { content?: Array<{ type: string; value: string }> }).content?.find((c) => c.type === "text/html")?.value
      : typeof m === "object" && m !== null && "html" in m
        ? (m as { html?: string }).html
        : undefined;
    if (htmlContent) capturedHtmlParts.push(htmlContent);
    return [{ statusCode: 202, headers: {}, body: "" }, {}] as unknown as ReturnType<typeof originalSend>;
  };

  await CommunicationService.sendEmailNow({
    templateSlug: "session_feedback",
    to: RECIPIENT,
    variables,
  });

  sgMail.send = originalSend;

  if (capturedHtmlParts.length === 0) {
    throw new Error("[preflight] No HTML captured — sendEmailNow may have been skipped. Aborting.");
  }

  const allHtml = capturedHtmlParts.join("\n");
  const imgSrcs = [...new Set(extractImgSrcs(allHtml))];
  console.log(`[preflight] Found ${imgSrcs.length} unique img src(s):`);
  for (const src of imgSrcs) {
    console.log(`  ${src}`);
  }

  const failures: Array<{ src: string; status?: number; contentType?: string; error?: string }> = [];
  for (const src of imgSrcs) {
    if (!/^https?:\/\//i.test(src)) {
      failures.push({ src, error: "root-relative path escaped qualification" });
      continue;
    }
    const result = await checkImageUrl(src);
    if (!result.ok) {
      failures.push({ src, ...result });
    } else {
      console.log(`[preflight] ✓ ${src} → ${result.status} ${result.contentType}`);
    }
  }

  if (failures.length > 0) {
    console.error("\n[preflight] FAILED — the following assets are not valid images:");
    for (const f of failures) {
      console.error(`  ✗ ${f.src}`);
      if (f.status) console.error(`    HTTP ${f.status} content-type=${f.contentType}`);
      if (f.error) console.error(`    error: ${f.error}`);
    }
    console.error(
      "\nABORTING — no real email sent. If the pitch thumbnail 404s, confirm the app has been " +
      "published since the placeholder GIF was added (artifacts/portal/public/images/pitch-thumbnails/launchpad-placeholder.gif).",
    );
    process.exitCode = 1;
    return;
  }

  // ── REAL SEND ────────────────────────────────────────────────────────────
  console.log("\n[send] Pre-flight passed. Sending ONE real email to", RECIPIENT, "...");
  const result = await CommunicationService.sendEmailNow({
    templateSlug: "session_feedback",
    to: RECIPIENT,
    variables,
  });

  if (result.status === "sent") {
    console.log(`[send] ✓ Sent. logId=${result.logId ?? "(none)"}`);
    console.log(`\nAcceptance criteria: open Gmail as ${RECIPIENT} and confirm:`);
    console.log("  • The pitch block shows a small animated GIF thumbnail above the LaunchPad heading.");
    console.log("  • The thumbnail is clickable and links to the plans page.");
    console.log("  • The rest of the email (and any pitch block WITHOUT a thumbnail configured) renders exactly as before — no layout shift.");
  } else {
    console.error(`[send] Unexpected result: status=${result.status} reason=${"reason" in result ? result.reason : "(none)"}`);
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("[send-pitch-thumbnail-verification] fatal:", err);
    process.exit(1);
  });
