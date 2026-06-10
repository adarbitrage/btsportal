// Live-chat support destination (TicketDesk) for the portal embed.
//
// The URL can be overridden per-environment via the `VITE_TICKETDESK_URL`
// env var; otherwise it falls back to the shared default in
// `@workspace/support-config`, which the backend health probe also imports —
// so the embed members see and the URL System Health probes can never drift.
// This module is consumed both by the Vite-built portal (where Vite injects
// `import.meta.env`) and by the Playwright e2e suite (plain Node, where the
// same var is read off `process.env`), so neither side repeats the literal.

import { DEFAULT_TICKETDESK_URL } from "@workspace/support-config";

function resolveTicketdeskUrl(): string {
  // Vite replaces `import.meta.env` with the injected env object at build time;
  // in plain Node (e.g. Playwright) it's simply absent.
  const viteEnv = (
    import.meta as unknown as {
      env?: Record<string, string | undefined>;
    }
  ).env;
  const fromVite = viteEnv?.VITE_TICKETDESK_URL;
  if (fromVite) return fromVite;

  if (typeof process !== "undefined" && process.env?.VITE_TICKETDESK_URL) {
    return process.env.VITE_TICKETDESK_URL;
  }

  return DEFAULT_TICKETDESK_URL;
}

export const TICKETDESK_URL = resolveTicketdeskUrl();
