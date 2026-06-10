// Live-chat support destination (TicketDesk) for the portal embed.
//
// The URL and widget config can be overridden per-environment via
// `VITE_TICKETDESK_*` env vars; otherwise they fall back to the shared
// defaults in `@workspace/support-config`, which the backend health probe
// also imports — so the embed members see and the URL System Health probes
// can never drift.
//
// This module is consumed both by the Vite-built portal (where Vite injects
// `import.meta.env`) and by the Playwright e2e suite (plain Node, where the
// same vars are read off `process.env`), so neither side repeats the literals.

import {
  DEFAULT_TICKETDESK_URL,
  DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL,
  DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID,
  DEFAULT_TICKETDESK_WIDGET_API_URL,
} from "@workspace/support-config";

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

export const TICKETDESK_WIDGET_SCRIPT_URL =
  resolveEnvVar("VITE_TICKETDESK_WIDGET_SCRIPT_URL") ??
  DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL;

export const TICKETDESK_WIDGET_WORKSPACE_ID =
  resolveEnvVar("VITE_TICKETDESK_WIDGET_WORKSPACE_ID") ??
  DEFAULT_TICKETDESK_WIDGET_WORKSPACE_ID;

export const TICKETDESK_WIDGET_API_URL =
  resolveEnvVar("VITE_TICKETDESK_WIDGET_API_URL") ??
  DEFAULT_TICKETDESK_WIDGET_API_URL;
