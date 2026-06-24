// Live-chat support destination (TicketDesk) for the portal.
//
// The URL can be overridden per-environment via the `VITE_TICKETDESK_URL`
// env var; otherwise it falls back to the shared default in
// `@workspace/support-config`, which the backend health probe also imports —
// so the URL members are sent to and the URL System Health probes can never
// drift.
//
// This module is consumed both by the Vite-built portal (where Vite injects
// `import.meta.env`) and by the Playwright e2e suite (plain Node, where the
// same var is read off `process.env`), so neither side repeats the literal.

import { DEFAULT_TICKETDESK_URL, DEFAULT_SUPPORT_PHONE_NUMBER } from "@workspace/support-config";

type ViteEnv = Record<string, string | undefined>;

function getViteEnv(): ViteEnv | undefined {
  return (
    import.meta as unknown as { env?: ViteEnv }
  ).env;
}

function resolveEnvVar(name: string): string | undefined {
  const fromVite = getViteEnv()?.[name];
  if (fromVite) return fromVite;
  if (typeof process !== "undefined") return process.env?.[name];
  return undefined;
}

export const TICKETDESK_URL =
  resolveEnvVar("VITE_TICKETDESK_URL") ?? DEFAULT_TICKETDESK_URL;

/**
 * Customer-facing toll-free number for the AI voice support line.
 *
 * Override via `VITE_SUPPORT_PHONE_NUMBER` (e.g. "+18005551234").
 * When blank the Support Center hides the call option entirely — no empty
 * placeholder is ever shown to members.
 */
export const SUPPORT_PHONE_NUMBER =
  (resolveEnvVar("VITE_SUPPORT_PHONE_NUMBER") ?? DEFAULT_SUPPORT_PHONE_NUMBER).trim();

/**
 * Format a dial-safe phone number string for human-readable display.
 *
 * Accepts E.164 (+18005551234) or plain digits (18005551234 / 8005551234).
 * Returns a formatted string like "1-800-555-1234" for US toll-free numbers,
 * or the original value unchanged for anything that doesn't match the pattern.
 * Keeps formatting logic small and colocated — no external dependency.
 */
export function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const area = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7, 11);
    return `1-${area}-${prefix}-${line}`;
  }
  if (digits.length === 10) {
    const area = digits.slice(0, 3);
    const prefix = digits.slice(3, 6);
    const line = digits.slice(6, 10);
    return `1-${area}-${prefix}-${line}`;
  }
  return raw;
}
