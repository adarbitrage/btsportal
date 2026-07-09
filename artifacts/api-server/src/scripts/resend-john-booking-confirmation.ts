/**
 * resend-john-booking-confirmation.ts — Task #1790 acceptance send
 *
 * Sends ONE partner_call_confirmation email to adam@cherringtonmedia.com with
 * John's real roster row on the person card. Before the real send, a PRE-FLIGHT
 * PASS monkey-patches sgMail.send (nothing delivered), collects every unique
 * <img src> in the rendered HTML, and fetch-verifies each returns 200 +
 * image/*. If any asset fails (e.g. a root-relative path left un-qualified, or
 * a URL answered by the SPA catch-all as text/html), the entire run ABORTS
 * with a report — no real email is sent.
 *
 * Usage (via a temporary console workflow so SENDGRID_API_KEY is in process.env):
 *
 *   PORTAL_URL=https://portal.buildtestscale.com \
 *     npx tsx artifacts/api-server/src/scripts/resend-john-booking-confirmation.ts
 */

import sgMail from "@sendgrid/mail";
import { CommunicationService } from "../lib/communication-service.js";
import { renderPersonBlock } from "../lib/seed-templates.js";
import {
  getPortalUrl,
  __invalidatePortalUrlCacheForTests,
} from "../lib/portal-url-settings.js";
import {
  ensureSendGridInitialized,
} from "../lib/oncall-dispatcher.js";
import { db, partnersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const RECIPIENT = "adam@cherringtonmedia.com";
const MEMBER_NAME = "Adam Test";
const EXPECTED_PORTAL_URL = "https://portal.buildtestscale.com";
const MEMBER_TZ = "America/Chicago";

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
  console.log("  Task #1790 — acceptance send: John booking-confirmation re-send");
  console.log(`  Recipient: ${RECIPIENT}`);
  console.log(`  Date:      ${new Date().toUTCString()}`);
  console.log("=".repeat(72));

  initSendGrid();
  await assertPortalUrlPinned();

  // Load John's live roster row from the partners table.
  const [john] = await db
    .select({
      displayName: partnersTable.displayName,
      photoUrl: partnersTable.photoUrl,
      bio: partnersTable.bio,
    })
    .from(partnersTable)
    .where(and(eq(partnersTable.displayName, "John"), eq(partnersTable.isActive, true)))
    .limit(1);

  if (!john) {
    throw new Error('Active partner "John" not found in DB — aborting.');
  }
  console.log(`[roster] John: photoUrl=${john.photoUrl}, bio=${john.bio ? john.bio.slice(0, 60) + "..." : "(none)"}`);

  if (!john.photoUrl) {
    throw new Error("John's photoUrl is NULL in DB — task #1790 requires a photo to verify. Aborting.");
  }

  // Build the person block WITHOUT passing portalUrl — this is exactly the
  // pattern that triggered the bug (a caller omitting portalUrl). The fix
  // (getCommonVariables / qualifyPersonBlockImgSrcs) must resolve the
  // absolute URL at send time regardless.
  const personBlockHtml = renderPersonBlock({
    name: john.displayName,
    photoUrl: john.photoUrl,
    bio: john.bio,
    callTypeLabel: "Partner Call",
    dateTimeLabel: "Tuesday, July 15 at 2:00 PM CDT",
  });
  console.log(`[render] Person block built WITHOUT portalUrl (Task #1790 regression path).`);
  const hasRawRelativeSrc = personBlockHtml.includes('src="/partner-photos/');
  if (!hasRawRelativeSrc) {
    // Block was built with an absolute URL already (e.g. portalUrl leaked in
    // from env) — still fine, but log it so the operator sees the actual path.
    const hasAbsSrc = personBlockHtml.includes('src="https://');
    console.log(`[render] img src is already ${hasAbsSrc ? "absolute" : "absent"} — communication-service seam will still be exercised.`);
  } else {
    console.log(`[render] img src is root-relative ("/partner-photos/...") as expected — communication-service seam will qualify it.`);
  }

  const variables = {
    member_name: MEMBER_NAME,
    call_type_label: "Partner Call",
    datetime_label: "Tuesday, July 15 at 2:00 PM CDT",
    meeting_url: "https://meet.google.com/bts-task-1790",
    person_block_html: personBlockHtml,
  };

  // ── PRE-FLIGHT PASS ──────────────────────────────────────────────────────
  // Monkey-patch sgMail.send to capture rendered HTML without delivering.
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
    templateSlug: "partner_call_confirmation",
    to: RECIPIENT,
    variables,
  });

  // Restore the real send function.
  sgMail.send = originalSend;

  if (capturedHtmlParts.length === 0) {
    throw new Error("[preflight] No HTML captured — sendEmailNow may have been skipped (portal URL not configured?). Aborting.");
  }

  const allHtml = capturedHtmlParts.join("\n");
  const imgSrcs = [...new Set(extractImgSrcs(allHtml))];
  console.log(`[preflight] Found ${imgSrcs.length} unique img src(s):`);
  for (const src of imgSrcs) {
    console.log(`  ${src}`);
  }

  // Verify every img src is absolute and returns image/*.
  const failures: Array<{ src: string; status?: number; contentType?: string; error?: string }> = [];
  for (const src of imgSrcs) {
    if (!/^https?:\/\//i.test(src)) {
      failures.push({ src, error: "root-relative path escaped qualification — getCommonVariables seam did not qualify it" });
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
    console.error("\nABORTING — no real email sent.");
    process.exitCode = 1;
    return;
  }

  // ── REAL SEND ────────────────────────────────────────────────────────────
  console.log("\n[send] Pre-flight passed. Sending ONE real email to", RECIPIENT, "...");
  const result = await CommunicationService.sendEmailNow({
    templateSlug: "partner_call_confirmation",
    to: RECIPIENT,
    variables,
  });

  if (result.status === "sent") {
    console.log(`[send] ✓ Sent. logId=${result.logId ?? "(none)"}`);
    console.log(`\nAcceptance criteria: open Gmail as ${RECIPIENT} and confirm:`);
    console.log("  • The email shows John's face (photo) in the person card, not his initial.");
    console.log("  • The photo src in the email HTML is the absolute prod URL:");
    console.log(`    https://portal.buildtestscale.com/partner-photos/john.jpg`);
  } else {
    console.error(`[send] Unexpected result: status=${result.status} reason=${"reason" in result ? result.reason : "(none)"}`);
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("[resend-john] fatal:", err);
    process.exit(1);
  });
