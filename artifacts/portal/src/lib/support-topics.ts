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

// Human-readable labels for ticket categories. The raw values are the DB enum
// stored on the ticket (billing, technical, …, concierge_task,
// compliance_review). Most are single words that read fine title-cased, but the
// snake_case service categories (Concierge Task / Compliance Review) must be
// mapped explicitly so the portal never surfaces a raw enum value.
const TICKET_CATEGORY_LABELS: Record<string, string> = {
  billing: "Billing",
  technical: "Technical",
  training: "Training",
  account: "Account",
  other: "Other",
  concierge_task: "Concierge Task",
  compliance_review: "Compliance Review",
};

export function formatTicketCategory(category: string | null | undefined): string {
  if (!category) return "";
  const mapped = TICKET_CATEGORY_LABELS[category];
  if (mapped) return mapped;
  // Fallback for any future/unknown category: turn snake_case into Title Case.
  return category
    .split("_")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}
