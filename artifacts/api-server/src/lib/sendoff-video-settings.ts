// Storage and retrieval for the per-variant onboarding send-off video URLs
// (Task #1666). Each of "full" and "launchpad" gets its own video, stored as
// a plain-string `system_settings` row so it's editable through the EXISTING
// generic admin settings mechanism (GET/PUT /admin/settings/:key +
// AdminSettings.tsx) — no dedicated admin endpoint is needed. Members only
// ever read the resolved URL through GET /members/me/onboarding/send-off,
// never the raw settings row.
import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { SteppedOnboardingVariant } from "./onboarding-steps";

export const SENDOFF_VIDEO_SETTING_KEYS: Record<SteppedOnboardingVariant, string> = {
  full: "sendoff_video_full",
  launchpad: "sendoff_video_launchpad",
};

const CATEGORY = "onboarding" as const;

const DESCRIPTIONS: Record<SteppedOnboardingVariant, string> = {
  full: "Video URL shown on the final send_off step of FULL-tier onboarding.",
  launchpad: "Video URL shown on the final send_off step of LAUNCHPAD-tier onboarding.",
};

export function isSendoffVideoSettingKey(key: string): boolean {
  return key === SENDOFF_VIDEO_SETTING_KEYS.full || key === SENDOFF_VIDEO_SETTING_KEYS.launchpad;
}

/**
 * Idempotent boot seed: inserts an empty-string placeholder row for each
 * variant's send-off video setting if it doesn't already exist, purely so
 * the keys show up in the generic admin Settings UI without an admin having
 * to know the raw key name and use "Add New Setting" manually. Never
 * overwrites an existing row (onConflictDoNothing).
 */
export async function seedSendoffVideoSettings(): Promise<void> {
  for (const [variant, key] of Object.entries(SENDOFF_VIDEO_SETTING_KEYS) as [SteppedOnboardingVariant, string][]) {
    await db
      .insert(systemSettingsTable)
      .values({
        key,
        value: "",
        category: CATEGORY,
        description: DESCRIPTIONS[variant],
      })
      .onConflictDoNothing();
  }
}

// Task #1687: temporary DUMMY — replace with real send-off videos.
//
// The owner needs to preview the send_off step's real iframe player with an
// actual playable video before real send-off videos are uploaded. The 7
// Pillars page's video is a Vidalytics JS-loader embed (VidalyticsEmbed
// component), NOT a plain-iframe-embeddable URL — confirmed by directly
// requesting the Vidalytics embed base URL, which 403s without the loader
// script running client-side. Since the send-off step intentionally keeps
// its plain `<iframe src={videoUrl}>` mechanism (not swapped to the
// Vidalytics loader), that video cannot be used here. Falling back to an
// internal, brand-neutral, already-hosted, iframe-embeddable video: one of
// the portal's own app-overview clips served from its `public/videos`
// directory (same mechanism used by the Apps page's tool preview videos).
//
// This ONLY ever runs outside production (see caller gating in
// bootstrap-critical-prerequisites.ts) and never overwrites a real value
// that's already been set (checks for blank first) — so it can never
// silently ship as final and can never clobber real content.
const DEV_DUMMY_SENDOFF_VIDEO_URL = "/videos/metricmover.mp4";

/**
 * DEV/PREVIEW-ONLY. Idempotent: only fills in the dummy video URL for a
 * variant if that variant's setting is currently blank/unset. Never touches
 * a row that already has a real value. Must never be called when
 * `NODE_ENV === "production"`.
 */
const DUMMY_MARKER_PREFIX = "[DUMMY — replace with real send-off videos] ";

export async function seedDevSendoffDummyVideo(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedDevSendoffDummyVideo must never run in production");
  }
  for (const [variant, key] of Object.entries(SENDOFF_VIDEO_SETTING_KEYS) as [SteppedOnboardingVariant, string][]) {
    const [row] = await db
      .select({ value: systemSettingsTable.value })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, key))
      .limit(1);
    const current = typeof row?.value === "string" ? row.value.trim() : "";
    if (current !== "") continue; // never clobber a real value
    await db
      .update(systemSettingsTable)
      .set({
        value: DEV_DUMMY_SENDOFF_VIDEO_URL,
        description: DUMMY_MARKER_PREFIX + DESCRIPTIONS[variant],
      })
      .where(eq(systemSettingsTable.key, key));
  }
}

/**
 * Resolve the configured send-off video URL for a variant, or `null` if
 * unset/blank. Members should treat `null` as "no video configured yet" and
 * render the rest of the send-off page without a video block.
 */
export async function getSendoffVideoUrl(variant: SteppedOnboardingVariant): Promise<string | null> {
  const key = SENDOFF_VIDEO_SETTING_KEYS[variant];
  const [row] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, key))
    .limit(1);
  if (!row) return null;
  const raw = row.value;
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  return null;
}
