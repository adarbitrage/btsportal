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

import { DEFAULT_TICKETDESK_URL } from "@workspace/support-config";

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
