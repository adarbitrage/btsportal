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

// Human-readable labels for ticket categories now live in a single shared
// source (`@workspace/support-config`) so the member and admin views can never
// drift apart. Re-exported here so existing member-side imports
// (`@/lib/support-topics`) keep working unchanged.
export { formatTicketCategory } from "@workspace/support-config";

// The two "service request" categories that members file through Concierge and
// Compliance flows rather than the generic support form. They live in the same
// /tickets response as ordinary support tickets, so the portal distinguishes
// them purely with the visual metadata below.
export const SERVICE_CATEGORIES = ["concierge_task", "compliance_review"] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export function isServiceCategory(category: string | null | undefined): category is ServiceCategory {
  return category === "concierge_task" || category === "compliance_review";
}

// Distinct color treatment for the service categories so members can scan their
// Concierge tasks vs Compliance reviews vs ordinary support tickets at a glance.
// `iconName` maps to a lucide icon resolved in the component layer (kept as a
// string here so this module stays presentation-framework agnostic).
export interface TicketCategoryStyle {
  /** Tailwind classes for the inline category badge. */
  badgeClass: string;
  /** lucide-react icon identifier resolved by the rendering component. */
  iconName: "Sparkles" | "ShieldCheck";
}

export const SERVICE_CATEGORY_STYLES: Record<ServiceCategory, TicketCategoryStyle> = {
  concierge_task: {
    badgeClass: "border border-violet-200 bg-violet-50 text-violet-800",
    iconName: "Sparkles",
  },
  compliance_review: {
    badgeClass: "border border-amber-200 bg-amber-50 text-amber-800",
    iconName: "ShieldCheck",
  },
};

export function getServiceCategoryStyle(
  category: string | null | undefined,
): TicketCategoryStyle | undefined {
  if (!isServiceCategory(category)) return undefined;
  return SERVICE_CATEGORY_STYLES[category];
}

// Filter options for the /support list. "all" shows everything; "support"
// collapses every non-service category; the service tabs map 1:1 to a category.
export type TicketFilter = "all" | "support" | ServiceCategory;

export const TICKET_FILTERS: { value: TicketFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "support", label: "Support" },
  { value: "concierge_task", label: "Concierge" },
  { value: "compliance_review", label: "Compliance" },
];

export function ticketMatchesFilter(
  category: string | null | undefined,
  filter: TicketFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "support") return !isServiceCategory(category);
  return category === filter;
}
