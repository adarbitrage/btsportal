import { db, emailTemplatesTable, emailTemplateVersionsTable, smsTemplatesTable } from "@workspace/db";
import { sql, eq, inArray, desc } from "drizzle-orm";
import crypto from "node:crypto";

// Task #1714: single-source brand accent, reused by the layout below and by
// any future non-BTS wordmark rendering (see communication-service.ts's
// `logo_html`/`company_name` tokens, which choose between the hosted BTS
// logo image and a styled text wordmark per-brand at render time).
const BTS_ACCENT_COLOR = "#1a56db";

/**
 * Condensed disclaimer exported for backward compat; the lifecycle email
 * footer now renders the full three-paragraph verbatim disclaimer instead
 * (see `wrapHtml`). Kept so existing imports don't break.
 * @deprecated Use the full footer disclaimer rendered inside `wrapHtml`.
 */
export const NO_GUARANTEE_DISCLAIMER =
  "*DISCLAIMER: There is NO GUARANTEE and NO WARRANTY that employing the same techniques, ideas, strategies, products or services detailed here will produce the same results. Your earning potential is entirely dependent upon you, your skills, financial resources, marketing knowledge and the time you devote. THE LEVEL OF SUCCESS YOU REACH IS ENTIRELY DEPENDENT UPON YOUR OWN EFFORT AND DEDICATION.";

/**
 * The shared branded HTML layout. Every member-facing DB template's
 * `htmlBody` is built by wrapping an inner-body fragment with this function,
 * so redesigning it here re-skins all starter templates at once (Task
 * #1714). Two optional slots are always emitted as `{{...}}` tokens (never
 * baked-in HTML) so per-send data — which isn't known at module-load time —
 * can be threaded in later via `communication-service.ts`'s variable
 * substitution:
 *   - `{{person_block_html}}` — booking person-block card (see
 *     `renderPersonBlock`), empty string when not a booking send.
 *   - `{{pitch_block_html}}` — footer-adjacent pitch slot (see
 *     `renderPitchBlock`), empty string when unpopulated. This task builds
 *     only the empty-safe slot; the resolver that fills it is out of scope.
 * `getCommonVariables` supplies `""` defaults for both tokens so templates
 * that never pass them render cleanly instead of leaking a literal
 * `{{person_block_html}}` into the email.
 *
 * The header logo is itself a token (`{{logo_html}}`) resolved by
 * `getCommonVariables`: lifecycle sends (the only case today) render the
 * hosted BTS logo image; a future brand-substituted nurture send would
 * resolve to a styled text wordmark instead (see the doc comment there).
 *
 * Footer (Task #1782): full legal footer matching buildtestscale.com — dark
 * navy block, 9 canonical links (two rows), exact copyright entity string
 * with dynamic `{{current_year}}`, and the three-paragraph verbatim
 * disclaimer with email-safe inline bold/underline treatment.
 */
function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
<tr><td style="padding:28px 30px;text-align:center;border-bottom:3px solid ${BTS_ACCENT_COLOR};">
{{logo_html}}
</td></tr>
<tr><td style="padding:30px;color:#1a1a2e;">
${body}
{{person_block_html}}
{{pitch_block_html}}
</td></tr>
<tr><td bgcolor="#0f172a" data-ogsb="#0f172a" data-ogsc="#94a3b8" style="background:#0f172a !important;background-color:#0f172a !important;padding:32px 30px;text-align:center;">
<p style="margin:0 0 10px;font-size:12px;line-height:2.2;">
<a href="https://buildtestscale.com/privacy-policy" style="color:#94a3b8;text-decoration:none;margin:0 5px;white-space:nowrap;">Privacy Policy</a>
<span style="color:#334155;">&#124;</span>
<a href="https://buildtestscale.com/terms-of-service" style="color:#94a3b8;text-decoration:none;margin:0 5px;white-space:nowrap;">Terms of Use</a>
<span style="color:#334155;">&#124;</span>
<a href="https://buildtestscale.com/earnings-disclaimer" style="color:#94a3b8;text-decoration:none;margin:0 5px;white-space:nowrap;">Earnings Disclaimer</a>
<span style="color:#334155;">&#124;</span>
<a href="https://buildtestscale.com/affiliate-disclaimer" style="color:#94a3b8;text-decoration:none;margin:0 5px;white-space:nowrap;">Affiliate Disclaimer</a>
<span style="color:#334155;">&#124;</span>
<a href="https://buildtestscale.com/dmca-policy" style="color:#94a3b8;text-decoration:none;margin:0 5px;white-space:nowrap;">DMCA Policy</a>
<span style="color:#334155;">&#124;</span>
<a href="https://buildtestscale.com/accessibility-statement" style="color:#94a3b8;text-decoration:none;margin:0 5px;white-space:nowrap;">Accessibility</a>
<span style="color:#334155;">&#124;</span>
<a href="https://buildtestscale.com/sms-terms-and-conditions" style="color:#94a3b8;text-decoration:none;margin:0 5px;white-space:nowrap;">SMS Terms</a>
<span style="color:#334155;">&#124;</span>
<a href="https://buildtestscale.com/performance-guarantee" style="color:#94a3b8;text-decoration:none;margin:0 5px;white-space:nowrap;">Refund Policy</a>
</p>
<p style="margin:0 0 16px;font-size:12px;">
<a href="https://buildtestscale.com/contact-us" style="color:#94a3b8;text-decoration:none;">Contact Us</a>
</p>
<p style="margin:0 0 18px;font-size:12px;color:#64748b;">Copyright {{current_year}} Build. Test. Scale., LLC dba Build, Test, Scale&#8482;</p>
<p style="margin:0 0 10px;font-size:11px;color:#64748b;line-height:1.6;text-align:left;"><u><b>*DISCLAIMER</b></u>: We are committed to transparency and integrity. Please understand that building a successful business takes time, effort, and dedication. We do not promote &#x201C;get rich quick&#x201D; schemes. The results you achieve will depend on your own background, dedication, desire, and motivation.</p>
<p style="margin:0 0 10px;font-size:11px;color:#64748b;line-height:1.6;text-align:left;">There is <u><b>NO GUARANTEE</b></u> and <u><b>NO WARRANTY</b></u> that employing the same techniques, ideas, strategies, products or services that are detailed on buildtestscale.com will produce the same results for you and/or your web properties. Historical performance is not indicative of future results. Examples that may be provided in articles, videos and other sources on the site are just that &#8211; examples. They may or may not work for your specific situation and are not to be interpreted as a guarantee or promise of earnings.</p>
<p style="margin:0;font-size:11px;color:#64748b;line-height:1.6;text-align:left;">The materials provided on buildtestscale.com are not to be interpreted as a &#x201C;get rich quick&#x201D; scheme in any way. Your earning potential is entirely dependent upon you, and the then current state of web marketing at the time you employ such techniques and ideas. <b>THE LEVEL OF SUCCESS YOU REACH EMPLOYING THESE TECHNIQUES AND IDEAS IS ENTIRELY DEPENDENT UPON YOUR SKILLS, FINANCIAL RESOURCES, MARKETING KNOWLEDGE AND TIME YOU DEVOTE TO BECOMING AN ONLINE SUCCESS. BECAUSE OF THIS, WE CANNOT GUARANTEE YOUR EARNINGS LEVEL NOR DO WE IN ANY WAY WHETHER DIRECTLY OR INDIRECTLY DO SO.</b></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}


/**
 * Task #1717: the single URL-qualifying seam for any image reference stored
 * on a DB row (coach/partner `photoUrl`) that gets rendered into a sent
 * email. Gmail proxies every `<img src>` through its own fetcher — it never
 * has the member's browser origin to resolve a root-relative path against,
 * so a stored value like `/coaching-photos/sasha.png` renders as a broken
 * image box. This resolves any such path into an absolute HTTPS URL against
 * the configured public portal host (same source as `{{portal_url}}`).
 *
 * Degrades gracefully (returns `null`, never an unusable URL) when:
 *   - `assetPath` is empty/null.
 *   - the path is an internal object-storage path (`/objects/...`) — those
 *     are served behind portal auth and can never be fetched by Gmail's
 *     anonymous image proxy.
 *   - no portal host is configured at all (can't build an absolute URL).
 * An already-absolute `http(s)://` value is passed through unchanged.
 */
/**
 * Task #1790: post-process a pre-rendered person-block HTML string to qualify
 * any root-relative `<img src="/...">` attributes to absolute URLs against
 * the supplied portal host. This is the mandatory send-time backstop called
 * from `getCommonVariables` in communication-service.ts — the same seam that
 * qualifies the logo — so photo URLs are guaranteed absolute in every sent
 * email regardless of whether the renderPersonBlock caller remembered to
 * thread portalUrl.
 *
 * Only rewrites `src="/non-objects/..."` — /objects/ paths are auth-gated
 * and were already rendered as the initials avatar in renderPersonBlock.
 * Already-absolute `src="https://..."` values pass through unchanged.
 * Returns the input unchanged when `portalUrl` is absent.
 */
export function qualifyPersonBlockImgSrcs(
  personBlockHtml: string,
  portalUrl: string | null | undefined,
): string {
  if (!personBlockHtml || !portalUrl) return personBlockHtml;
  return personBlockHtml.replace(
    /(<img(?:[^>]*)\ssrc=")(\/((?!objects\/)[^"]+))(")/gi,
    (_, pre, path, _inner, post) => `${pre}${portalUrl}${path}${post}`,
  );
}

export function qualifyPublicAssetUrl(
  assetPath: string | null | undefined,
  portalUrl: string | null | undefined,
): string | null {
  if (!assetPath) return null;
  const trimmed = assetPath.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/objects/")) return null;
  if (!portalUrl) return null;
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${portalUrl}${path}`;
}

/**
 * Booking person-block card: photo, name, call type + labeled datetime, and
 * bio when present. Null-graceful — a missing photo simply omits the `<img>`
 * and a missing bio simply omits the bio paragraph; nothing renders at all
 * when `params` is `null`. Matches the portal's one-card-per-call visual
 * language (rounded card, avatar + name row).
 *
 * Called at SEND TIME (not module load) by `scheduled-comms.ts` and
 * `call-bookings.ts`, since the staff photo/bio/call time are per-send data
 * unknown when the starter template strings are built. The resulting HTML
 * string is passed as the `person_block_html` template variable.
 *
 * `portalUrl` is optional: when supplied, root-relative photo paths are
 * qualified to an absolute URL immediately via `qualifyPublicAssetUrl`
 * (Task #1717). When absent, root-relative paths are emitted as raw
 * `<img src="/...">` into the returned HTML so the communication-service
 * seam (`getCommonVariables` / `qualifyPersonBlockImgSrcs`, Task #1790) can
 * re-qualify them at send time using the portal host it resolves
 * independently — guaranteeing an absolute URL in every sent email regardless
 * of whether the caller remembered to thread `portalUrl`. Only genuinely-NULL
 * photos and internal `/objects/...` paths (auth-gated, never publicly
 * fetchable) degrade to the initials avatar.
 */
export function renderPersonBlock(params: {
  name: string;
  photoUrl?: string | null;
  bio?: string | null;
  callTypeLabel: string;
  dateTimeLabel: string;
  portalUrl?: string | null;
} | null): string {
  if (!params) return "";
  const { name, photoUrl, bio, callTypeLabel, dateTimeLabel, portalUrl } = params;
  const qualifiedPhotoUrl = qualifyPublicAssetUrl(photoUrl, portalUrl);
  // Task #1790: if qualification returned null because portalUrl was absent at
  // this call site, but the photo IS a real public-asset path (not /objects/,
  // not null/empty), render the raw path into the <img> rather than falling
  // back to initials. The communication-service seam (getCommonVariables)
  // will re-qualify every root-relative img src against the portalUrl it
  // resolves independently — guaranteeing the absolute URL is in the sent
  // email even when a caller (e.g. preview-emails.ts) omitted portalUrl.
  // /objects/ paths and genuinely-absent photos still degrade to initials
  // here because they are either auth-gated (never publicly fetchable by
  // Gmail's proxy) or simply unavailable.
  const trimmedPhoto = photoUrl?.trim() ?? null;
  const photoSrc: string | null =
    qualifiedPhotoUrl ??
    (trimmedPhoto && !trimmedPhoto.startsWith("/objects/") ? trimmedPhoto : null);
  const avatar = photoSrc
    ? `<img src="${photoSrc}" alt="${name}" width="56" height="56" style="width:56px;height:56px;border-radius:50%;object-fit:cover;display:block;border:0;">`
    : `<div style="width:56px;height:56px;border-radius:50%;background:${BTS_ACCENT_COLOR};color:#ffffff;font-size:22px;font-weight:bold;text-align:center;line-height:56px;">${(name || "?").trim().charAt(0).toUpperCase()}</div>`;
  const bioHtml = bio
    ? `<p style="margin:10px 0 0;font-size:13px;color:#4b5563;line-height:1.5;">${bio}</p>`
    : "";
  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:8px;">
<tr><td style="padding:18px 20px;">
<table cellpadding="0" cellspacing="0"><tr>
<td style="width:56px;vertical-align:top;">${avatar}</td>
<td style="padding-left:14px;vertical-align:top;">
<p style="margin:0;font-size:15px;font-weight:bold;color:#1a1a2e;">${name}</p>
<p style="margin:4px 0 0;font-size:13px;color:${BTS_ACCENT_COLOR};font-weight:600;">${callTypeLabel}</p>
<p style="margin:2px 0 0;font-size:13px;color:#4b5563;">${dateTimeLabel}</p>
</td>
</tr></table>
${bioHtml}
</td></tr>
</table>`;
}

/**
 * Optional footer-adjacent pitch slot: small heading, one line of copy, one
 * button. Renders nothing when `params` is `null` — this task builds only
 * the empty-safe slot; the resolver that decides what pitch to show (if any)
 * for a given send is a separate future task.
 */
export function renderPitchBlock(params: {
  heading: string;
  line: string;
  buttonLabel: string;
  buttonUrl: string;
  /**
   * Task #1820: optional video-style visual hook rendered above the
   * heading — an `<a href="thumbnailLinkUrl"><img src="thumbnailUrl"></a>`,
   * email-safe (width attribute + inline `max-width:100%`, no CSS overlays
   * — the play button must be baked into the image file itself). Renders
   * nothing extra when either field is absent; both must be set together to
   * render (a thumbnail with no link target would be dead weight, and a
   * link with no image has nothing to click).
   */
  thumbnailUrl?: string;
  thumbnailLinkUrl?: string;
} | null): string {
  if (!params) return "";
  const { heading, line, buttonLabel, buttonUrl, thumbnailUrl, thumbnailLinkUrl } = params;
  // Restrained ~280px wide per the task's stacking discipline — with up to
  // three pitch blocks stacked at the bottom of an email, full-bleed
  // animated GIFs would turn the footer into a billboard.
  const thumbnailHtml =
    thumbnailUrl && thumbnailLinkUrl
      ? `<tr><td style="padding:0 0 14px;text-align:center;">
<a href="${thumbnailLinkUrl}" style="text-decoration:none;"><img src="${thumbnailUrl}" alt="${heading}" width="280" style="width:280px;max-width:100%;height:auto;display:inline-block;border:0;border-radius:6px;"></a>
</td></tr>`
      : "";
  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-top:1px solid #e5e7eb;">
<tr><td style="padding:20px 0 0;text-align:center;">
<table width="100%" cellpadding="0" cellspacing="0">
${thumbnailHtml}
<tr><td style="text-align:center;">
<p style="margin:0 0 4px;font-size:15px;font-weight:bold;color:#1a1a2e;">${heading}</p>
<p style="margin:0 0 14px;font-size:14px;color:#4b5563;">${line}</p>
<a href="${buttonUrl}" style="display:inline-block;background:${BTS_ACCENT_COLOR};color:#ffffff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;">${buttonLabel}</a>
</td></tr>
</table>
</td></tr>
</table>`;
}

const transactionalEmailTemplates = [
  {
    slug: "welcome",
    name: "Welcome Email",
    subject: "Welcome to Build Test Scale™, {{member_name}}!",
    htmlBody: wrapHtml("Welcome", `
<h2 style="color:#1a1a2e;margin-top:0;">Welcome to Build Test Scale™!</h2>
<p>Hi {{member_name}},</p>
<p>We're thrilled to have you join the BTS community. Your account has been created and you're ready to start your journey.</p>
<p>Your temporary password is: <strong>{{temp_password}}</strong></p>
<p>Please log in and change your password as soon as possible.</p>
<p><a href="{{portal_url}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Log In to Your Portal</a></p>
<p>If you have any questions, reply to this email or reach out to {{support_email}}.</p>
<p>Welcome aboard!<br>The BTS Team</p>`),
    textBody: "Welcome to Build Test Scale™, {{member_name}}!\n\nYour temporary password is: {{temp_password}}\n\nLog in at {{portal_url}} and change your password.\n\nWelcome aboard!\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "temp_password", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "email_verification",
    name: "Email Verification",
    subject: "Verify your email address",
    htmlBody: wrapHtml("Email Verification", `
<h2 style="color:#1a1a2e;margin-top:0;">Verify Your Email</h2>
<p>Hi {{member_name}},</p>
<p>Please verify your email address to complete your account setup.</p>
<p><a href="{{portal_url}}/verify-email?token={{verify_token}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Verify Email</a></p>
<p>This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nVerify your email: {{portal_url}}/verify-email?token={{verify_token}}\n\nThis link expires in 24 hours.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "verify_token", "portal_url", "current_year"],
  },
  {
    slug: "password_reset",
    name: "Password Reset",
    subject: "Reset your password",
    htmlBody: wrapHtml("Password Reset", `
<h2 style="color:#1a1a2e;margin-top:0;">Reset Your Password</h2>
<p>Hi {{member_name}},</p>
<p>We received a request to reset your password. Click the button below to set a new password.</p>
<p><a href="{{portal_url}}/reset-password?token={{reset_token}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password</a></p>
<p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nReset your password: {{portal_url}}/reset-password?token={{reset_token}}\n\nThis link expires in 1 hour.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "reset_token", "portal_url", "current_year"],
  },
  {
    slug: "signup_attempted",
    name: "Signup Attempted on Existing Email",
    subject: "Someone tried to sign up with your email",
    htmlBody: wrapHtml("Signup Attempted", `
<h2 style="color:#1a1a2e;margin-top:0;">Signup Attempt on Your Account</h2>
<p>Hi {{member_name}},</p>
<p>Someone just tried to create a new Build Test Scale™ account using <strong>{{member_email}}</strong>. Since this address already has an account, no new account was created.</p>
<p>If this was you, you can sign in or reset your password instead — there's no need to create a new account:</p>
<p>
<a href="{{portal_url}}/login?email={{member_email_encoded}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-right:8px;">Sign In</a>
<a href="{{portal_url}}/forgot-password?email={{member_email_encoded}}" style="display:inline-block;background:#ffffff;color:#4f46e5;border:1px solid #4f46e5;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password</a>
</p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If this <strong>wasn't you</strong>, you can safely ignore this email — your account is unchanged. If you're seeing repeated attempts, contact <a href="mailto:{{support_email}}" style="color:#4f46e5;">{{support_email}}</a>.</p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nSomeone just tried to create a new Build Test Scale™ account using {{member_email}}. Since this address already has an account, no new account was created.\n\nIf this was you, sign in: {{portal_url}}/login?email={{member_email_encoded}}\nOr reset your password: {{portal_url}}/forgot-password?email={{member_email_encoded}}\n\nIf this wasn't you, you can ignore this email — your account is unchanged.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "member_email", "member_email_encoded", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "new_device_signin",
    name: "New Sign-in Detected",
    subject: "New sign-in to your Build Test Scale™ account",
    htmlBody: wrapHtml("New Sign-in Detected", `
<h2 style="color:#1a1a2e;margin-top:0;">New Sign-in Detected</h2>
<p>Hi {{member_name}},</p>
<p>Your Build Test Scale™ account was just signed in to from a device we haven't seen before:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;">
<strong>Device:</strong> {{device_description}}<br>
<strong>IP address:</strong> {{ip_address}}<br>
<strong>When:</strong> {{sign_in_time}}
</p>
<p>If this was you, no action is needed.</p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If this <strong>wasn't you</strong>, your account may be compromised. Review where you're signed in and sign out the device you don't recognize, then change your password right away.</p>
<p><a href="{{portal_url}}/account#sessions" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Review your devices</a></p>
<p>Questions? Contact <a href="mailto:{{support_email}}" style="color:#4f46e5;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour Build Test Scale™ account was just signed in to from a device we haven't seen before:\n\nDevice: {{device_description}}\nIP address: {{ip_address}}\nWhen: {{sign_in_time}}\n\nIf this was you, no action is needed.\n\nIf this wasn't you, your account may be compromised. Review where you're signed in and sign out the device you don't recognize, then change your password right away:\n{{portal_url}}/account#sessions\n\nQuestions? Contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "device_description", "ip_address", "sign_in_time", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "email_change_verify",
    name: "Email Change Verification",
    subject: "Confirm your new Build Test Scale™ email address",
    htmlBody: wrapHtml("Confirm New Email", `
<h2 style="color:#1a1a2e;margin-top:0;">Confirm Your New Email</h2>
<p>Hi {{member_name}},</p>
<p>We received a request to change the email address on your Build Test Scale™ account from <strong>{{old_email}}</strong> to <strong>{{new_email}}</strong>.</p>
<p>Click the button below within 24 hours to confirm this change. After confirming, you'll need to sign in again using your new email address.</p>
<p><a href="{{portal_url}}/verify-email-change?token={{verify_token}}" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Confirm New Email</a></p>
<p>If you didn't request this change, you can safely ignore this email — your address will stay the same.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nConfirm changing your Build Test Scale™ email from {{old_email}} to {{new_email}}:\n{{portal_url}}/verify-email-change?token={{verify_token}}\n\nThis link expires in 24 hours. If you didn't request this, ignore this email.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "old_email", "new_email", "verify_token", "portal_url", "current_year"],
  },
  {
    slug: "email_change_notice",
    name: "Email Change Notice (Old Address)",
    subject: "Email change requested on your Build Test Scale™ account",
    htmlBody: wrapHtml("Email Change Requested", `
<h2 style="color:#1a1a2e;margin-top:0;">Email Change Requested</h2>
<p>Hi {{member_name}},</p>
<p>We received a request to change the email address on your Build Test Scale™ account to <strong>{{new_email}}</strong>. The change will only take effect once it's confirmed from the new address.</p>
<p>If this was you, no further action is needed at this address — just confirm the change from your new inbox.</p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If this <strong>wasn't you</strong>, please sign in and reset your password immediately, then contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>. Your current email address will keep working until the new one is confirmed.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nWe received a request to change your Build Test Scale™ email to {{new_email}}. The change only takes effect after it's confirmed from the new address.\n\nIf this wasn't you, sign in and reset your password immediately, then contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "new_email", "support_email", "portal_url", "current_year"],
  },
  {
    slug: "email_change_cancelled_by_admin",
    name: "Email Change Cancelled by Admin",
    subject: "Your pending email change was cancelled by Build Test Scale™ support",
    htmlBody: wrapHtml("Pending Email Change Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hi {{member_name}},</p>
<p>Our support team has cancelled the pending email change on your Build Test Scale™ account. The address we had queued — <strong>{{cancelled_pending_email}}</strong> — has been discarded and was never activated.</p>
<p>Your account email remains <strong>{{member_email}}</strong>, which is the address you should keep using to sign in. <strong>No further action is required from you.</strong></p>
<p>If you still meant to switch your account to <strong>{{cancelled_pending_email}}</strong> (or another address), use the button below — we'll drop you straight onto the email-change form with the previously requested address pre-filled so you don't have to retype it. You'll still need to sign in and re-enter your password to confirm the change.</p>
<p><a href="{{restart_url}}" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Start a new email change</a></p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If you weren't expecting support to cancel this change, or you have any questions, please reply to this email or reach out to <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nOur support team has cancelled the pending email change on your Build Test Scale™ account. The address we had queued — {{cancelled_pending_email}} — has been discarded and was never activated.\n\nYour account email remains {{member_email}}, which is the address you should keep using to sign in. No further action is required from you.\n\nIf you still meant to switch your account to {{cancelled_pending_email}} (or another address), open this link to jump straight to the email-change form with the previous address pre-filled (you'll still need to sign in and re-enter your password):\n{{restart_url}}\n\nIf you weren't expecting this, contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "member_email", "cancelled_pending_email", "restart_url", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "email_change_cancelled_by_admin_pending",
    name: "Email Change Cancelled by Admin (Pending Address)",
    subject: "A pending email change to this address was cancelled by Build Test Scale™ support",
    htmlBody: wrapHtml("Pending Email Change Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hello,</p>
<p>Someone recently asked us to switch the email address on a Build Test Scale™ account to <strong>{{cancelled_pending_email}}</strong> — this inbox. Our support team has since cancelled that pending change, so this address was never linked to the account and the verification link we sent earlier no longer works.</p>
<p><strong>No action is required from you.</strong> You don't need to click anything, sign in, or reply.</p>
<p style="margin-top:24px;padding:12px 16px;background:#f3f4f6;border-left:4px solid #6b7280;color:#374151;">If you weren't expecting any messages from us, you can safely ignore this email — this address has not been added to any account. If you have questions or believe you're receiving these messages by mistake, contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hello,\n\nSomeone recently asked us to switch the email address on a Build Test Scale™ account to {{cancelled_pending_email}} — this inbox. Our support team has since cancelled that pending change, so this address was never linked to the account and the verification link we sent earlier no longer works.\n\nNo action is required from you. You don't need to click anything, sign in, or reply.\n\nIf you weren't expecting any messages from us, you can safely ignore this email — this address has not been added to any account. If you have questions, contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["cancelled_pending_email", "support_email", "current_year"],
  },
  {
    slug: "email_change_cancelled_by_member",
    name: "Email Change Cancelled by Member",
    subject: "Your pending email change was cancelled",
    htmlBody: wrapHtml("Pending Email Change Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hi {{member_name}},</p>
<p>You just cancelled the pending email change on your Build Test Scale™ account. The address we had queued — <strong>{{cancelled_pending_email}}</strong> — has been discarded and was never activated.</p>
<p>Your account email remains <strong>{{member_email}}</strong>, which is the address you should keep using to sign in. <strong>No further action is required from you.</strong></p>
<p>Changed your mind, or made a typo the first time? Use the button below — we'll drop you straight onto the email-change form with the previously requested address pre-filled so you don't have to retype it. You'll still need to sign in and re-enter your password to confirm the change.</p>
<p><a href="{{restart_url}}" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Start a new email change</a></p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If you <strong>didn't</strong> cancel this change yourself, sign in and reset your password immediately, then contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYou just cancelled the pending email change on your Build Test Scale™ account. The address we had queued — {{cancelled_pending_email}} — has been discarded and was never activated.\n\nYour account email remains {{member_email}}, which is the address you should keep using to sign in. No further action is required from you.\n\nChanged your mind, or made a typo the first time? Open this link to jump straight to the email-change form with the previous address pre-filled (you'll still need to sign in and re-enter your password):\n{{restart_url}}\n\nIf you didn't cancel this change yourself, sign in and reset your password immediately, then contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "member_email", "cancelled_pending_email", "restart_url", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "email_change_cancelled_by_member_pending",
    name: "Email Change Cancelled (Pending Address)",
    subject: "A pending email change to this address was cancelled",
    htmlBody: wrapHtml("Pending Email Change Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hello,</p>
<p>Someone recently asked us to switch the email address on a Build Test Scale™ account to <strong>{{cancelled_pending_email}}</strong> — this inbox. That request has since been withdrawn, so this address was never linked to the account and the verification link we sent earlier no longer works.</p>
<p><strong>No action is required from you.</strong> You don't need to click anything, sign in, or reply.</p>
<p style="margin-top:24px;padding:12px 16px;background:#f3f4f6;border-left:4px solid #6b7280;color:#374151;">If you weren't expecting any messages from us, you can safely ignore this email — this address has not been added to any account. If you have questions or believe you're receiving these messages by mistake, contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hello,\n\nSomeone recently asked us to switch the email address on a Build Test Scale™ account to {{cancelled_pending_email}} — this inbox. That request has since been withdrawn, so this address was never linked to the account and the verification link we sent earlier no longer works.\n\nNo action is required from you. You don't need to click anything, sign in, or reply.\n\nIf you weren't expecting any messages from us, you can safely ignore this email — this address has not been added to any account. If you have questions, contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["cancelled_pending_email", "support_email", "current_year"],
  },
  {
    slug: "purchase_confirmation",
    name: "Purchase Confirmation",
    subject: "Your purchase of {{product_name}} is confirmed!",
    htmlBody: wrapHtml("Purchase Confirmation", `
<h2 style="color:#1a1a2e;margin-top:0;">Purchase Confirmed!</h2>
<p>Hi {{member_name}},</p>
<p>Great news — your purchase of <strong>{{product_name}}</strong> has been confirmed and your access is now active.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Go to Dashboard</a></p>
<p>If you have any questions about getting started, our support team is here to help.</p>
<p>Let's build something great!<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour purchase of {{product_name}} is confirmed! Access is now active.\n\nLog in at {{portal_url}}/dashboard\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "portal_url", "current_year"],
  },
  {
    slug: "payment_failed",
    name: "Payment Failed",
    subject: "Action required: Payment failed for {{product_name}}",
    htmlBody: wrapHtml("Payment Failed", `
<h2 style="color:#dc2626;margin-top:0;">Payment Failed</h2>
<p>Hi {{member_name}},</p>
<p>We were unable to process your payment for <strong>{{product_name}}</strong>.</p>
<p>Your access will remain active until <strong>{{grace_date}}</strong> while we retry your payment. Please update your payment information to avoid losing access.</p>
<p><a href="{{portal_url}}/settings/billing" style="display:inline-block;background:#dc2626;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Update Payment Info</a></p>
<p>If you need help, contact us at {{support_email}}.</p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nPayment failed for {{product_name}}. Your access continues until {{grace_date}}.\n\nPlease update your payment info at {{portal_url}}/settings/billing\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "grace_date", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "payment_failed_final",
    name: "Payment Failed — Access Ended",
    subject: "Your access to {{product_name}} has ended",
    htmlBody: wrapHtml("Access Ended", `
<h2 style="color:#dc2626;margin-top:0;">Access Has Ended</h2>
<p>Hi {{member_name}},</p>
<p>We were unable to process your payment for <strong>{{product_name}}</strong> after multiple attempts, and your access has now ended.</p>
<p>To restore your access, please update your payment information and resubscribe.</p>
<p><a href="{{portal_url}}/settings/billing" style="display:inline-block;background:#dc2626;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Restore Access</a></p>
<p>If you need help or believe this was an error, contact us at {{support_email}}.</p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nWe were unable to process your payment for {{product_name}} after multiple attempts. Your access has ended.\n\nTo restore access, update your payment info at {{portal_url}}/settings/billing\n\nContact {{support_email}} with questions.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "payment_recovered",
    name: "Payment Recovered",
    subject: "Payment successful — {{product_name}} access restored",
    htmlBody: wrapHtml("Payment Recovered", `
<h2 style="color:#16a34a;margin-top:0;">Payment Successful!</h2>
<p>Hi {{member_name}},</p>
<p>Great news — your payment for <strong>{{product_name}}</strong> has been successfully processed and your access continues uninterrupted.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Go to Dashboard</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour payment for {{product_name}} was successful. Access continues.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "portal_url", "current_year"],
  },
  {
    slug: "refund_processed",
    name: "Refund Processed",
    subject: "Your refund for {{product_name}} has been processed",
    htmlBody: wrapHtml("Refund Processed", `
<h2 style="color:#1a1a2e;margin-top:0;">Refund Processed</h2>
<p>Hi {{member_name}},</p>
<p>Your refund for <strong>{{product_name}}</strong> has been processed. Your access to this product has been removed.</p>
<p>If you have questions or believe this was a mistake, contact us at {{support_email}}.</p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour refund for {{product_name}} has been processed. Access removed.\n\nContact {{support_email}} with questions.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "support_email", "current_year"],
  },
  {
    slug: "subscription_cancelled",
    name: "Subscription Cancelled",
    subject: "Your {{product_name}} subscription has been cancelled",
    htmlBody: wrapHtml("Subscription Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Subscription Cancelled</h2>
<p>Hi {{member_name}},</p>
<p>Your subscription for <strong>{{product_name}}</strong> has been cancelled. You'll continue to have access until the end of your current billing period.</p>
<p>Changed your mind? You can resubscribe at any time.</p>
<p><a href="{{portal_url}}/settings" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Manage Account</a></p>
<p>We're sorry to see you go.<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour {{product_name}} subscription has been cancelled. Access continues until end of billing period.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "portal_url", "current_year"],
  },
  {
    slug: "mentorship_expiring_warning",
    name: "Mentorship Expiring Warning (30 days)",
    subject: "Your {{product_name}} expires in less than 30 days",
    htmlBody: wrapHtml("Expiring Soon", `
<h2 style="color:#f59e0b;margin-top:0;">Your Access is Expiring Soon</h2>
<p>Hi {{member_name}},</p>
<p>Your <strong>{{product_name}}</strong> access expires on <strong>{{expiration_date}}</strong>.</p>
<p>Don't lose access to your training, coaching calls, and community. Renew now to continue your journey.</p>
<p><a href="{{portal_url}}/settings" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Renew Now</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour {{product_name}} expires on {{expiration_date}}. Renew at {{portal_url}}/settings\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "expiration_date", "portal_url", "current_year"],
  },
  {
    slug: "mentorship_expiring_urgent",
    name: "Mentorship Expiring Urgent (7 days)",
    subject: "URGENT: Your {{product_name}} expires in less than 7 days!",
    htmlBody: wrapHtml("Expiring Urgently", `
<h2 style="color:#dc2626;margin-top:0;">Your Access Expires This Week!</h2>
<p>Hi {{member_name}},</p>
<p>Your <strong>{{product_name}}</strong> access expires on <strong>{{expiration_date}}</strong> — that's less than 7 days away!</p>
<p>Act now to avoid losing access to all your training materials, coaching calls, and community.</p>
<p><a href="{{portal_url}}/settings" style="display:inline-block;background:#dc2626;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Renew Now — Don't Lose Access</a></p>
<p>The BTS Team</p>`),
    textBody: "URGENT: Hi {{member_name}}, your {{product_name}} expires on {{expiration_date}}! Renew now at {{portal_url}}/settings to keep your access.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "expiration_date", "portal_url", "current_year"],
  },
  {
    slug: "mentorship_expired",
    name: "Mentorship Expired",
    subject: "Your {{product_name}} access has expired",
    htmlBody: wrapHtml("Access Expired", `
<h2 style="color:#dc2626;margin-top:0;">Your Access Has Expired</h2>
<p>Hi {{member_name}},</p>
<p>Your <strong>{{product_name}}</strong> access expired on {{expiration_date}}.</p>
<p>To regain access to your training, coaching, and community, please renew your membership.</p>
<p><a href="{{portal_url}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Renew Membership</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour {{product_name}} access has expired. Renew at {{portal_url}}\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "expiration_date", "portal_url", "current_year"],
  },
  {
    slug: "ticket_created",
    name: "Support Ticket Created",
    subject: "Ticket #{{ticket_number}} received — we'll get back to you soon",
    htmlBody: wrapHtml("Ticket Created", `
<h2 style="color:#1a1a2e;margin-top:0;">We Received Your Ticket</h2>
<p>Hi {{member_name}},</p>
<p>Your support ticket <strong>#{{ticket_number}}</strong> has been received. Our team will review it and respond as soon as possible.</p>
<p><strong>Subject:</strong> {{ticket_subject}}</p>
<p><a href="{{portal_url}}/support" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Tickets</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nTicket #{{ticket_number}} received. Subject: {{ticket_subject}}\n\nWe'll respond soon.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "ticket_number", "ticket_subject", "portal_url", "current_year"],
  },
  {
    slug: "ticket_reply",
    name: "Support Ticket Reply",
    subject: "New reply on ticket #{{ticket_number}}",
    htmlBody: wrapHtml("Ticket Reply", `
<h2 style="color:#1a1a2e;margin-top:0;">New Reply on Your Ticket</h2>
<p>Hi {{member_name}},</p>
<p>Our support team just replied to your ticket <strong>#{{ticket_number}}</strong>. Open it in your portal to read the response and continue the conversation.</p>
<p><a href="{{portal_url}}/support/tickets/{{ticket_id}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Reply</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nOur support team just replied to your ticket #{{ticket_number}}. Read it at {{portal_url}}/support/tickets/{{ticket_id}}\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "ticket_number", "ticket_id", "portal_url", "current_year"],
  },
  {
    slug: "account_locked",
    name: "Account Locked",
    subject: "Your account has been temporarily locked",
    htmlBody: wrapHtml("Account Locked", `
<h2 style="color:#dc2626;margin-top:0;">Account Temporarily Locked</h2>
<p>Hi {{member_name}},</p>
<p>Your account has been temporarily locked due to too many failed login attempts. It will automatically unlock in 15 minutes.</p>
<p>If you've forgotten your password, you can reset it below.</p>
<p><a href="{{portal_url}}/forgot-password" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour account has been temporarily locked due to failed login attempts. It will unlock in 15 minutes. Reset password: {{portal_url}}/forgot-password\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "portal_url", "current_year"],
  },
  {
    slug: "password_changed",
    name: "Password Changed",
    subject: "Your password has been changed",
    htmlBody: wrapHtml("Password Changed", `
<h2 style="color:#1a1a2e;margin-top:0;">Password Changed Successfully</h2>
<p>Hi {{member_name}},</p>
<p>Your password has been successfully changed. All existing sessions have been logged out for security.</p>
<p>If you didn't make this change, please contact us immediately at {{support_email}}.</p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour password has been changed. If you didn't do this, contact {{support_email}} immediately.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "support_email", "current_year"],
  },
  {
    slug: "flexy_password_reset",
    name: "Flexy Password Reset",
    subject: "Your new Flexy password",
    htmlBody: wrapHtml("Flexy Password Reset", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Flexy password has been reset</h2>
<p>Hi {{member_name}},</p>
<p>Our support team just generated a new password for your Flexy login. Use the credentials below the next time you sign in.</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;font-family:monospace;">
<strong>Login email:</strong> {{flexy_email}}<br>
<strong>New password:</strong> {{flexy_password}}
</p>
<p>For your security, change this password to something only you know after you log in. If you did not request this reset, contact us right away at {{support_email}}.</p>
<p><a href="{{flexy_login_url}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Open Flexy Login</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nOur support team just generated a new password for your Flexy login.\n\nLogin email: {{flexy_email}}\nNew password: {{flexy_password}}\n\nFor your security, change this password after you log in. If you did not request this reset, contact {{support_email}} right away.\n\nLog in at {{flexy_login_url}}\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "flexy_email", "flexy_password", "flexy_login_url", "support_email", "current_year"],
  },
  {
    slug: "tier_upgrade",
    name: "Tier Upgrade Confirmation",
    subject: "Welcome to {{product_name}} — you've been upgraded!",
    htmlBody: wrapHtml("Tier Upgrade", `
<h2 style="color:#16a34a;margin-top:0;">You've Been Upgraded!</h2>
<p>Hi {{member_name}},</p>
<p>Congratulations! Your access has been upgraded to <strong>{{product_name}}</strong>.</p>
<p>You now have access to additional training, coaching, and tools. Log in to explore everything that's new.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Explore Your New Access</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYou've been upgraded to {{product_name}}! Log in at {{portal_url}}/dashboard to explore.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "portal_url", "current_year"],
  },
  {
    slug: "role_changed",
    name: "Admin Role Changed",
    subject: "Your Build Test Scale™ role is now {{new_role_label}}",
    htmlBody: wrapHtml("Role Changed", `
<h2 style="color:#1a1a2e;margin-top:0;">Your role was updated</h2>
<p>Hi {{member_name}},</p>
<p>{{actor_name}} just updated your access on Build Test Scale™.</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;">
<strong>Previous role:</strong> {{previous_role_label}}<br>
<strong>New role:</strong> {{new_role_label}}
</p>
<p>This change takes effect the next time you sign in. You may notice that some admin tools you used before are no longer visible, or that new ones have appeared.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Open Your Dashboard</a></p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If you weren't expecting this change, please reach out to <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\n{{actor_name}} just updated your access on Build Test Scale™.\n\nPrevious role: {{previous_role_label}}\nNew role: {{new_role_label}}\n\nThis change takes effect the next time you sign in. Open your dashboard at {{portal_url}}/dashboard.\n\nIf you weren't expecting this change, contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "actor_name", "previous_role_label", "new_role_label", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "concierge_task_created",
    name: "Concierge Task Submitted",
    subject: "Your Concierge task {{ticket_number}} has been received",
    htmlBody: wrapHtml("Concierge Task Received", `
<h2 style="color:#1a1a2e;margin-top:0;">Concierge Task Received</h2>
<p>Hi {{member_name}},</p>
<p>Your BTS Concierge™ task has been received and logged under reference <strong>{{ticket_number}}</strong>.</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;">
<strong>Task:</strong> {{task_subject}}<br>
<strong>Reference:</strong> {{ticket_number}}
</p>
<p>Our Concierge team typically turns tasks around within <strong>24–72 hours</strong>. We'll reach out if we need any additional information.</p>
<p><a href="{{portal_url}}/support" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Your Submission</a></p>
<p>Thank you for using the BTS Concierge™!<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour BTS Concierge™ task has been received.\n\nTask: {{task_subject}}\nReference: {{ticket_number}}\n\nOur team will turn this around within 24-72 hours.\n\nView it at {{portal_url}}/support\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "ticket_number", "task_subject", "portal_url", "current_year"],
  },
  {
    slug: "compliance_review_created",
    name: "Compliance Review Submitted",
    subject: "Your compliance review {{ticket_number}} has been received",
    htmlBody: wrapHtml("Compliance Review Received", `
<h2 style="color:#1a1a2e;margin-top:0;">Compliance Review Received</h2>
<p>Hi {{member_name}},</p>
<p>Your compliance review submission has been received and logged under reference <strong>{{ticket_number}}</strong>.</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;">
<strong>Offer:</strong> {{task_subject}}<br>
<strong>Reference:</strong> {{ticket_number}}
</p>
<p>Our compliance team will review your creative within <strong>24 hours</strong>. Please do <strong>not</strong> run the creative on any traffic source until you have received our approval.</p>
<p><a href="{{portal_url}}/support" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Your Submission</a></p>
<p>Thank you,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour compliance review has been received.\n\nOffer: {{task_subject}}\nReference: {{ticket_number}}\n\nOur team will review within 24 hours. Do NOT run the creative until you receive approval.\n\nView it at {{portal_url}}/support\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "ticket_number", "task_subject", "portal_url", "current_year"],
  },
  // Task #1714 step 6: the three missing booking-lifecycle emails, ×2 call
  // types. Each is fired from call-bookings.ts only after the corresponding
  // GHL operation succeeds, populates the person-block via `variables`, and
  // is deduped via the checkAndRecordSend pattern so a retried route call
  // does not double-send. Email-only (no SMS variant per task scope).
  {
    slug: "kickoff_call_confirmation",
    name: "Kickoff Call Confirmation",
    subject: "Your kickoff call is confirmed",
    htmlBody: wrapHtml("Kickoff Call Confirmed", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Kickoff Call is Confirmed</h2>
<p>Hi {{member_name}},</p>
<p>You're all set! Here are the details for your upcoming kickoff call. This call is where we map out your plan — your goals, where you're starting from, and the concrete next steps to get there.</p>
<p><a href="{{meeting_url}}" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Join Your Call</a></p>
<p>Need to make a change? You can reschedule or cancel from your dashboard at any time.</p>
<p style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;">This confirmation is going out now. You'll get another email reminder 24 hours before the call, and a text message 1 hour before it starts — the join link is in each one, and always on your dashboard.</p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour kickoff call is confirmed. Join here: {{meeting_url}}\n\nThis call is where we map out your plan — your goals, where you're starting from, and the concrete next steps to get there.\n\nNeed to make a change? You can reschedule or cancel from your dashboard at any time.\n\nThis confirmation is going out now. You'll get another email reminder 24 hours before the call, and a text message 1 hour before it starts — the join link is in each one, and always on your dashboard.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "meeting_url", "portal_url", "current_year"],
  },
  {
    slug: "kickoff_call_reschedule",
    name: "Kickoff Call Rescheduled",
    subject: "Your kickoff call has been rescheduled",
    htmlBody: wrapHtml("Kickoff Call Rescheduled", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Kickoff Call Has Been Rescheduled</h2>
<p>Hi {{member_name}},</p>
<p>Your kickoff call has moved to a new time.</p>
<p style="background:#f0f4ff;padding:15px;border-radius:6px;">
<strong>Previous time:</strong> {{previous_datetime_label}}<br>
<strong>New time:</strong> {{new_datetime_label}}
</p>
<p><a href="{{meeting_url}}" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Join Your Call</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour kickoff call has been rescheduled.\n\nPrevious time: {{previous_datetime_label}}\nNew time: {{new_datetime_label}}\n\nJoin here: {{meeting_url}}\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "previous_datetime_label", "new_datetime_label", "meeting_url", "portal_url", "current_year"],
  },
  {
    slug: "kickoff_call_cancel",
    name: "Kickoff Call Cancelled",
    subject: "Your kickoff call has been cancelled",
    htmlBody: wrapHtml("Kickoff Call Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Kickoff Call Has Been Cancelled</h2>
<p>Hi {{member_name}},</p>
<p>Your kickoff call has been cancelled as requested. No further action is needed.</p>
<p>Whenever you're ready, you can book a new time from your dashboard.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Book a New Call</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour kickoff call has been cancelled as requested.\n\nWhenever you're ready, book a new time from your dashboard: {{portal_url}}/dashboard\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "portal_url", "current_year"],
  },
  {
    slug: "partner_call_confirmation",
    name: "Partner Call Confirmation",
    subject: "Your partner call is confirmed",
    htmlBody: wrapHtml("Partner Call Confirmed", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Partner Call is Confirmed</h2>
<p>Hi {{member_name}},</p>
<p>You're all set! Here are the details for your upcoming partner call. This first call is just to meet your accountability partner and set your pace together — they'll check in on your progress and keep you moving toward your goals for the rest of the program.</p>
<p><a href="{{meeting_url}}" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Join Your Call</a></p>
<p>Need to make a change? You can reschedule or cancel from your dashboard at any time.</p>
<p style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;">This confirmation is going out now. You'll get another email reminder 24 hours before the call, and a text message 1 hour before it starts — the join link is in each one, and always on your dashboard.</p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour partner call is confirmed. Join here: {{meeting_url}}\n\nThis first call is just to meet your accountability partner and set your pace together — they'll check in on your progress and keep you moving toward your goals for the rest of the program.\n\nNeed to make a change? You can reschedule or cancel from your dashboard at any time.\n\nThis confirmation is going out now. You'll get another email reminder 24 hours before the call, and a text message 1 hour before it starts — the join link is in each one, and always on your dashboard.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "meeting_url", "portal_url", "current_year"],
  },
  {
    slug: "partner_call_reschedule",
    name: "Partner Call Rescheduled",
    subject: "Your partner call has been rescheduled",
    htmlBody: wrapHtml("Partner Call Rescheduled", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Partner Call Has Been Rescheduled</h2>
<p>Hi {{member_name}},</p>
<p>Your partner call has moved to a new time.</p>
<p style="background:#f0f4ff;padding:15px;border-radius:6px;">
<strong>Previous time:</strong> {{previous_datetime_label}}<br>
<strong>New time:</strong> {{new_datetime_label}}
</p>
<p><a href="{{meeting_url}}" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Join Your Call</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour partner call has been rescheduled.\n\nPrevious time: {{previous_datetime_label}}\nNew time: {{new_datetime_label}}\n\nJoin here: {{meeting_url}}\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "previous_datetime_label", "new_datetime_label", "meeting_url", "portal_url", "current_year"],
  },
  {
    slug: "partner_call_cancel",
    name: "Partner Call Cancelled",
    subject: "Your partner call has been cancelled",
    htmlBody: wrapHtml("Partner Call Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Partner Call Has Been Cancelled</h2>
<p>Hi {{member_name}},</p>
<p>Your partner call has been cancelled as requested. No further action is needed.</p>
<p>Whenever you're ready, you can book a new time from your dashboard.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Book a New Call</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour partner call has been cancelled as requested.\n\nWhenever you're ready, book a new time from your dashboard: {{portal_url}}/dashboard\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "portal_url", "current_year"],
  },
];

const marketingEmailTemplates = [
  {
    slug: "onboarding_day1",
    name: "Onboarding Day 1 — Getting Started",
    subject: "Your first step inside Build Test Scale™",
    htmlBody: wrapHtml("Getting Started", `
<h2 style="color:#1a1a2e;margin-top:0;">Let's Get You Started</h2>
<p>Hi {{member_name}},</p>
<p>Welcome to Day 1! Here's the fastest way to get value from your BTS membership:</p>
<ol>
<li>Complete your profile and onboarding</li>
<li>Watch the first lesson in your training track</li>
<li>Check out the upcoming coaching calls</li>
</ol>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Start Now</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nWelcome to Day 1! Get started:\n1. Complete your profile\n2. Watch your first lesson\n3. Check coaching calls\n\nStart at {{portal_url}}/dashboard\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "portal_url", "current_year"],
  },
  {
    slug: "onboarding_day3",
    name: "Onboarding Day 3 — First Lesson Nudge",
    subject: "Have you started your first lesson yet?",
    htmlBody: wrapHtml("First Lesson", `
<h2 style="color:#1a1a2e;margin-top:0;">Time to Dive In</h2>
<p>Hi {{member_name}},</p>
<p>It's been a few days since you joined. The members who see results fastest are the ones who start their training right away.</p>
<p>Your first lesson is waiting — it only takes 15 minutes.</p>
<p><a href="{{portal_url}}/training" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Start Your First Lesson</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nHave you started your first lesson? It only takes 15 minutes. Start at {{portal_url}}/training\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "portal_url", "current_year"],
  },
  {
    slug: "onboarding_day7",
    name: "Onboarding Day 7 — Week 1 Recap",
    subject: "Your first week at BTS — here's what's next",
    htmlBody: wrapHtml("Week 1 Recap", `
<h2 style="color:#1a1a2e;margin-top:0;">Your First Week Recap</h2>
<p>Hi {{member_name}},</p>
<p>You've been a BTS member for a week now. Here's what you should focus on next:</p>
<ul>
<li>Continue working through your training track</li>
<li>Join a live coaching call this week</li>
<li>Ask questions in the community</li>
</ul>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Check Your Progress</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour first week recap. Next steps: continue training, join a coaching call, engage with community.\n\n{{portal_url}}/dashboard\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "portal_url", "current_year"],
  },
  {
    slug: "coaching_reminder",
    name: "Coaching Call Reminder",
    subject: "Live coaching call tomorrow: {{call_title}}",
    htmlBody: wrapHtml("Coaching Reminder", `
<h2 style="color:#1a1a2e;margin-top:0;">Coaching Call Tomorrow</h2>
<p>Hi {{member_name}},</p>
<p>Don't forget — there's a live coaching call happening tomorrow:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{call_title}}</strong><br>{{call_date}} at {{call_time}}</p>
<p><a href="{{portal_url}}/coaching" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Details</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nCoaching call tomorrow: {{call_title}} at {{call_time}}.\n\nDetails: {{portal_url}}/coaching\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "call_title", "call_date", "call_time", "portal_url", "current_year"],
  },
  {
    // RSVP-driven morning-of group-coaching-call reminder (Task #1770).
    // Audience is members who RSVP'd before the call day; sent at ~7:00 AM in
    // the member's own timezone. {{coaching_unsubscribe_url}} is a one-click,
    // coaching-only opt-out (flips users.coaching_email_opt_in — NOT the
    // global marketing unsubscribe, which still applies via the standard
    // marketing-category footer/suppression).
    slug: "coaching_rsvp_reminder",
    name: "Coaching Call Morning-Of Reminder (RSVP'd)",
    subject: "Today: {{call_title}} at {{call_time}}",
    htmlBody: wrapHtml("Coaching Call Today", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Coaching Call Is Today</h2>
<p>Hi {{member_name}},</p>
<p>You RSVP'd for today's live coaching call — here are the details:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{call_title}}</strong><br>{{call_date}} at {{call_time}}</p>
<p><a href="{{portal_url}}/coaching" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Join From the Coaching Page</a></p>
<p>See you there!</p>
<p>The BTS Team</p>
<p style="font-size:12px;color:#999;margin-top:30px;">Don't want coaching call reminder emails? <a href="{{coaching_unsubscribe_url}}" style="color:#999;">Unsubscribe from coaching reminders</a> — you'll keep all other member emails.</p>`),
    textBody: "Hi {{member_name}},\n\nYou RSVP'd for today's coaching call: {{call_title}} at {{call_time}}.\n\nJoin from {{portal_url}}/coaching\n\nThe BTS Team\n\nUnsubscribe from coaching reminders: {{coaching_unsubscribe_url}}",
    category: "marketing",
    variables: ["member_name", "call_title", "call_date", "call_time", "coaching_unsubscribe_url", "portal_url", "current_year"],
  },
  {
    slug: "session_feedback",
    name: "Session Feedback Prompt",
    subject: "How was {{call_title}}? We'd love your feedback",
    htmlBody: wrapHtml("Session Feedback", `
<h2 style="color:#1a1a2e;margin-top:0;">How Was Your Session?</h2>
<p>Hi {{member_name}},</p>
<p>Thanks for being part of <strong>{{call_title}}</strong>. We'd love to hear how it went — your feedback helps us make every coaching session better.</p>
<p>It only takes a minute, and the recording is also available if you'd like to revisit anything.</p>
<p><a href="{{portal_url}}/coaching" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Share Your Feedback</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nThanks for being part of {{call_title}}. We'd love your feedback — it helps us make every coaching session better. The recording is also available if you'd like to revisit anything.\n\nShare your feedback: {{portal_url}}/coaching\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "call_title", "portal_url", "current_year"],
  },
  {
    slug: "recording_ready",
    name: "Coaching Recording Ready",
    subject: "The recording for {{call_title}} is ready",
    htmlBody: wrapHtml("Recording Ready", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Recording Is Ready</h2>
<p>Hi {{member_name}},</p>
<p>The recording for <strong>{{call_title}}</strong> is now available. Couldn't make it live, or want to revisit something? You can watch it any time.</p>
<p><a href="{{portal_url}}/coaching" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Watch the Recording</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nThe recording for {{call_title}} is now available. Watch it any time: {{portal_url}}/coaching\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "call_title", "portal_url", "current_year"],
  },
  {
    slug: "session_recording_ready",
    name: "Private Coaching Session Recording Ready",
    subject: "Your Private Coaching recording is ready",
    htmlBody: wrapHtml("Recording Ready", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Recording Is Ready</h2>
<p>Hi {{member_name}},</p>
<p>The recording from your recent Private Coaching session is now available. Want to revisit something? You can watch it any time.</p>
<p><a href="{{portal_url}}{{recording_path}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Watch the Recording</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nThe recording from your recent Private Coaching session is now available. Watch it any time: {{portal_url}}{{recording_path}}\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "recording_path", "portal_url", "current_year"],
  },
  {
    slug: "new_content_alert",
    name: "New Content Available",
    subject: "New content just dropped: {{content_title}}",
    htmlBody: wrapHtml("New Content", `
<h2 style="color:#1a1a2e;margin-top:0;">New Content Available!</h2>
<p>Hi {{member_name}},</p>
<p>We just published new content that's available to you:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{content_title}}</strong><br>{{content_description}}</p>
<p><a href="{{portal_url}}/training" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Check It Out</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nNew content: {{content_title}} — {{content_description}}\n\nView at {{portal_url}}/training\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "content_title", "content_description", "portal_url", "current_year"],
  },
  {
    slug: "streak_milestone",
    name: "Streak Milestone",
    subject: "You're on a {{streak_count}}-day streak! Keep it up!",
    htmlBody: wrapHtml("Streak Milestone", `
<h2 style="color:#16a34a;margin-top:0;">{{streak_count}}-Day Streak!</h2>
<p>Hi {{member_name}},</p>
<p>You've been consistently learning for <strong>{{streak_count}} days</strong> straight. That's the kind of consistency that builds real results.</p>
<p>Keep it going — momentum is everything in this business.</p>
<p><a href="{{portal_url}}/training" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Continue Learning</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYou're on a {{streak_count}}-day streak! Keep it going at {{portal_url}}/training\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "streak_count", "portal_url", "current_year"],
  },
  {
    slug: "win_of_the_week",
    name: "Win of the Week",
    subject: "This week's biggest wins from the BTS community",
    htmlBody: wrapHtml("Win of the Week", `
<h2 style="color:#1a1a2e;margin-top:0;">This Week's Wins</h2>
<p>Hi {{member_name}},</p>
<p>Check out what members accomplished this week:</p>
<p>{{wins_content}}</p>
<p>Your win could be featured next! Keep pushing forward.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Back to Your Dashboard</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nThis week's wins:\n{{wins_content}}\n\nYour win could be next!\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "wins_content", "portal_url", "current_year"],
  },
  {
    slug: "monthly_progress",
    name: "Monthly Progress Report",
    subject: "Your monthly progress report is ready",
    htmlBody: wrapHtml("Monthly Progress", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Monthly Progress</h2>
<p>Hi {{member_name}},</p>
<p>Here's your progress for {{month_name}}:</p>
<ul>
<li>Lessons completed: {{lessons_completed}}</li>
<li>Coaching calls attended: {{calls_attended}}</li>
<li>Current streak: {{streak_count}} days</li>
</ul>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Full Dashboard</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour {{month_name}} progress: {{lessons_completed}} lessons, {{calls_attended}} calls, {{streak_count}}-day streak.\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "month_name", "lessons_completed", "calls_attended", "streak_count", "portal_url", "current_year"],
  },
  {
    slug: "upgrade_offer",
    name: "Upgrade Offer",
    subject: "Ready for the next level? Upgrade to {{upgrade_product}}",
    htmlBody: wrapHtml("Upgrade Offer", `
<h2 style="color:#1a1a2e;margin-top:0;">Ready to Level Up?</h2>
<p>Hi {{member_name}},</p>
<p>You've been crushing it with your current access. Want to unlock even more?</p>
<p><strong>{{upgrade_product}}</strong> gives you:</p>
<ul>
<li>Advanced training modules</li>
<li>Live coaching calls</li>
<li>Community access</li>
<li>And much more</li>
</ul>
<p><a href="{{portal_url}}/upgrade" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">See Upgrade Options</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nReady for the next level? Upgrade to {{upgrade_product}} for advanced training, coaching, and more.\n\n{{portal_url}}/upgrade\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "upgrade_product", "portal_url", "current_year"],
  },
  {
    slug: "re_engagement",
    name: "Re-engagement — We Miss You",
    subject: "We miss you, {{member_name}}!",
    htmlBody: wrapHtml("We Miss You", `
<h2 style="color:#1a1a2e;margin-top:0;">We Miss You!</h2>
<p>Hi {{member_name}},</p>
<p>It's been a while since you logged in. Your training is waiting, and new content has been added since your last visit.</p>
<p>Jump back in — even 15 minutes a day can make a difference.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Get Back to Learning</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nWe miss you! New content has been added. Jump back in at {{portal_url}}/dashboard\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "portal_url", "current_year"],
  },
  {
    slug: "community_announcement",
    name: "Community Announcement",
    subject: "{{announcement_title}}",
    htmlBody: wrapHtml("Announcement", `
<h2 style="color:#1a1a2e;margin-top:0;">{{announcement_title}}</h2>
<p>Hi {{member_name}},</p>
<p>{{announcement_body}}</p>
<p><a href="{{portal_url}}/announcements" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Read More</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\n{{announcement_title}}\n\n{{announcement_body}}\n\nRead more at {{portal_url}}/announcements\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "announcement_title", "announcement_body", "portal_url", "current_year"],
  },
  {
    slug: "kickoff_call_reminder",
    name: "Kickoff Call Reminder",
    subject: "Your kickoff call is tomorrow",
    htmlBody: wrapHtml("Kickoff Call Reminder", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Kickoff Call Is Tomorrow</h2>
<p>Hi {{member_name}},</p>
<p>Don't forget — your kickoff call with {{staff_name}} is coming up:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{call_date}} at {{call_time}}</strong></p>
<p><a href="{{portal_url}}/onboarding" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Details</a></p>
<p style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;">You'll also get a text message 1 hour before the call starts.</p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour kickoff call with {{staff_name}} is tomorrow: {{call_date}} at {{call_time}}.\n\nDetails: {{portal_url}}/onboarding\n\nYou'll also get a text message 1 hour before the call starts.\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "staff_name", "call_date", "call_time", "portal_url", "current_year"],
  },
  {
    slug: "partner_call_reminder",
    name: "Accountability Partner Call Reminder",
    subject: "Your accountability partner call is tomorrow",
    htmlBody: wrapHtml("Partner Call Reminder", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Partner Call Is Tomorrow</h2>
<p>Hi {{member_name}},</p>
<p>Don't forget — your accountability call with {{staff_name}} is coming up:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{call_date}} at {{call_time}}</strong></p>
<p><a href="{{portal_url}}/accountability-partner" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Details</a></p>
<p style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;">You'll also get a text message 1 hour before the call starts.</p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour accountability call with {{staff_name}} is tomorrow: {{call_date}} at {{call_time}}.\n\nDetails: {{portal_url}}/accountability-partner\n\nYou'll also get a text message 1 hour before the call starts.\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "staff_name", "call_date", "call_time", "portal_url", "current_year"],
  },
  {
    slug: "event_invitation",
    name: "Event Invitation",
    subject: "You're invited: {{event_title}}",
    htmlBody: wrapHtml("Event Invitation", `
<h2 style="color:#1a1a2e;margin-top:0;">You're Invited!</h2>
<p>Hi {{member_name}},</p>
<p>We'd love for you to join us:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{event_title}}</strong><br>{{event_date}} at {{event_time}}<br>{{event_description}}</p>
<p><a href="{{portal_url}}/events" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">RSVP Now</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYou're invited: {{event_title}} on {{event_date}} at {{event_time}}.\n\n{{event_description}}\n\nRSVP at {{portal_url}}/events\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "event_title", "event_date", "event_time", "event_description", "portal_url", "current_year"],
  },
];

const smsTemplates = [
  {
    slug: "welcome",
    // Trademark-marked with the ASCII "(TM)" rather than the U+2122 glyph —
    // see the `ensureSmsTrademarkMarking` doc comment below for why SMS uses
    // the ASCII form (GSM-7 vs. UCS-2 segment-length impact).
    name: "Welcome SMS",
    body: "Welcome to Build Test Scale (TM), {{member_name}}! Log in to get started: {{portal_url}}",
    variables: ["member_name", "portal_url"],
  },
  {
    slug: "purchase_confirmation",
    name: "Purchase Confirmation SMS",
    body: "Your purchase of {{product_name}} is confirmed! Access is now active. Log in: {{portal_url}}",
    variables: ["product_name", "portal_url"],
  },
  {
    slug: "payment_failed",
    name: "Payment Failed SMS",
    body: "BTS: Payment failed for {{product_name}}. Please update your payment info to avoid losing access: {{portal_url}}/settings/billing",
    variables: ["product_name", "portal_url"],
  },
  {
    slug: "coaching_reminder",
    name: "Coaching Call Reminder SMS",
    body: "BTS: Live coaching call tomorrow — {{call_title}}. Don't miss it! Details: {{portal_url}}/coaching",
    variables: ["call_title", "portal_url"],
  },
  {
    // Task #1770: morning-of text for members who RSVP'd before the call day,
    // gated on master smsOptIn + coachingSmsOptIn in scheduled-comms.
    slug: "coaching_rsvp_reminder",
    name: "Coaching Call Morning-Of Reminder SMS (RSVP'd)",
    body: "BTS: Your coaching call is today — {{call_title}} at {{call_time}}. Join: {{portal_url}}/coaching",
    variables: ["call_title", "call_time", "portal_url"],
  },
  {
    slug: "recording_ready",
    name: "Coaching Recording Ready SMS",
    body: "BTS: The recording for {{call_title}} is ready. Watch it any time: {{portal_url}}/coaching",
    variables: ["call_title", "portal_url"],
  },
  {
    slug: "session_recording_ready",
    name: "Private Coaching Session Recording Ready SMS",
    body: "BTS: Your Private Coaching session recording is ready. Watch it any time: {{portal_url}}{{recording_path}}",
    variables: ["recording_path", "portal_url"],
  },
  {
    slug: "mentorship_expiring",
    name: "Mentorship Expiring SMS",
    body: "BTS: Your {{product_name}} expires on {{expiration_date}}. Renew now to keep access: {{portal_url}}/settings",
    variables: ["product_name", "expiration_date", "portal_url"],
  },
  {
    slug: "new_content_alert",
    name: "New Content Alert SMS",
    body: "BTS: New content just dropped — {{content_title}}. Check it out: {{portal_url}}/training",
    variables: ["content_title", "portal_url"],
  },
  {
    slug: "verification_code",
    name: "Verification Code SMS",
    body: "Your BTS verification code is {{code}}. It expires in 10 minutes.",
    variables: ["code"],
  },
  {
    slug: "password_reset",
    name: "Password Reset SMS",
    body: "BTS: Your password reset link: {{portal_url}}/reset-password?token={{reset_token}} — expires in 1 hour.",
    variables: ["reset_token", "portal_url"],
  },
  {
    slug: "flexy_password_reset",
    name: "Flexy Password Reset SMS",
    body: "BTS: Your Flexy password was just reset. Login: {{flexy_email}} / Password: {{flexy_password}}. Change it after you log in.",
    variables: ["flexy_email", "flexy_password"],
  },
  {
    slug: "ticket_reply",
    name: "Support Ticket Reply SMS",
    body: "BTS: Support just replied to your ticket #{{ticket_number}}. Read it: {{portal_url}}/support/tickets/{{ticket_id}}",
    variables: ["ticket_number", "ticket_id", "portal_url"],
  },
  {
    slug: "kickoff_call_reminder",
    name: "Kickoff Call Reminder SMS",
    body: "BTS: Your kickoff call with {{staff_name}} starts soon. Details: {{portal_url}}/onboarding",
    variables: ["staff_name", "portal_url"],
  },
  {
    slug: "partner_call_reminder",
    name: "Accountability Partner Call Reminder SMS",
    body: "BTS: Your accountability call with {{staff_name}} starts soon. Details: {{portal_url}}/accountability-partner",
    variables: ["staff_name", "portal_url"],
  },
];

export type StarterEmailTemplate = (typeof transactionalEmailTemplates)[number];

export type StarterContent = Pick<StarterEmailTemplate, "name" | "subject" | "htmlBody" | "textBody">;

/**
 * SHA-256 fingerprint of a starter template's user-visible content. Stored on
 * `email_templates.starter_hash` so we can tell whether a row is still tracking
 * the starter copy or has been customized via the admin UI.
 *
 * Field set deliberately excludes `category`, `variables`, `fromName`, and
 * `active` — admins flipping `active`/`fromName` should not block starter copy
 * refreshes, and category/variables are unlikely to drift in practice.
 */
export function templateContentHash(t: StarterContent): string {
  const payload = JSON.stringify({
    name: t.name,
    subject: t.subject,
    htmlBody: t.htmlBody,
    textBody: t.textBody,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Frozen copy of `wrapHtml()` exactly as it existed immediately before Task
 * #1714's branded-layout redesign (dark-navy header, `#f5f5f5` page
 * background, `#4f46e5`/`#1a56db` buttons). Used ONLY to reconstruct legacy
 * row content below for `priorStarterRevisions` — deliberately NOT kept in
 * sync with the live `wrapHtml()` above, since its entire purpose is to
 * represent a specific historical wrapper version.
 */
/**
 * Frozen copy of `wrapHtml()` exactly as it existed immediately before Task
 * #1714's branded-layout redesign (dark-navy header, `#f5f5f5` page
 * background, `#4f46e5`/`#1a56db` buttons). Used ONLY to reconstruct legacy
 * row content below for `priorStarterRevisions` — deliberately NOT kept in
 * sync with the live `wrapHtml()` above, since its entire purpose is to
 * represent a specific historical wrapper version.
 */
function oldWrapHtmlV1(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">
${body}
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Earlier versions of starter copy that we still want to recognize as
 * "untouched" on existing deployments where the row was seeded before the
 * `starter_hash` column existed (so the column is NULL but the content still
 * matches a previous starter — meaning no admin has customized it).
 *
 * Entries below are full pre-rendered HTML documents (not calls into the
 * live `wrapHtml()`), captured verbatim from the actual historical starter
 * content so they stay frozen even as `wrapHtml()` itself evolves. Legacy
 * rows on this deployment predate the "™" trademark symbol being added to
 * the brand name, so most of these entries omit it to match exactly.
 *
 * Keep in chronological order; only add an entry when the live starter copy
 * for a slug actually changes. Slugs whose copy has never changed don't need
 * an entry — the current copy in `transactionalEmailTemplates` is recognized
 * automatically.
 */
export const priorStarterRevisions: Record<string, StarterContent[]> = {
  // Pre-Task #152 copy: button colors used #1a56db and the "no need to create
  // a new account" sub-clause was missing. Plus the immediately-pre-Task
  // #1714 copy (identical body, wrapped in the pre-redesign dark-navy/gray
  // layout instead of the new white/BTS-blue layout).
  signup_attempted: [
    {
      name: "Signup Attempted on Existing Email",
      subject: "Someone tried to sign up with your email",
      htmlBody: oldWrapHtmlV1("Signup Attempted", `
<h2 style="color:#1a1a2e;margin-top:0;">Signup Attempt on Your Account</h2>
<p>Hi {{member_name}},</p>
<p>Someone just tried to create a new Build Test Scale account using <strong>{{member_email}}</strong>. Since this address already has an account, no new account was created.</p>
<p>If this was you, you can sign in or reset your password instead:</p>
<p>
<a href="{{portal_url}}/login" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-right:8px;">Sign In</a>
<a href="{{portal_url}}/forgot-password" style="display:inline-block;background:#ffffff;color:#1a56db;border:1px solid #1a56db;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password</a>
</p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If this <strong>wasn't you</strong>, you can safely ignore this email — your account is unchanged. If you're seeing repeated attempts, contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>The BTS Team</p>`),
      textBody: "Hi {{member_name}},\n\nSomeone just tried to create a new Build Test Scale account using {{member_email}}. Since this address already has an account, no new account was created.\n\nIf this was you, sign in: {{portal_url}}/login\nOr reset your password: {{portal_url}}/forgot-password\n\nIf this wasn't you, you can ignore this email — your account is unchanged.\n\nThe BTS Team",
    },
    {
      name: "Signup Attempted on Existing Email",
      subject: "Someone tried to sign up with your email",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Signup Attempted</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Signup Attempt on Your Account</h2>
<p>Hi {{member_name}},</p>
<p>Someone just tried to create a new Build Test Scale account using <strong>{{member_email}}</strong>. Since this address already has an account, no new account was created.</p>
<p>If this was you, you can sign in or reset your password instead — there's no need to create a new account:</p>
<p>
<a href="{{portal_url}}/login?email={{member_email_encoded}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-right:8px;">Sign In</a>
<a href="{{portal_url}}/forgot-password?email={{member_email_encoded}}" style="display:inline-block;background:#ffffff;color:#4f46e5;border:1px solid #4f46e5;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password</a>
</p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If this <strong>wasn't you</strong>, you can safely ignore this email — your account is unchanged. If you're seeing repeated attempts, contact <a href="mailto:{{support_email}}" style="color:#4f46e5;">{{support_email}}</a>.</p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nSomeone just tried to create a new Build Test Scale account using {{member_email}}. Since this address already has an account, no new account was created.\n\nIf this was you, sign in: {{portal_url}}/login?email={{member_email_encoded}}\nOr reset your password: {{portal_url}}/forgot-password?email={{member_email_encoded}}\n\nIf this wasn't you, you can ignore this email \u2014 your account is unchanged.\n\nThe BTS Team",
    },
  ],
  // Earlier copy: linked to the generic /support page instead of a deep link
  // to the specific ticket. Plus the immediately-pre-Task #1714 copy
  // (identical body, old wrapper).
  ticket_reply: [
    {
      name: "Support Ticket Reply",
      subject: "New reply on ticket #{{ticket_number}}",
      htmlBody: oldWrapHtmlV1("Ticket Reply", `
<h2 style="color:#1a1a2e;margin-top:0;">New Reply on Your Ticket</h2>
<p>Hi {{member_name}},</p>
<p>There's a new reply on your support ticket <strong>#{{ticket_number}}</strong>.</p>
<p><a href="{{portal_url}}/support" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Reply</a></p>
<p>The BTS Team</p>`),
      textBody: "Hi {{member_name}},\n\nNew reply on ticket #{{ticket_number}}. View it at {{portal_url}}/support\n\nThe BTS Team",
    },
    {
      name: "Support Ticket Reply",
      subject: "New reply on ticket #{{ticket_number}}",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ticket Reply</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">New Reply on Your Ticket</h2>
<p>Hi {{member_name}},</p>
<p>Our support team just replied to your ticket <strong>#{{ticket_number}}</strong>. Open it in your portal to read the response and continue the conversation.</p>
<p><a href="{{portal_url}}/support/tickets/{{ticket_id}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Reply</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nOur support team just replied to your ticket #{{ticket_number}}. Read it at {{portal_url}}/support/tickets/{{ticket_id}}\n\nThe BTS Team",
    },
  ],
  // Pre-Task #242 copy: pointed members at /settings instead of the dedicated
  // restart link (no `restart_url` variable yet). Plus the
  // immediately-pre-Task #1714 copy (identical body, old wrapper).
  email_change_cancelled_by_admin: [
    {
      name: "Email Change Cancelled by Admin",
      subject: "Your pending email change was cancelled by Build Test Scale support",
      htmlBody: oldWrapHtmlV1("Pending Email Change Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hi {{member_name}},</p>
<p>Our support team has cancelled the pending email change on your Build Test Scale account. The address we had queued — <strong>{{cancelled_pending_email}}</strong> — has been discarded and was never activated.</p>
<p>Your account email remains <strong>{{member_email}}</strong>, which is the address you should keep using to sign in. <strong>No further action is required from you.</strong></p>
<p>If you still want to switch your account to a different email address, you can start a new request anytime from your account settings:</p>
<p><a href="{{portal_url}}/settings" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Go to Account Settings</a></p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If you weren't expecting support to cancel this change, or you have any questions, please reply to this email or reach out to <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
      textBody: "Hi {{member_name}},\n\nOur support team has cancelled the pending email change on your Build Test Scale account. The address we had queued — {{cancelled_pending_email}} — has been discarded and was never activated.\n\nYour account email remains {{member_email}}, which is the address you should keep using to sign in. No further action is required from you.\n\nIf you still want to switch your account to a different email address, you can start a new request anytime from your account settings: {{portal_url}}/settings\n\nIf you weren't expecting this, contact {{support_email}}.\n\nThe BTS Team",
    },
    {
      name: "Email Change Cancelled by Admin",
      subject: "Your pending email change was cancelled by Build Test Scale support",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pending Email Change Cancelled</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hi {{member_name}},</p>
<p>Our support team has cancelled the pending email change on your Build Test Scale account. The address we had queued — <strong>{{cancelled_pending_email}}</strong> — has been discarded and was never activated.</p>
<p>Your account email remains <strong>{{member_email}}</strong>, which is the address you should keep using to sign in. <strong>No further action is required from you.</strong></p>
<p>If you still meant to switch your account to <strong>{{cancelled_pending_email}}</strong> (or another address), use the button below — we'll drop you straight onto the email-change form with the previously requested address pre-filled so you don't have to retype it. You'll still need to sign in and re-enter your password to confirm the change.</p>
<p><a href="{{restart_url}}" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Start a new email change</a></p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If you weren't expecting support to cancel this change, or you have any questions, please reply to this email or reach out to <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nOur support team has cancelled the pending email change on your Build Test Scale account. The address we had queued \u2014 {{cancelled_pending_email}} \u2014 has been discarded and was never activated.\n\nYour account email remains {{member_email}}, which is the address you should keep using to sign in. No further action is required from you.\n\nIf you still meant to switch your account to {{cancelled_pending_email}} (or another address), open this link to jump straight to the email-change form with the previous address pre-filled (you'll still need to sign in and re-enter your password):\n{{restart_url}}\n\nIf you weren't expecting this, contact {{support_email}}.\n\nThe BTS Team",
    },
  ],
  // Oldest known copy: minified single-line HTML with no <head>/meta tags,
  // predating even the pre-Task #1714 pretty-printed wrapper. Plus the
  // immediately-pre-Task #1714 copy (pretty-printed, no trademark symbol).
  flexy_password_reset: [
    {
      name: "Flexy Password Reset",
      subject: "Your new Flexy password",
      htmlBody: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;"><h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1></td></tr>
<tr><td style="padding:30px;">
<h2 style="color:#1a1a2e;margin-top:0;">Your Flexy password has been reset</h2>
<p>Hi {{member_name}},</p>
<p>Our support team just generated a new password for your Flexy login. Use the credentials below the next time you sign in.</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;font-family:monospace;"><strong>Login email:</strong> {{flexy_email}}<br><strong>New password:</strong> {{flexy_password}}</p>
<p>For your security, change this password to something only you know after you log in. If you did not request this reset, contact us right away at {{support_email}}.</p>
<p><a href="{{flexy_login_url}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Open Flexy Login</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;"><p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p></td></tr>
</table></td></tr></table></body></html>`,
      textBody: "Hi {{member_name}},\n\nOur support team just generated a new password for your Flexy login.\n\nLogin email: {{flexy_email}}\nNew password: {{flexy_password}}\n\nFor your security, change this password after you log in. If you did not request this reset, contact {{support_email}} right away.\n\nLog in at {{flexy_login_url}}\n\nThe BTS Team",
    },
    {
      name: "Flexy Password Reset",
      subject: "Your new Flexy password",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Flexy Password Reset</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Your Flexy password has been reset</h2>
<p>Hi {{member_name}},</p>
<p>Our support team just generated a new password for your Flexy login. Use the credentials below the next time you sign in.</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;font-family:monospace;">
<strong>Login email:</strong> {{flexy_email}}<br>
<strong>New password:</strong> {{flexy_password}}
</p>
<p>For your security, change this password to something only you know after you log in. If you did not request this reset, contact us right away at {{support_email}}.</p>
<p><a href="{{flexy_login_url}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Open Flexy Login</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nOur support team just generated a new password for your Flexy login.\n\nLogin email: {{flexy_email}}\nNew password: {{flexy_password}}\n\nFor your security, change this password after you log in. If you did not request this reset, contact {{support_email}} right away.\n\nLog in at {{flexy_login_url}}\n\nThe BTS Team",
    },
  ],
  // Task #1714: immediately-pre-redesign copy for every other slug whose
  // body text is unchanged by the branded-layout redesign — only the shared
  // wrapper changed. Full pre-rendered HTML captured verbatim (not a call
  // into `oldWrapHtmlV1`) so it stays frozen exactly as it looked pre-1714,
  // with the trademark symbol stripped to match how these rows were
  // actually seeded on existing deployments. Needed so legacy
  // NULL-starter-hash rows are recognized as untouched starter copy, not
  // admin customization, and get refreshed to the new branded layout on
  // next boot.
  welcome: [
    {
      name: "Welcome Email",
      subject: "Welcome to Build Test Scale, {{member_name}}!",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Welcome</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Welcome to Build Test Scale!</h2>
<p>Hi {{member_name}},</p>
<p>We're thrilled to have you join the BTS community. Your account has been created and you're ready to start your journey.</p>
<p>Your temporary password is: <strong>{{temp_password}}</strong></p>
<p>Please log in and change your password as soon as possible.</p>
<p><a href="{{portal_url}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Log In to Your Portal</a></p>
<p>If you have any questions, reply to this email or reach out to {{support_email}}.</p>
<p>Welcome aboard!<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Welcome to Build Test Scale, {{member_name}}!\n\nYour temporary password is: {{temp_password}}\n\nLog in at {{portal_url}} and change your password.\n\nWelcome aboard!\nThe BTS Team",
    },
  ],
  email_verification: [
    {
      name: "Email Verification",
      subject: "Verify your email address",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email Verification</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Verify Your Email</h2>
<p>Hi {{member_name}},</p>
<p>Please verify your email address to complete your account setup.</p>
<p><a href="{{portal_url}}/verify-email?token={{verify_token}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Verify Email</a></p>
<p>This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
<p>Thanks,<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nVerify your email: {{portal_url}}/verify-email?token={{verify_token}}\n\nThis link expires in 24 hours.\n\nThe BTS Team",
    },
  ],
  password_reset: [
    {
      name: "Password Reset",
      subject: "Reset your password",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Password Reset</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Reset Your Password</h2>
<p>Hi {{member_name}},</p>
<p>We received a request to reset your password. Click the button below to set a new password.</p>
<p><a href="{{portal_url}}/reset-password?token={{reset_token}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password</a></p>
<p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
<p>Thanks,<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nReset your password: {{portal_url}}/reset-password?token={{reset_token}}\n\nThis link expires in 1 hour.\n\nThe BTS Team",
    },
  ],
  new_device_signin: [
    {
      name: "New Sign-in Detected",
      subject: "New sign-in to your Build Test Scale account",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>New Sign-in Detected</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">New Sign-in Detected</h2>
<p>Hi {{member_name}},</p>
<p>Your Build Test Scale account was just signed in to from a device we haven't seen before:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;">
<strong>Device:</strong> {{device_description}}<br>
<strong>IP address:</strong> {{ip_address}}<br>
<strong>When:</strong> {{sign_in_time}}
</p>
<p>If this was you, no action is needed.</p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If this <strong>wasn't you</strong>, your account may be compromised. Review where you're signed in and sign out the device you don't recognize, then change your password right away.</p>
<p><a href="{{portal_url}}/account#sessions" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Review your devices</a></p>
<p>Questions? Contact <a href="mailto:{{support_email}}" style="color:#4f46e5;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour Build Test Scale account was just signed in to from a device we haven't seen before:\n\nDevice: {{device_description}}\nIP address: {{ip_address}}\nWhen: {{sign_in_time}}\n\nIf this was you, no action is needed.\n\nIf this wasn't you, your account may be compromised. Review where you're signed in and sign out the device you don't recognize, then change your password right away:\n{{portal_url}}/account#sessions\n\nQuestions? Contact {{support_email}}.\n\nThe BTS Team",
    },
  ],
  email_change_verify: [
    {
      name: "Email Change Verification",
      subject: "Confirm your new Build Test Scale email address",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Confirm New Email</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Confirm Your New Email</h2>
<p>Hi {{member_name}},</p>
<p>We received a request to change the email address on your Build Test Scale account from <strong>{{old_email}}</strong> to <strong>{{new_email}}</strong>.</p>
<p>Click the button below within 24 hours to confirm this change. After confirming, you'll need to sign in again using your new email address.</p>
<p><a href="{{portal_url}}/verify-email-change?token={{verify_token}}" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Confirm New Email</a></p>
<p>If you didn't request this change, you can safely ignore this email — your address will stay the same.</p>
<p>Thanks,<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nConfirm changing your Build Test Scale email from {{old_email}} to {{new_email}}:\n{{portal_url}}/verify-email-change?token={{verify_token}}\n\nThis link expires in 24 hours. If you didn't request this, ignore this email.\n\nThe BTS Team",
    },
  ],
  email_change_notice: [
    {
      name: "Email Change Notice (Old Address)",
      subject: "Email change requested on your Build Test Scale account",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email Change Requested</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Email Change Requested</h2>
<p>Hi {{member_name}},</p>
<p>We received a request to change the email address on your Build Test Scale account to <strong>{{new_email}}</strong>. The change will only take effect once it's confirmed from the new address.</p>
<p>If this was you, no further action is needed at this address — just confirm the change from your new inbox.</p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If this <strong>wasn't you</strong>, please sign in and reset your password immediately, then contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>. Your current email address will keep working until the new one is confirmed.</p>
<p>Thanks,<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nWe received a request to change your Build Test Scale email to {{new_email}}. The change only takes effect after it's confirmed from the new address.\n\nIf this wasn't you, sign in and reset your password immediately, then contact {{support_email}}.\n\nThe BTS Team",
    },
  ],
  email_change_cancelled_by_admin_pending: [
    {
      name: "Email Change Cancelled by Admin (Pending Address)",
      subject: "A pending email change to this address was cancelled by Build Test Scale support",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pending Email Change Cancelled</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hello,</p>
<p>Someone recently asked us to switch the email address on a Build Test Scale account to <strong>{{cancelled_pending_email}}</strong> — this inbox. Our support team has since cancelled that pending change, so this address was never linked to the account and the verification link we sent earlier no longer works.</p>
<p><strong>No action is required from you.</strong> You don't need to click anything, sign in, or reply.</p>
<p style="margin-top:24px;padding:12px 16px;background:#f3f4f6;border-left:4px solid #6b7280;color:#374151;">If you weren't expecting any messages from us, you can safely ignore this email — this address has not been added to any account. If you have questions or believe you're receiving these messages by mistake, contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hello,\n\nSomeone recently asked us to switch the email address on a Build Test Scale account to {{cancelled_pending_email}} \u2014 this inbox. Our support team has since cancelled that pending change, so this address was never linked to the account and the verification link we sent earlier no longer works.\n\nNo action is required from you. You don't need to click anything, sign in, or reply.\n\nIf you weren't expecting any messages from us, you can safely ignore this email \u2014 this address has not been added to any account. If you have questions, contact {{support_email}}.\n\nThe BTS Team",
    },
  ],
  email_change_cancelled_by_member: [
    {
      name: "Email Change Cancelled by Member",
      subject: "Your pending email change was cancelled",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pending Email Change Cancelled</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hi {{member_name}},</p>
<p>You just cancelled the pending email change on your Build Test Scale account. The address we had queued — <strong>{{cancelled_pending_email}}</strong> — has been discarded and was never activated.</p>
<p>Your account email remains <strong>{{member_email}}</strong>, which is the address you should keep using to sign in. <strong>No further action is required from you.</strong></p>
<p>Changed your mind, or made a typo the first time? Use the button below — we'll drop you straight onto the email-change form with the previously requested address pre-filled so you don't have to retype it. You'll still need to sign in and re-enter your password to confirm the change.</p>
<p><a href="{{restart_url}}" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Start a new email change</a></p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If you <strong>didn't</strong> cancel this change yourself, sign in and reset your password immediately, then contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYou just cancelled the pending email change on your Build Test Scale account. The address we had queued \u2014 {{cancelled_pending_email}} \u2014 has been discarded and was never activated.\n\nYour account email remains {{member_email}}, which is the address you should keep using to sign in. No further action is required from you.\n\nChanged your mind, or made a typo the first time? Open this link to jump straight to the email-change form with the previous address pre-filled (you'll still need to sign in and re-enter your password):\n{{restart_url}}\n\nIf you didn't cancel this change yourself, sign in and reset your password immediately, then contact {{support_email}}.\n\nThe BTS Team",
    },
  ],
  email_change_cancelled_by_member_pending: [
    {
      name: "Email Change Cancelled (Pending Address)",
      subject: "A pending email change to this address was cancelled",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pending Email Change Cancelled</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hello,</p>
<p>Someone recently asked us to switch the email address on a Build Test Scale account to <strong>{{cancelled_pending_email}}</strong> — this inbox. That request has since been withdrawn, so this address was never linked to the account and the verification link we sent earlier no longer works.</p>
<p><strong>No action is required from you.</strong> You don't need to click anything, sign in, or reply.</p>
<p style="margin-top:24px;padding:12px 16px;background:#f3f4f6;border-left:4px solid #6b7280;color:#374151;">If you weren't expecting any messages from us, you can safely ignore this email — this address has not been added to any account. If you have questions or believe you're receiving these messages by mistake, contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hello,\n\nSomeone recently asked us to switch the email address on a Build Test Scale account to {{cancelled_pending_email}} \u2014 this inbox. That request has since been withdrawn, so this address was never linked to the account and the verification link we sent earlier no longer works.\n\nNo action is required from you. You don't need to click anything, sign in, or reply.\n\nIf you weren't expecting any messages from us, you can safely ignore this email \u2014 this address has not been added to any account. If you have questions, contact {{support_email}}.\n\nThe BTS Team",
    },
  ],
  purchase_confirmation: [
    {
      name: "Purchase Confirmation",
      subject: "Your purchase of {{product_name}} is confirmed!",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Purchase Confirmation</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Purchase Confirmed!</h2>
<p>Hi {{member_name}},</p>
<p>Great news — your purchase of <strong>{{product_name}}</strong> has been confirmed and your access is now active.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Go to Dashboard</a></p>
<p>If you have any questions about getting started, our support team is here to help.</p>
<p>Let's build something great!<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour purchase of {{product_name}} is confirmed! Access is now active.\n\nLog in at {{portal_url}}/dashboard\n\nThe BTS Team",
    },
  ],
  payment_failed: [
    {
      name: "Payment Failed",
      subject: "Action required: Payment failed for {{product_name}}",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment Failed</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#dc2626;margin-top:0;">Payment Failed</h2>
<p>Hi {{member_name}},</p>
<p>We were unable to process your payment for <strong>{{product_name}}</strong>.</p>
<p>Your access will remain active until <strong>{{grace_date}}</strong> while we retry your payment. Please update your payment information to avoid losing access.</p>
<p><a href="{{portal_url}}/settings/billing" style="display:inline-block;background:#dc2626;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Update Payment Info</a></p>
<p>If you need help, contact us at {{support_email}}.</p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nPayment failed for {{product_name}}. Your access continues until {{grace_date}}.\n\nPlease update your payment info at {{portal_url}}/settings/billing\n\nThe BTS Team",
    },
  ],
  payment_recovered: [
    {
      name: "Payment Recovered",
      subject: "Payment successful \u2014 {{product_name}} access restored",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment Recovered</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#16a34a;margin-top:0;">Payment Successful!</h2>
<p>Hi {{member_name}},</p>
<p>Great news — your payment for <strong>{{product_name}}</strong> has been successfully processed and your access continues uninterrupted.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Go to Dashboard</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour payment for {{product_name}} was successful. Access continues.\n\nThe BTS Team",
    },
  ],
  refund_processed: [
    {
      name: "Refund Processed",
      subject: "Your refund for {{product_name}} has been processed",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Refund Processed</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Refund Processed</h2>
<p>Hi {{member_name}},</p>
<p>Your refund for <strong>{{product_name}}</strong> has been processed. Your access to this product has been removed.</p>
<p>If you have questions or believe this was a mistake, contact us at {{support_email}}.</p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour refund for {{product_name}} has been processed. Access removed.\n\nContact {{support_email}} with questions.\n\nThe BTS Team",
    },
  ],
  subscription_cancelled: [
    {
      name: "Subscription Cancelled",
      subject: "Your {{product_name}} subscription has been cancelled",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Subscription Cancelled</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Subscription Cancelled</h2>
<p>Hi {{member_name}},</p>
<p>Your subscription for <strong>{{product_name}}</strong> has been cancelled. You'll continue to have access until the end of your current billing period.</p>
<p>Changed your mind? You can resubscribe at any time.</p>
<p><a href="{{portal_url}}/settings" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Manage Account</a></p>
<p>We're sorry to see you go.<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour {{product_name}} subscription has been cancelled. Access continues until end of billing period.\n\nThe BTS Team",
    },
  ],
  mentorship_expiring_warning: [
    {
      name: "Mentorship Expiring Warning (30 days)",
      subject: "Your {{product_name}} expires in less than 30 days",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Expiring Soon</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#f59e0b;margin-top:0;">Your Access is Expiring Soon</h2>
<p>Hi {{member_name}},</p>
<p>Your <strong>{{product_name}}</strong> access expires on <strong>{{expiration_date}}</strong>.</p>
<p>Don't lose access to your training, coaching calls, and community. Renew now to continue your journey.</p>
<p><a href="{{portal_url}}/settings" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Renew Now</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour {{product_name}} expires on {{expiration_date}}. Renew at {{portal_url}}/settings\n\nThe BTS Team",
    },
  ],
  mentorship_expiring_urgent: [
    {
      name: "Mentorship Expiring Urgent (7 days)",
      subject: "URGENT: Your {{product_name}} expires in less than 7 days!",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Expiring Urgently</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#dc2626;margin-top:0;">Your Access Expires This Week!</h2>
<p>Hi {{member_name}},</p>
<p>Your <strong>{{product_name}}</strong> access expires on <strong>{{expiration_date}}</strong> — that's less than 7 days away!</p>
<p>Act now to avoid losing access to all your training materials, coaching calls, and community.</p>
<p><a href="{{portal_url}}/settings" style="display:inline-block;background:#dc2626;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Renew Now — Don't Lose Access</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "URGENT: Hi {{member_name}}, your {{product_name}} expires on {{expiration_date}}! Renew now at {{portal_url}}/settings to keep your access.\n\nThe BTS Team",
    },
  ],
  mentorship_expired: [
    {
      name: "Mentorship Expired",
      subject: "Your {{product_name}} access has expired",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Access Expired</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#dc2626;margin-top:0;">Your Access Has Expired</h2>
<p>Hi {{member_name}},</p>
<p>Your <strong>{{product_name}}</strong> access expired on {{expiration_date}}.</p>
<p>To regain access to your training, coaching, and community, please renew your membership.</p>
<p><a href="{{portal_url}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Renew Membership</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour {{product_name}} access has expired. Renew at {{portal_url}}\n\nThe BTS Team",
    },
  ],
  ticket_created: [
    {
      name: "Support Ticket Created",
      subject: "Ticket #{{ticket_number}} received \u2014 we'll get back to you soon",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ticket Created</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">We Received Your Ticket</h2>
<p>Hi {{member_name}},</p>
<p>Your support ticket <strong>#{{ticket_number}}</strong> has been received. Our team will review it and respond as soon as possible.</p>
<p><strong>Subject:</strong> {{ticket_subject}}</p>
<p><a href="{{portal_url}}/support" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Tickets</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nTicket #{{ticket_number}} received. Subject: {{ticket_subject}}\n\nWe'll respond soon.\n\nThe BTS Team",
    },
  ],
  account_locked: [
    {
      name: "Account Locked",
      subject: "Your account has been temporarily locked",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Account Locked</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#dc2626;margin-top:0;">Account Temporarily Locked</h2>
<p>Hi {{member_name}},</p>
<p>Your account has been temporarily locked due to too many failed login attempts. It will automatically unlock in 15 minutes.</p>
<p>If you've forgotten your password, you can reset it below.</p>
<p><a href="{{portal_url}}/forgot-password" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour account has been temporarily locked due to failed login attempts. It will unlock in 15 minutes. Reset password: {{portal_url}}/forgot-password\n\nThe BTS Team",
    },
  ],
  password_changed: [
    {
      name: "Password Changed",
      subject: "Your password has been changed",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Password Changed</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Password Changed Successfully</h2>
<p>Hi {{member_name}},</p>
<p>Your password has been successfully changed. All existing sessions have been logged out for security.</p>
<p>If you didn't make this change, please contact us immediately at {{support_email}}.</p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour password has been changed. If you didn't do this, contact {{support_email}} immediately.\n\nThe BTS Team",
    },
  ],
  tier_upgrade: [
    {
      name: "Tier Upgrade Confirmation",
      subject: "Welcome to {{product_name}} \u2014 you've been upgraded!",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tier Upgrade</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#16a34a;margin-top:0;">You've Been Upgraded!</h2>
<p>Hi {{member_name}},</p>
<p>Congratulations! Your access has been upgraded to <strong>{{product_name}}</strong>.</p>
<p>You now have access to additional training, coaching, and tools. Log in to explore everything that's new.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Explore Your New Access</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYou've been upgraded to {{product_name}}! Log in at {{portal_url}}/dashboard to explore.\n\nThe BTS Team",
    },
  ],
  role_changed: [
    {
      name: "Admin Role Changed",
      subject: "Your Build Test Scale role is now {{new_role_label}}",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Role Changed</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Your role was updated</h2>
<p>Hi {{member_name}},</p>
<p>{{actor_name}} just updated your access on Build Test Scale.</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;">
<strong>Previous role:</strong> {{previous_role_label}}<br>
<strong>New role:</strong> {{new_role_label}}
</p>
<p>This change takes effect the next time you sign in. You may notice that some admin tools you used before are no longer visible, or that new ones have appeared.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Open Your Dashboard</a></p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If you weren't expecting this change, please reach out to <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\n{{actor_name}} just updated your access on Build Test Scale.\n\nPrevious role: {{previous_role_label}}\nNew role: {{new_role_label}}\n\nThis change takes effect the next time you sign in. Open your dashboard at {{portal_url}}/dashboard.\n\nIf you weren't expecting this change, contact {{support_email}}.\n\nThe BTS Team",
    },
  ],
  concierge_task_created: [
    {
      name: "Concierge Task Submitted",
      subject: "Your Concierge task {{ticket_number}} has been received",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Concierge Task Received</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Concierge Task Received</h2>
<p>Hi {{member_name}},</p>
<p>Your BTS Concierge task has been received and logged under reference <strong>{{ticket_number}}</strong>.</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;">
<strong>Task:</strong> {{task_subject}}<br>
<strong>Reference:</strong> {{ticket_number}}
</p>
<p>Our Concierge team typically turns tasks around within <strong>24–72 hours</strong>. We'll reach out if we need any additional information.</p>
<p><a href="{{portal_url}}/support" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Your Submission</a></p>
<p>Thank you for using the BTS Concierge!<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour BTS Concierge task has been received.\n\nTask: {{task_subject}}\nReference: {{ticket_number}}\n\nOur team will turn this around within 24-72 hours.\n\nView it at {{portal_url}}/support\n\nThe BTS Team",
    },
  ],
  compliance_review_created: [
    {
      name: "Compliance Review Submitted",
      subject: "Your compliance review {{ticket_number}} has been received",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Compliance Review Received</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Compliance Review Received</h2>
<p>Hi {{member_name}},</p>
<p>Your compliance review submission has been received and logged under reference <strong>{{ticket_number}}</strong>.</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;">
<strong>Offer:</strong> {{task_subject}}<br>
<strong>Reference:</strong> {{ticket_number}}
</p>
<p>Our compliance team will review your creative within <strong>24 hours</strong>. Please do <strong>not</strong> run the creative on any traffic source until you have received our approval.</p>
<p><a href="{{portal_url}}/support" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Your Submission</a></p>
<p>Thank you,<br>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour compliance review has been received.\n\nOffer: {{task_subject}}\nReference: {{ticket_number}}\n\nOur team will review within 24 hours. Do NOT run the creative until you receive approval.\n\nView it at {{portal_url}}/support\n\nThe BTS Team",
    },
  ],
  onboarding_day1: [
    {
      name: "Onboarding Day 1 \u2014 Getting Started",
      subject: "Your first step inside Build Test Scale",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Getting Started</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Let's Get You Started</h2>
<p>Hi {{member_name}},</p>
<p>Welcome to Day 1! Here's the fastest way to get value from your BTS membership:</p>
<ol>
<li>Complete your profile and onboarding</li>
<li>Watch the first lesson in your training track</li>
<li>Check out the upcoming coaching calls</li>
</ol>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Start Now</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nWelcome to Day 1! Get started:\n1. Complete your profile\n2. Watch your first lesson\n3. Check coaching calls\n\nStart at {{portal_url}}/dashboard\n\nThe BTS Team",
    },
  ],
  onboarding_day3: [
    {
      name: "Onboarding Day 3 \u2014 First Lesson Nudge",
      subject: "Have you started your first lesson yet?",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>First Lesson</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Time to Dive In</h2>
<p>Hi {{member_name}},</p>
<p>It's been a few days since you joined. The members who see results fastest are the ones who start their training right away.</p>
<p>Your first lesson is waiting — it only takes 15 minutes.</p>
<p><a href="{{portal_url}}/training" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Start Your First Lesson</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nHave you started your first lesson? It only takes 15 minutes. Start at {{portal_url}}/training\n\nThe BTS Team",
    },
  ],
  onboarding_day7: [
    {
      name: "Onboarding Day 7 \u2014 Week 1 Recap",
      subject: "Your first week at BTS \u2014 here's what's next",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Week 1 Recap</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Your First Week Recap</h2>
<p>Hi {{member_name}},</p>
<p>You've been a BTS member for a week now. Here's what you should focus on next:</p>
<ul>
<li>Continue working through your training track</li>
<li>Join a live coaching call this week</li>
<li>Ask questions in the community</li>
</ul>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Check Your Progress</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour first week recap. Next steps: continue training, join a coaching call, engage with community.\n\n{{portal_url}}/dashboard\n\nThe BTS Team",
    },
  ],
  coaching_reminder: [
    {
      name: "Coaching Call Reminder",
      subject: "Live coaching call tomorrow: {{call_title}}",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Coaching Reminder</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Coaching Call Tomorrow</h2>
<p>Hi {{member_name}},</p>
<p>Don't forget — there's a live coaching call happening tomorrow:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{call_title}}</strong><br>{{call_date}} at {{call_time}}</p>
<p><a href="{{portal_url}}/coaching" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Details</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nCoaching call tomorrow: {{call_title}} at {{call_time}}.\n\nDetails: {{portal_url}}/coaching\n\nThe BTS Team",
    },
  ],
  session_feedback: [
    {
      name: "Session Feedback Prompt",
      subject: "How was {{call_title}}? We'd love your feedback",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Session Feedback</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">How Was Your Session?</h2>
<p>Hi {{member_name}},</p>
<p>Thanks for being part of <strong>{{call_title}}</strong>. We'd love to hear how it went — your feedback helps us make every coaching session better.</p>
<p>It only takes a minute, and the recording is also available if you'd like to revisit anything.</p>
<p><a href="{{portal_url}}/coaching" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Share Your Feedback</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nThanks for being part of {{call_title}}. We'd love your feedback \u2014 it helps us make every coaching session better. The recording is also available if you'd like to revisit anything.\n\nShare your feedback: {{portal_url}}/coaching\n\nThe BTS Team",
    },
  ],
  session_recording_ready: [
    {
      name: "Private Coaching Session Recording Ready",
      subject: "Your Private Coaching recording is ready",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Recording Ready</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Your Recording Is Ready</h2>
<p>Hi {{member_name}},</p>
<p>The recording from your recent Private Coaching session is now available. Want to revisit something? You can watch it any time.</p>
<p><a href="{{portal_url}}{{recording_path}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Watch the Recording</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nThe recording from your recent Private Coaching session is now available. Watch it any time: {{portal_url}}{{recording_path}}\n\nThe BTS Team",
    },
  ],
  new_content_alert: [
    {
      name: "New Content Available",
      subject: "New content just dropped: {{content_title}}",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>New Content</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">New Content Available!</h2>
<p>Hi {{member_name}},</p>
<p>We just published new content that's available to you:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{content_title}}</strong><br>{{content_description}}</p>
<p><a href="{{portal_url}}/training" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Check It Out</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nNew content: {{content_title}} \u2014 {{content_description}}\n\nView at {{portal_url}}/training\n\nThe BTS Team",
    },
  ],
  streak_milestone: [
    {
      name: "Streak Milestone",
      subject: "You're on a {{streak_count}}-day streak! Keep it up!",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Streak Milestone</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#16a34a;margin-top:0;">{{streak_count}}-Day Streak!</h2>
<p>Hi {{member_name}},</p>
<p>You've been consistently learning for <strong>{{streak_count}} days</strong> straight. That's the kind of consistency that builds real results.</p>
<p>Keep it going — momentum is everything in this business.</p>
<p><a href="{{portal_url}}/training" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Continue Learning</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYou're on a {{streak_count}}-day streak! Keep it going at {{portal_url}}/training\n\nThe BTS Team",
    },
  ],
  win_of_the_week: [
    {
      name: "Win of the Week",
      subject: "This week's biggest wins from the BTS community",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Win of the Week</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">This Week's Wins</h2>
<p>Hi {{member_name}},</p>
<p>Check out what members accomplished this week:</p>
<p>{{wins_content}}</p>
<p>Your win could be featured next! Keep pushing forward.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Back to Your Dashboard</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nThis week's wins:\n{{wins_content}}\n\nYour win could be next!\n\nThe BTS Team",
    },
  ],
  monthly_progress: [
    {
      name: "Monthly Progress Report",
      subject: "Your monthly progress report is ready",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Monthly Progress</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Your Monthly Progress</h2>
<p>Hi {{member_name}},</p>
<p>Here's your progress for {{month_name}}:</p>
<ul>
<li>Lessons completed: {{lessons_completed}}</li>
<li>Coaching calls attended: {{calls_attended}}</li>
<li>Current streak: {{streak_count}} days</li>
</ul>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Full Dashboard</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour {{month_name}} progress: {{lessons_completed}} lessons, {{calls_attended}} calls, {{streak_count}}-day streak.\n\nThe BTS Team",
    },
  ],
  upgrade_offer: [
    {
      name: "Upgrade Offer",
      subject: "Ready for the next level? Upgrade to {{upgrade_product}}",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Upgrade Offer</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Ready to Level Up?</h2>
<p>Hi {{member_name}},</p>
<p>You've been crushing it with your current access. Want to unlock even more?</p>
<p><strong>{{upgrade_product}}</strong> gives you:</p>
<ul>
<li>Advanced training modules</li>
<li>Live coaching calls</li>
<li>Community access</li>
<li>And much more</li>
</ul>
<p><a href="{{portal_url}}/upgrade" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">See Upgrade Options</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nReady for the next level? Upgrade to {{upgrade_product}} for advanced training, coaching, and more.\n\n{{portal_url}}/upgrade\n\nThe BTS Team",
    },
  ],
  re_engagement: [
    {
      name: "Re-engagement \u2014 We Miss You",
      subject: "We miss you, {{member_name}}!",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>We Miss You</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">We Miss You!</h2>
<p>Hi {{member_name}},</p>
<p>It's been a while since you logged in. Your training is waiting, and new content has been added since your last visit.</p>
<p>Jump back in — even 15 minutes a day can make a difference.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Get Back to Learning</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nWe miss you! New content has been added. Jump back in at {{portal_url}}/dashboard\n\nThe BTS Team",
    },
  ],
  community_announcement: [
    {
      name: "Community Announcement",
      subject: "{{announcement_title}}",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Announcement</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">{{announcement_title}}</h2>
<p>Hi {{member_name}},</p>
<p>{{announcement_body}}</p>
<p><a href="{{portal_url}}/announcements" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Read More</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\n{{announcement_title}}\n\n{{announcement_body}}\n\nRead more at {{portal_url}}/announcements\n\nThe BTS Team",
    },
  ],
  kickoff_call_reminder: [
    {
      name: "Kickoff Call Reminder",
      subject: "Your kickoff call is tomorrow",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kickoff Call Reminder</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Your Kickoff Call Is Tomorrow</h2>
<p>Hi {{member_name}},</p>
<p>Don't forget — your kickoff call with {{staff_name}} is coming up:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{call_date}} at {{call_time}}</strong></p>
<p><a href="{{portal_url}}/onboarding" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Details</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour kickoff call with {{staff_name}} is tomorrow: {{call_date}} at {{call_time}}.\n\nDetails: {{portal_url}}/onboarding\n\nThe BTS Team",
    },
  ],
  partner_call_reminder: [
    {
      name: "Accountability Partner Call Reminder",
      subject: "Your accountability partner call is tomorrow",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Partner Call Reminder</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">Your Partner Call Is Tomorrow</h2>
<p>Hi {{member_name}},</p>
<p>Don't forget — your accountability call with {{staff_name}} is coming up:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{call_date}} at {{call_time}}</strong></p>
<p><a href="{{portal_url}}/accountability-partner" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Details</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYour accountability call with {{staff_name}} is tomorrow: {{call_date}} at {{call_time}}.\n\nDetails: {{portal_url}}/accountability-partner\n\nThe BTS Team",
    },
  ],
  event_invitation: [
    {
      name: "Event Invitation",
      subject: "You're invited: {{event_title}}",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Event Invitation</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#1a1a2e;margin-top:0;">You're Invited!</h2>
<p>Hi {{member_name}},</p>
<p>We'd love for you to join us:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{event_title}}</strong><br>{{event_date}} at {{event_time}}<br>{{event_description}}</p>
<p><a href="{{portal_url}}/events" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">RSVP Now</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nYou're invited: {{event_title}} on {{event_date}} at {{event_time}}.\n\n{{event_description}}\n\nRSVP at {{portal_url}}/events\n\nThe BTS Team",
    },
  ],
  payment_failed_final: [
    {
      name: "Payment Failed \u2014 Access Ended",
      subject: "Your access to {{product_name}} has ended",
      htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Access Ended</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">

<h2 style="color:#dc2626;margin-top:0;">Access Has Ended</h2>
<p>Hi {{member_name}},</p>
<p>We were unable to process your payment for <strong>{{product_name}}</strong> after multiple attempts, and your access has now ended.</p>
<p>To restore your access, please update your payment information and resubscribe.</p>
<p><a href="{{portal_url}}/settings/billing" style="display:inline-block;background:#dc2626;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Restore Access</a></p>
<p>If you need help or believe this was an error, contact us at {{support_email}}.</p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      textBody: "Hi {{member_name}},\n\nWe were unable to process your payment for {{product_name}} after multiple attempts. Your access has ended.\n\nTo restore access, update your payment info at {{portal_url}}/settings/billing\n\nContact {{support_email}} with questions.\n\nThe BTS Team",
    },
  ],
};

/**
 * The call-booking lifecycle slugs — kickoff/partner × confirmation/
 * reschedule/cancel/reminder. This is the SINGLE source of truth for "which
 * slugs are call-booking lifecycle emails": both `REQUIRED_TEMPLATE_SLUGS`
 * below and `lifecycle-email-token-guard.test.ts` (Task #1717's structural
 * `{{` guard) derive their slug list from this array, so a newly added
 * lifecycle slug automatically requires a guard-test fixture instead of
 * silently shipping unguarded.
 */
export const CALL_BOOKING_LIFECYCLE_SLUGS = [
  "kickoff_call_confirmation",
  "kickoff_call_reschedule",
  "kickoff_call_cancel",
  "kickoff_call_reminder",
  "partner_call_confirmation",
  "partner_call_reschedule",
  "partner_call_cancel",
  "partner_call_reminder",
] as const;

/**
 * Slugs that the seed routine guarantees exist in every deployment. This was
 * previously a curated subset; Task #1714 (branded layout redesign) expanded
 * it to cover EVERY starter slug so the `wrapHtml()` redesign re-skins all
 * ~46 templates on the next boot, not just this curated list. This is safe:
 * `ensureRequiredEmailTemplates` never overwrites a row whose content no
 * longer matches a known starter hash (admin-customized rows), it only
 * refreshes rows still proven to be untouched starter copy.
 */
export const REQUIRED_TEMPLATE_SLUGS = [
  ...new Set([
    "email_change_verify",
    "email_change_notice",
    "email_change_cancelled_by_admin",
    "email_change_cancelled_by_admin_pending",
    "email_change_cancelled_by_member",
    "email_change_cancelled_by_member_pending",
    "signup_attempted",
    "new_device_signin",
    "role_changed",
    "ticket_reply",
    "mentorship_expiring_warning",
    "mentorship_expiring_urgent",
    "mentorship_expired",
    "session_feedback",
    "session_recording_ready",
    "concierge_task_created",
    "compliance_review_created",
    "payment_failed_final",
    ...CALL_BOOKING_LIFECYCLE_SLUGS,
    ...transactionalEmailTemplates.map(t => t.slug),
    ...marketingEmailTemplates.map(t => t.slug),
  ]),
] as const;

/**
 * SMS templates that must always exist in the DB. Unlike email templates there
 * is no content-hash refresh for SMS (the `sms_templates` table has no
 * `starter_hash` column), so `ensureRequiredSmsTemplates` only *inserts* missing
 * rows — it never overwrites an existing row, preserving any admin edits.
 */
export const REQUIRED_SMS_TEMPLATE_SLUGS = [
  "session_recording_ready",
  "kickoff_call_reminder",
  "partner_call_reminder",
  // Morning-of RSVP coaching reminder text (Task #1770) — insert-only, so
  // existing DBs pick it up on boot without clobbering admin edits.
  "coaching_rsvp_reminder",
] as const;

/**
 * Map of slug -> starter copy. Includes both transactional and marketing
 * starter templates so the admin-facing "Restore default" endpoint works for
 * any seeded slug.
 */
const allStarterTemplates: StarterEmailTemplate[] = [
  ...transactionalEmailTemplates,
  ...marketingEmailTemplates,
];
const starterTemplatesBySlug = new Map(allStarterTemplates.map(t => [t.slug, t]));

/** Look up starter copy for a slug, or null if no starter is defined. */
export function getStarterEmailTemplate(slug: string): StarterEmailTemplate | null {
  return starterTemplatesBySlug.get(slug) ?? null;
}

/** Returns the set of starter slugs that have a starter copy on file. */
export function listStarterEmailTemplateSlugs(): string[] {
  return Array.from(starterTemplatesBySlug.keys());
}

/**
 * Returns the set of content hashes the seed routine recognizes as starter
 * copy for the given slug — the current starter plus any prior revisions
 * captured in `priorStarterRevisions`. Used to detect untouched legacy rows
 * whose `starter_hash` column was never populated.
 */
function knownStarterHashesForSlug(slug: string): Set<string> {
  const current = starterTemplatesBySlug.get(slug);
  const hashes = new Set<string>();
  if (current) hashes.add(templateContentHash(current));
  for (const prior of priorStarterRevisions[slug] ?? []) {
    hashes.add(templateContentHash(prior));
  }
  return hashes;
}

async function snapshotTemplateVersion(template: {
  id: number;
  slug: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  category: string;
  fromName: string | null;
  variables: string[] | null;
}, savedBy: number | null): Promise<void> {
  const versions = await db
    .select({ id: emailTemplateVersionsTable.id, version: emailTemplateVersionsTable.version })
    .from(emailTemplateVersionsTable)
    .where(eq(emailTemplateVersionsTable.templateId, template.id))
    .orderBy(desc(emailTemplateVersionsTable.version));
  const nextVersion = versions[0] ? versions[0].version + 1 : 1;
  await db.insert(emailTemplateVersionsTable).values({
    templateId: template.id,
    version: nextVersion,
    slug: template.slug,
    name: template.name,
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    category: template.category,
    fromName: template.fromName,
    variables: template.variables,
    savedBy,
  });
  // Same retention cap as the admin PUT endpoint: keep the most recent 10
  // snapshots and drop the rest.
  if (versions.length >= 10) {
    const toDelete = versions.slice(9).map(v => v.id);
    if (toDelete.length > 0) {
      await db.delete(emailTemplateVersionsTable).where(inArray(emailTemplateVersionsTable.id, toDelete));
    }
  }
}

export async function seedCommunicationTemplates(): Promise<void> {
  console.log("Seeding communication templates...");

  await db.execute(sql`TRUNCATE TABLE email_templates, sms_templates RESTART IDENTITY CASCADE`);

  const allEmailTemplatesWithHash = allStarterTemplates.map(t => ({
    ...t,
    starterHash: templateContentHash(t),
  }));
  await db.insert(emailTemplatesTable).values(allEmailTemplatesWithHash);
  console.log(`  Seeded ${transactionalEmailTemplates.length} transactional + ${marketingEmailTemplates.length} marketing email templates`);

  await db.insert(smsTemplatesTable).values(smsTemplates);
  console.log(`  Seeded ${smsTemplates.length} SMS templates`);

  console.log("Communication templates seeding complete!");
}

/**
 * Run on every API server boot. Guarantees the REQUIRED SMS templates exist.
 * The `sms_templates` table has no `starter_hash` column, so there is no
 * content-refresh path for SMS the way there is for email — this routine only
 * INSERTS rows whose slug is missing and never touches existing rows, so an
 * admin's customized copy is always preserved. New SMS template slugs added to
 * `REQUIRED_SMS_TEMPLATE_SLUGS` therefore reach existing/prod databases on the
 * next boot without a destructive full reseed.
 */
export async function ensureRequiredSmsTemplates(opts?: {
  templates?: ReadonlyArray<(typeof smsTemplates)[number]>;
  requiredSlugs?: ReadonlyArray<string>;
}): Promise<{ inserted: string[] }> {
  const templates = opts?.templates ?? smsTemplates;
  const requiredSlugs = opts?.requiredSlugs ?? REQUIRED_SMS_TEMPLATE_SLUGS;
  const result = { inserted: [] as string[] };

  try {
    const existingRows = await db
      .select({ slug: smsTemplatesTable.slug })
      .from(smsTemplatesTable)
      .where(inArray(smsTemplatesTable.slug, [...requiredSlugs]));
    const existing = new Set(existingRows.map(r => r.slug));

    for (const slug of requiredSlugs) {
      if (existing.has(slug)) continue;
      const starter = templates.find(t => t.slug === slug);
      if (!starter) continue;
      await db.insert(smsTemplatesTable).values(starter);
      result.inserted.push(slug);
    }

    if (result.inserted.length) {
      console.log(`[Seed] ensureRequiredSmsTemplates: inserted=[${result.inserted.join(",")}]`);
    }
  } catch (err) {
    console.error("[Seed] ensureRequiredSmsTemplates failed:", err);
  }
  return result;
}

export interface EnsureRequiredEmailTemplatesResult {
  inserted: string[];
  refreshed: string[];
  backfilled: string[];
  skippedCustomized: string[];
}

/**
 * Run on every API server boot. Guarantees the REQUIRED templates exist and,
 * for rows we can prove are still untouched starter copy, refreshes them to
 * the latest content. Rows that have been customized via the admin UI (i.e.
 * `starter_hash` was cleared by the PUT route) are never overwritten.
 *
 * Pass `templates`/`requiredSlugs` to override the starter set in tests so
 * specs can exercise the refresh logic without clobbering production starter
 * rows.
 */
export async function ensureRequiredEmailTemplates(opts?: {
  templates?: ReadonlyArray<StarterEmailTemplate>;
  requiredSlugs?: ReadonlyArray<string>;
  priorRevisions?: Record<string, StarterContent[]>;
}): Promise<EnsureRequiredEmailTemplatesResult> {
  const templates = opts?.templates ?? allStarterTemplates;
  const requiredSlugs = opts?.requiredSlugs ?? REQUIRED_TEMPLATE_SLUGS;
  const priorRevs = opts?.priorRevisions ?? priorStarterRevisions;
  const result: EnsureRequiredEmailTemplatesResult = {
    inserted: [],
    refreshed: [],
    backfilled: [],
    skippedCustomized: [],
  };

  try {
    const existingRows = await db
      .select()
      .from(emailTemplatesTable)
      .where(inArray(emailTemplatesTable.slug, [...requiredSlugs]));
    const existingBySlug = new Map(existingRows.map(r => [r.slug, r]));

    for (const slug of requiredSlugs) {
      const starter = templates.find(t => t.slug === slug);
      if (!starter) continue;
      const currentHash = templateContentHash(starter);
      const existing = existingBySlug.get(slug);

      if (!existing) {
        await db.insert(emailTemplatesTable).values({
          ...starter,
          starterHash: currentHash,
        });
        result.inserted.push(slug);
        continue;
      }

      // Already up to date.
      if (existing.starterHash === currentHash) continue;

      // Previously seeded by us, starter copy has changed since — refresh.
      if (existing.starterHash !== null) {
        await snapshotTemplateVersion(existing, null);
        await db.update(emailTemplatesTable).set({
          name: starter.name,
          subject: starter.subject,
          htmlBody: starter.htmlBody,
          textBody: starter.textBody,
          category: starter.category,
          variables: starter.variables,
          starterHash: currentHash,
        }).where(eq(emailTemplatesTable.id, existing.id));
        result.refreshed.push(slug);
        continue;
      }

      // starter_hash is NULL — could be a legacy row from before the column
      // existed, or an admin-customized row. Tell them apart by checking
      // whether the row's actual content matches a known starter fingerprint.
      const knownHashes: Set<string> = new Set([
        currentHash,
        ...(priorRevs[slug] ?? []).map(templateContentHash),
      ]);
      const rowHash = templateContentHash(existing);
      if (!knownHashes.has(rowHash)) {
        result.skippedCustomized.push(slug);
        continue;
      }

      // Row content is a known starter version. If it already matches current,
      // just stamp the hash. Otherwise snapshot + update + stamp.
      if (rowHash === currentHash) {
        await db.update(emailTemplatesTable)
          .set({ starterHash: currentHash })
          .where(eq(emailTemplatesTable.id, existing.id));
        result.backfilled.push(slug);
      } else {
        await snapshotTemplateVersion(existing, null);
        await db.update(emailTemplatesTable).set({
          name: starter.name,
          subject: starter.subject,
          htmlBody: starter.htmlBody,
          textBody: starter.textBody,
          category: starter.category,
          variables: starter.variables,
          starterHash: currentHash,
        }).where(eq(emailTemplatesTable.id, existing.id));
        result.refreshed.push(slug);
      }
    }

    if (
      result.inserted.length ||
      result.refreshed.length ||
      result.backfilled.length ||
      result.skippedCustomized.length
    ) {
      console.log(
        `[Seed] ensureRequiredEmailTemplates: ` +
          `inserted=[${result.inserted.join(",")}] ` +
          `refreshed=[${result.refreshed.join(",")}] ` +
          `backfilled=[${result.backfilled.join(",")}] ` +
          `skippedCustomized=[${result.skippedCustomized.join(",")}]`,
      );
    }
  } catch (err) {
    console.error("[Seed] ensureRequiredEmailTemplates failed:", err);
  }
  return result;
}
