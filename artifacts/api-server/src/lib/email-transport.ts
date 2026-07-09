/**
 * Outbound transport seam — owns every `sgMail.send` and
 * `twilioClient.messages.create` call in the server.  Nothing else may call
 * those APIs directly (enforced by the transport-seam-guard test).
 *
 * Dev suppression gate
 * ────────────────────
 * In any environment where `NODE_ENV !== "production"`, ALL outgoing email and
 * SMS are suppressed by default.  Two escape hatches let you opt specific
 * addresses back in without flipping to production mode:
 *
 *   DEV_EMAIL_ALLOWLIST   comma-separated addresses; or "*" to pass everything
 *   DEV_SMS_ALLOWLIST     same for SMS phone numbers
 *
 * The wildcard "*" is set in `test-setup.ts` so existing tests that mock
 * `sgMail.send` continue to receive the call through the gate.
 *
 * Suppressed sends are logged: `[DEV-SUPPRESSED] would have sent "<label>" to <to>`.
 *
 * Return value
 * ────────────
 * `gatedSendEmail` returns `[ClientResponse, object]` on a real send (matching
 * the native `sgMail.send` return type) or `{ devSuppressed: true; to: string }`
 * when the gate fires.  Callers that track a `communication_log` row should
 * detect the latter and write `status: "dev_suppressed"` instead of "sent".
 * Alerter callers may ignore the flag — the console log is the only necessary
 * side-effect in dev.
 *
 * `gatedSendSms` returns `{ sid: string }` on a real send or
 * `{ devSuppressed: true; to: string }` when suppressed.
 */

import sgMail from "@sendgrid/mail";
import type { ClientResponse } from "@sendgrid/mail";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface DevSuppressedResult {
  devSuppressed: true;
  to: string;
}

/** Duck-typed subset of a Twilio client used by the SMS gate. */
interface TwilioClientLike {
  messages: {
    create(params: {
      to: string;
      from: string;
      body: string;
      statusCallback?: string;
    }): Promise<{ sid: string }>;
  };
}

// ---------------------------------------------------------------------------
// SendGrid lazy-init (idempotent; no-ops if key is unchanged)
// ---------------------------------------------------------------------------

let sgApiKeySet = false;

function ensureSgApiKey(): void {
  if (sgApiKeySet) return;
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return;
  sgMail.setApiKey(key);
  sgApiKeySet = true;
}

/** Test-only: reset the cached init flag so the next call re-initialises. */
export function __resetSgApiKeyForTests(): void {
  sgApiKeySet = false;
}

// ---------------------------------------------------------------------------
// Gate helpers (exported for unit tests)
// ---------------------------------------------------------------------------

function parseAllowlist(envVar: string): string[] | "*" {
  const raw = (process.env[envVar] ?? "").trim();
  if (!raw) return [];
  if (raw === "*") return "*";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedRecipient(
  recipient: string,
  allowlist: string[] | "*",
): boolean {
  if (allowlist === "*") return true;
  return allowlist.includes(recipient.trim().toLowerCase());
}

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

/** True when this email address should be suppressed in the current env. */
export function isDevEmailSuppressed(to: string): boolean {
  if (isProductionEnv()) return false;
  return !isAllowedRecipient(to, parseAllowlist("DEV_EMAIL_ALLOWLIST"));
}

/** True when this SMS recipient should be suppressed in the current env. */
export function isDevSmsSuppressed(to: string): boolean {
  if (isProductionEnv()) return false;
  return !isAllowedRecipient(to, parseAllowlist("DEV_SMS_ALLOWLIST"));
}

// ---------------------------------------------------------------------------
// Recipient extraction helpers
// ---------------------------------------------------------------------------

function extractEmailRecipient(
  to: sgMail.MailDataRequired["to"],
): string {
  if (typeof to === "string") return to;
  if (Array.isArray(to)) {
    const first = to[0];
    if (!first) return "";
    if (typeof first === "string") return first;
    return (first as { email: string }).email ?? "";
  }
  return (to as { email: string })?.email ?? "";
}

// ---------------------------------------------------------------------------
// Gated send — email
// ---------------------------------------------------------------------------

/**
 * Send an email via SendGrid, subject to the dev suppression gate.
 *
 * Returns the native `[ClientResponse, object]` tuple on a real send, or
 * `{ devSuppressed: true, to }` when the gate fires.
 */
export async function gatedSendEmail(
  msg: sgMail.MailDataRequired,
): Promise<[ClientResponse, object] | DevSuppressedResult> {
  const to = extractEmailRecipient(msg.to);
  if (isDevEmailSuppressed(to)) {
    const label =
      typeof msg.subject === "string" ? msg.subject : "(no subject)";
    console.log(
      `[DEV-SUPPRESSED] would have sent "${label}" to ${to}`,
    );
    return { devSuppressed: true, to };
  }
  ensureSgApiKey();
  return sgMail.send(msg) as Promise<[ClientResponse, object]>;
}

// ---------------------------------------------------------------------------
// Gated send — SMS
// ---------------------------------------------------------------------------

/**
 * Send an SMS via Twilio, subject to the dev suppression gate.
 *
 * Returns `{ sid }` on a real send or `{ devSuppressed: true, to }` when
 * suppressed.  The caller owns the Twilio client instance; passing it here
 * keeps the actual `messages.create` call inside this module (the single
 * seam the regression guard enforces).
 */
export async function gatedSendSms(
  client: TwilioClientLike,
  params: {
    to: string;
    from: string;
    body: string;
    statusCallback?: string;
  },
): Promise<{ sid: string } | DevSuppressedResult> {
  if (isDevSmsSuppressed(params.to)) {
    console.log(`[DEV-SUPPRESSED] would have sent SMS to ${params.to}`);
    return { devSuppressed: true, to: params.to };
  }
  return client.messages.create(params);
}

/** Type-guard: true when the result is a dev-suppressed sentinel. */
export function isDevSuppressedResult(
  result: [ClientResponse, object] | { sid: string } | DevSuppressedResult,
): result is DevSuppressedResult {
  return (
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result) &&
    "devSuppressed" in result &&
    (result as DevSuppressedResult).devSuppressed === true
  );
}
