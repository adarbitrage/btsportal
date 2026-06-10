// Single source of truth for the live-chat support destination (TicketDesk).
//
// The URL can be overridden per-environment via the `VITE_TICKETDESK_URL`
// env var; otherwise it falls back to the production support desk. This module
// is consumed both by the Vite-built portal (where Vite injects
// `import.meta.env`) and by the Playwright e2e suite (plain Node, where the
// same var is read off `process.env`), so neither side has to repeat the
// literal and the two can never drift.

const DEFAULT_TICKETDESK_URL = "https://tickets.buildtestscale.com/";

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
