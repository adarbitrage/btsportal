/**
 * Current BTS portal navigation map (Task #3, foundation §8.1).
 *
 * The single human-verified source for "where do I find X" — the live member
 * sidebar as it exists today, walked from the portal's `Sidebar` /
 * `App.tsx` route table. This is the truth the AI assistant must use to point
 * members at the right page (instead of naming a legacy location — see
 * {@link "./kb-legacy-crosswalk"}). The Operations `navigation` doc is rendered
 * from this structure so the prose can never drift from the registry.
 *
 * `entitlement` is informational (some areas are gated); it documents that the
 * area exists, not that every member can open it.
 */

export interface NavItem {
  /** Member-facing label as shown in the sidebar. */
  label: string;
  /** Current route path in the portal. */
  path: string;
  /** What a member does / finds here. */
  description: string;
  /** Entitlement/role note if the area is gated (informational). */
  entitlement?: string;
}

export interface NavSection {
  section: string;
  items: NavItem[];
}

export const PORTAL_NAVIGATION_MAP: readonly NavSection[] = [
  {
    section: "Welcome",
    items: [
      { label: "Welcome", path: "/", description: "Your home dashboard — starting point after sign-in." },
    ],
  },
  {
    section: "Training",
    items: [
      { label: "7 Pillars", path: "/core-training/7-pillars", description: "The foundational 7 Pillars training." },
      { label: "The Blitz", path: "/blitz", description: "The Blitz — the step-by-step affiliate marketing training program and the place your progress is tracked." },
      { label: "Tips & Tricks", path: "/tips-and-tricks", description: "Shorter tips and tactical how-tos." },
    ],
  },
  {
    section: "Tools & Apps",
    items: [
      { label: "Apps", path: "/apps", description: "The BTS software suite: Flexy (landing pages), DIYtrax (tracking), MetricMover (split testing), PixelPress (banners), Gifster (GIFs), ScrapeBot and CropBot (image browser extensions).", entitlement: "software:base" },
      { label: "Tools", path: "/partner-tools", description: "Partner / third-party tools." },
      { label: "AI Assistant", path: "/ai-assistant", description: "The text AI assistant." },
      { label: "Voice Assistant", path: "/assistant/voice", description: "The voice AI assistant.", entitlement: "voice:access" },
      { label: "Compliance Review", path: "/compliance", description: "Submit ad creatives / copy for compliance review.", entitlement: "software:base" },
    ],
  },
  {
    section: "Resources",
    items: [
      { label: "Resource Library", path: "/resource-library", description: "Creative Drive — downloadable ad templates, guides, logos, copy blueprints, the P&L Tracker, and the dedicated email template." },
      { label: "Knowledge Base", path: "/knowledge-base", description: "Browse and search the knowledge base." },
      { label: "Affiliate Networks", path: "/affiliate-networks", description: "Supported affiliate networks (Media Mavens, ClickBank)." },
      { label: "Prime Corporate", path: "/prime-corporate", description: "Prime Corporate Services resources." },
      { label: "Support", path: "/support", description: "Get help — support tickets and live chat." },
    ],
  },
  {
    section: "Coaching",
    items: [
      { label: "Coaching Calls", path: "/coaching", description: "Live group Q&A coaching calls — the schedule and how to join.", entitlement: "coaching:group" },
      { label: "Private Coaching", path: "/coaching/book-session", description: "Book a 1-on-1 private coaching session (session-pack credits)." },
      { label: "BTS Concierge", path: "/concierge", description: "Submit done-for-you / concierge task requests." },
      { label: "1-on-1 VA Calls", path: "/va-calls", description: "Book a 1-on-1 call with a VA for software/technical help.", entitlement: "coaching:group" },
    ],
  },
  {
    section: "Community",
    items: [
      { label: "Community", path: "/community", description: "The member community feed.", entitlement: "community:access" },
    ],
  },
  {
    section: "Earn",
    items: [
      { label: "Promote BTS", path: "/self-promoting", description: "Promote BTS and earn commissions.", entitlement: "commissions" },
      { label: "$1K Ad Credit", path: "/ad-credit", description: "The $1,000 ad-credit offer." },
      { label: "Become a Coach", path: "/coaching/recruitment", description: "Apply to become a BTS coach." },
    ],
  },
  {
    section: "Account",
    items: [
      { label: "Account", path: "/account", description: "Your account settings, profile, devices/sessions, and notification preferences." },
      { label: "My Products", path: "/account/products", description: "The products / memberships you own." },
    ],
  },
];

/** Flattened (label, path, description) view for search / cross-checks. */
export function flattenNavigationMap(): NavItem[] {
  return PORTAL_NAVIGATION_MAP.flatMap((s) => s.items);
}
