/**
 * resend-acceptance-email-polish.ts — Task #1831 acceptance re-send
 *
 * Re-sends password_reset, streak_milestone, and email_verification to
 * adam@cherringtonmedia.com so the email-polish fixes can be visually
 * accepted:
 *   1. Recurring header-logo broken-image regression fix.
 *   2. Pitch-stack visual hierarchy (primary/secondary/tertiary, single
 *      divider, no divider-per-pitch).
 *   3. Legal footer typography shrunk ~2 sizes (content/dark-mode lock
 *      preserved).
 *
 * A PRE-FLIGHT PASS (matching the pattern in blast-all-emails-v2.ts /
 * send-pitch-thumbnail-verification.ts) monkey-patches sgMail.send (nothing
 * delivered), collects every unique <img src> across all three rendered
 * emails, and fetch-verifies each returns 200 + image/*. If any asset
 * fails, the whole run ABORTS with a report — no real email is sent. Only
 * after pre-flight passes does the real send run through the unmodified
 * sgMail.send.
 *
 * Run via a temporary console workflow so SENDGRID_API_KEY is in
 * process.env (bash/sandbox processes never have it):
 *
 *   PORTAL_URL=https://portal.buildtestscale.com \
 *     npx tsx artifacts/api-server/src/scripts/resend-acceptance-email-polish.ts
 */

import sgMail from "@sendgrid/mail";
import { CommunicationService } from "../lib/communication-service.js";
import {
  getPortalUrl,
  __invalidatePortalUrlCacheForTests,
} from "../lib/portal-url-settings.js";
import { ensureSendGridInitialized } from "../lib/oncall-dispatcher.js";

const RECIPIENT = "adam@cherringtonmedia.com";
const EXPECTED_PORTAL_URL = "https://portal.buildtestscale.com";

const JOBS: Array<{ templateSlug: string; variables: Record<string, string> }> = [
  {
    templateSlug: "password_reset",
    variables: {
      member_name: "Adam Test",
      reset_url: `${EXPECTED_PORTAL_URL}/reset-password?token=acceptance-test-token-not-real`,
    },
  },
  {
    templateSlug: "streak_milestone",
    variables: {
      member_name: "Adam Test",
      streak_count: "30",
      streak_label: "30-Day Streak",
    },
  },
  {
    templateSlug: "email_verification",
    variables: {
      member_name: "Adam Test",
      verification_url: `${EXPECTED_PORTAL_URL}/verify-email?token=acceptance-test-token-not-real`,
    },
  },
];

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
  console.log("  Task #1831 — acceptance re-send: email polish fixes");
  console.log(`  Recipient: ${RECIPIENT}`);
  console.log(`  Templates: ${JOBS.map((j) => j.templateSlug).join(", ")}`);
  console.log(`  Date:      ${new Date().toUTCString()}`);
  console.log("=".repeat(72));

  initSendGrid();
  await assertPortalUrlPinned();

  // ── PRE-FLIGHT PASS ──────────────────────────────────────────────────────
  console.log("\n[preflight] Monkey-patching sgMail.send to capture rendered HTML (no delivery)...");
  const capturedHtmlParts: string[] = [];
  const originalSend = sgMail.send.bind(sgMail);
  (sgMail as unknown as { send: unknown }).send = async (msg: Parameters<typeof sgMail.send>[0]) => {
    const m = Array.isArray(msg) ? msg[0] : msg;
    const htmlContent =
      typeof m === "object" && m !== null && "content" in m
        ? (m as { content?: Array<{ type: string; value: string }> }).content?.find((c) => c.type === "text/html")?.value
        : typeof m === "object" && m !== null && "html" in m
          ? (m as { html?: string }).html
          : undefined;
    if (htmlContent) capturedHtmlParts.push(htmlContent);
    return [{ statusCode: 202, headers: {}, body: "" }, {}] as unknown as ReturnType<typeof originalSend>;
  };

  for (const job of JOBS) {
    const result = await CommunicationService.sendEmailNow({
      templateSlug: job.templateSlug,
      to: RECIPIENT,
      variables: job.variables,
    });
    if (result.status !== "sent") {
      sgMail.send = originalSend;
      throw new Error(
        `[preflight] ${job.templateSlug}: unexpected result status=${result.status} reason=${"reason" in result ? result.reason : "(none)"}. Aborting.`,
      );
    }
  }

  sgMail.send = originalSend;

  if (capturedHtmlParts.length !== JOBS.length) {
    throw new Error(
      `[preflight] Expected ${JOBS.length} captured HTML bodies, got ${capturedHtmlParts.length}. Aborting.`,
    );
  }

  const allHtml = capturedHtmlParts.join("\n");
  const imgSrcs = [...new Set(extractImgSrcs(allHtml))];
  console.log(`[preflight] Found ${imgSrcs.length} unique img src(s) across all ${JOBS.length} templates:`);
  for (const src of imgSrcs) {
    console.log(`  ${src}`);
  }

  const failures: Array<{ src: string; status?: number; contentType?: string; error?: string }> = [];
  for (const src of imgSrcs) {
    if (!/^https:\/\/portal\.buildtestscale\.com\//i.test(src)) {
      failures.push({ src, error: "not an absolute https://portal.buildtestscale.com/... URL" });
      continue;
    }
    const result = await checkImageUrl(src);
    if (!result.ok) {
      failures.push({ src, ...result });
    } else {
      console.log(`[preflight] \u2713 ${src} \u2192 ${result.status} ${result.contentType}`);
    }
  }

  if (failures.length > 0) {
    console.error("\n[preflight] FAILED — the following assets are not valid absolute-prod-host images:");
    for (const f of failures) {
      console.error(`  \u2717 ${f.src}`);
      if (f.status) console.error(`    HTTP ${f.status} content-type=${f.contentType}`);
      if (f.error) console.error(`    error: ${f.error}`);
    }
    console.error("\nABORTING — no real email sent.");
    process.exitCode = 1;
    return;
  }

  // ── REAL SEND ────────────────────────────────────────────────────────────
  console.log(`\n[send] Pre-flight passed. Sending ${JOBS.length} real emails to ${RECIPIENT}...`);
  let anyFailed = false;
  for (const job of JOBS) {
    const result = await CommunicationService.sendEmailNow({
      templateSlug: job.templateSlug,
      to: RECIPIENT,
      variables: job.variables,
    });
    if (result.status === "sent") {
      console.log(`[send] \u2713 ${job.templateSlug} sent. logId=${result.logId ?? "(none)"}`);
    } else {
      anyFailed = true;
      console.error(`[send] \u2717 ${job.templateSlug} unexpected result: status=${result.status} reason=${"reason" in result ? result.reason : "(none)"}`);
    }
  }

  if (anyFailed) {
    process.exitCode = 1;
    return;
  }

  console.log(`\nAcceptance criteria: open Gmail as ${RECIPIENT} and confirm for each email:`);
  console.log("  • The header logo renders (no broken-image icon).");
  console.log("  • If a pitch stack is present, it reads as one clear primary offer with smaller secondary/tertiary mentions and exactly ONE divider above the stack.");
  console.log("  • The legal footer text is visibly smaller than before, still fully legible, in the existing dark-mode-locked footer band.");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("[resend-acceptance-email-polish] fatal:", err);
    process.exit(1);
  });
