// Stable identifier persisted on the ticket so the support team can filter
// these tickets out of the generic "other" bucket and admins can deep-link
// back to the originating record from the Ticket Detail page. Kept as a
// constant on both ends (portal here, server-side default in
// `artifacts/api-server/src/routes/tickets.ts`) so any rename has to happen
// in one place.
export const SOURCE_EMAIL_ADMIN_CANCELLED_BANNER = "email_admin_cancelled_banner";

export interface SupportTopicPreset {
  subject: string;
  messagePrompt: string;
  source: string;
  notice: string;
  badgeLabel: string;
}

export const TOPIC_PRESETS: Record<string, SupportTopicPreset> = {
  "email-admin-cancelled": {
    subject: "Question about cancelled email change",
    messagePrompt:
      "I'm contacting you about a pending email change on my account that was cancelled by an administrator. Please help me understand what happened.\n\n",
    source: SOURCE_EMAIL_ADMIN_CANCELLED_BANNER,
    notice:
      "We've started a request about your recently cancelled email change. Feel free to add any details before sending.",
    badgeLabel: "Cancelled email change",
  },
};

export function getTopicPreset(topic: string | null | undefined): SupportTopicPreset | undefined {
  if (!topic) return undefined;
  return TOPIC_PRESETS[topic];
}

export function getTopicPresetForSubject(subject: string | null | undefined): SupportTopicPreset | undefined {
  if (!subject) return undefined;
  for (const preset of Object.values(TOPIC_PRESETS)) {
    if (preset.subject === subject) return preset;
  }
  return undefined;
}

export function getTopicPresetForSource(source: string | null | undefined): SupportTopicPreset | undefined {
  if (!source) return undefined;
  for (const preset of Object.values(TOPIC_PRESETS)) {
    if (preset.source === source) return preset;
  }
  return undefined;
}
