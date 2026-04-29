/**
 * Storage and retrieval for the on-call notification destinations consumed by
 * `queue-fallback-alerter`. Values live in `system_settings` under reserved
 * `oncall.*` keys so they can be edited from the admin UI without restarting
 * the API. Sensitive secrets (PagerDuty integration key, Slack webhook URL)
 * are encrypted at rest with `app-secrets-crypto`; the ops email address is
 * not a secret and is stored as plain JSON.
 *
 * If a row is missing the corresponding `process.env.*` variable is used so
 * existing env-only deploys keep working until an admin saves a value.
 */

import { db, systemSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "./app-secrets-crypto";

export type OnCallField = "pagerdutyIntegrationKey" | "opsAlertEmail" | "opsAlertSlackWebhookUrl";

export interface OnCallDestinations {
  pagerdutyIntegrationKey: string | null;
  opsAlertEmail: string | null;
  opsAlertSlackWebhookUrl: string | null;
}

export interface OnCallDestinationsStatus {
  pagerdutyConfigured: boolean;
  pagerdutySource: "db" | "env" | null;
  opsAlertEmail: string | null;
  opsAlertEmailSource: "db" | "env" | null;
  slackConfigured: boolean;
  slackSource: "db" | "env" | null;
}

const KEYS: Record<OnCallField, string> = {
  pagerdutyIntegrationKey: "oncall.pagerduty_integration_key",
  opsAlertEmail: "oncall.ops_alert_email",
  opsAlertSlackWebhookUrl: "oncall.ops_alert_slack_webhook_url",
};

const ENV_VARS: Record<OnCallField, string> = {
  pagerdutyIntegrationKey: "PAGERDUTY_INTEGRATION_KEY",
  opsAlertEmail: "OPS_ALERT_EMAIL",
  opsAlertSlackWebhookUrl: "OPS_ALERT_SLACK_WEBHOOK_URL",
};

const ENCRYPTED_FIELDS: ReadonlySet<OnCallField> = new Set([
  "pagerdutyIntegrationKey",
  "opsAlertSlackWebhookUrl",
]);

const CATEGORY = "oncall";

export function isOnCallSettingKey(key: string): boolean {
  return Object.values(KEYS).includes(key) || key.startsWith("oncall.");
}

export function getOnCallSettingKeys(): string[] {
  return Object.values(KEYS);
}

interface StoredValue {
  encrypted: boolean;
  data: string | null;
}

function parseStored(raw: unknown): StoredValue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.encrypted !== "boolean") return null;
  const data = obj.data;
  if (data !== null && typeof data !== "string") return null;
  return { encrypted: obj.encrypted, data: data ?? null };
}

function decodeStored(field: OnCallField, raw: unknown): string | null {
  const stored = parseStored(raw);
  if (!stored || stored.data == null || stored.data === "") return null;
  if (stored.encrypted) {
    try {
      return decryptSecret(stored.data);
    } catch (err) {
      console.error(`[OnCallSettings] Failed to decrypt ${field}:`, err);
      return null;
    }
  }
  return stored.data;
}

function encodeForStorage(field: OnCallField, value: string | null): StoredValue {
  if (value == null || value === "") return { encrypted: false, data: null };
  if (ENCRYPTED_FIELDS.has(field)) {
    return { encrypted: true, data: encryptSecret(value) };
  }
  return { encrypted: false, data: value };
}

async function readDbValues(): Promise<Partial<Record<OnCallField, string | null>>> {
  const rows = await db
    .select({ key: systemSettingsTable.key, value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, Object.values(KEYS)));
  const out: Partial<Record<OnCallField, string | null>> = {};
  for (const [field, key] of Object.entries(KEYS) as Array<[OnCallField, string]>) {
    const row = rows.find((r) => r.key === key);
    if (!row) continue;
    out[field] = decodeStored(field, row.value);
  }
  return out;
}

function readEnv(field: OnCallField): string | null {
  const raw = process.env[ENV_VARS[field]];
  if (!raw || raw.trim() === "") return null;
  return raw;
}

/**
 * Read each destination, preferring a value saved via the admin UI and
 * falling back to the matching env var when no row exists. Errors surface as
 * `null` so a single bad row never disables every channel.
 */
export async function getOnCallDestinations(): Promise<OnCallDestinations> {
  let dbValues: Partial<Record<OnCallField, string | null>> = {};
  try {
    dbValues = await readDbValues();
  } catch (err) {
    console.error("[OnCallSettings] Failed to load destinations from DB:", err);
  }
  const fields: OnCallField[] = ["pagerdutyIntegrationKey", "opsAlertEmail", "opsAlertSlackWebhookUrl"];
  const out: Partial<OnCallDestinations> = {};
  for (const field of fields) {
    const dbVal = dbValues[field];
    if (dbVal !== undefined) {
      out[field] = dbVal;
    } else {
      out[field] = readEnv(field);
    }
  }
  return out as OnCallDestinations;
}

/**
 * Same as `getOnCallDestinations`, but also reports whether each value was
 * sourced from the DB or from env so the admin UI can show provenance.
 */
export async function getOnCallDestinationsStatus(): Promise<OnCallDestinationsStatus> {
  let dbValues: Partial<Record<OnCallField, string | null>> = {};
  try {
    dbValues = await readDbValues();
  } catch (err) {
    console.error("[OnCallSettings] Failed to load destinations from DB:", err);
  }
  const sourceFor = (field: OnCallField): { value: string | null; source: "db" | "env" | null } => {
    if (Object.prototype.hasOwnProperty.call(dbValues, field)) {
      const value = dbValues[field] ?? null;
      return { value, source: value == null ? null : "db" };
    }
    const envVal = readEnv(field);
    return { value: envVal, source: envVal == null ? null : "env" };
  };
  const pd = sourceFor("pagerdutyIntegrationKey");
  const email = sourceFor("opsAlertEmail");
  const slack = sourceFor("opsAlertSlackWebhookUrl");
  return {
    pagerdutyConfigured: pd.value != null,
    pagerdutySource: pd.source,
    opsAlertEmail: email.value,
    opsAlertEmailSource: email.source,
    slackConfigured: slack.value != null,
    slackSource: slack.source,
  };
}

/**
 * Upsert a destination. Passing `null` or `""` clears the row so the alerter
 * falls back to env (if configured) or skips the channel entirely.
 */
export async function setOnCallDestination(
  field: OnCallField,
  value: string | null,
  updatedBy: string | null,
): Promise<void> {
  const stored = encodeForStorage(field, value);
  const key = KEYS[field];
  const existing = await db
    .select({ id: systemSettingsTable.id })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, key))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(systemSettingsTable)
      .set({ value: stored, updatedBy: updatedBy ?? undefined })
      .where(eq(systemSettingsTable.key, key));
  } else {
    await db.insert(systemSettingsTable).values({
      key,
      value: stored,
      category: CATEGORY,
      description: `On-call destination: ${field}`,
      updatedBy: updatedBy ?? undefined,
    });
  }
}
