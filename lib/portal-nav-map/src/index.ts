/**
 * @workspace/portal-nav-map — the single, code-owned, MEMBER-ONLY portal
 * navigation registry.
 *
 * This is the human-verified source for "where do I find X" in the BTS member
 * portal: the live member sidebar as it exists today. It is consumed by:
 *   - the api-server Operations `navigation` seed doc (rendered prose),
 *   - KB truth-doc synthesis (navigation grounding in the drafting prompt),
 *   - answer-time navigation grounding (rag retrieval fetches the seeded doc),
 *   - the portal-side drift guard test, which compares this registry against
 *     the actual member sidebar (`MEMBER_NAV`) in BOTH directions and rejects
 *     any staff route, so the map can never drift from the real sidebar and
 *     staff navigation can never leak into AI-facing documents.
 *
 * KEEP THIS MEMBER-ONLY: never add /admin/, /coach/ or /partner/ routes.
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
      { label: "Accountability Partner", path: "/coaching/partner-calls", description: "Your accountability partner calls — schedule and manage them." },
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
      { label: "Fund Ad Spend", path: "/ad-spend/fund", description: "Add funds to your ad-spend balance." },
      { label: "Become a Coach", path: "/coaching/recruitment", description: "Apply to become a BTS coach." },
    ],
  },
  {
    section: "Account",
    items: [
      { label: "Account", path: "/account", description: "Your account settings, profile, devices/sessions, and notification preferences." },
      { label: "My Products", path: "/account/products", description: "The products / memberships you own." },
      { label: "Payment Methods", path: "/payment-methods", description: "Manage the payment methods on your account." },
    ],
  },
];

/** Flattened (label, path, description) view for search / cross-checks. */
export function flattenNavigationMap(): NavItem[] {
  return PORTAL_NAVIGATION_MAP.flatMap((s) => s.items);
}

/**
 * Member-facing pages that ARE in the nav map but intentionally NOT in the
 * member sidebar (reached from other in-app entry points). The drift guard
 * exempts these from the map→sidebar direction. Keep this list tiny and
 * deliberate — every entry is a page members can genuinely open.
 */
export const NAV_MAP_ONLY_PATHS: readonly string[] = [
  // Support is linked from the help/header entry points rather than the sidebar.
  "/support",
];

/** Route prefixes that are STAFF-ONLY and must never appear in the nav map. */
export const STAFF_ROUTE_PREFIXES = ["/admin", "/coach", "/partner"] as const;

/**
 * True when a path is a staff route (/admin, /coach, /partner or anything
 * nested under them). Careful prefix matching so member routes like
 * "/coaching" and "/partner-tools" do NOT match.
 */
export function isStaffRoutePath(path: string): boolean {
  return STAFF_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

/**
 * Render the nav map as plain prose lines ("Section:" + "- Label (path):
 * description"). Single rendering shared by the seeded Operations navigation
 * doc and the synthesis grounding prompt so the two can never diverge.
 */
export function renderNavigationMapLines(map: readonly NavSection[] = PORTAL_NAVIGATION_MAP): string[] {
  const lines: string[] = [];
  for (const section of map) {
    lines.push(`${section.section}:`);
    for (const item of section.items) {
      lines.push(`- ${item.label} (${item.path}): ${item.description}`);
    }
    lines.push("");
  }
  return lines;
}

// ── Versioning ───────────────────────────────────────────────────────────────

/** Canonical serialization the content hash is computed over. */
export function canonicalNavMapSnapshot(map: readonly NavSection[] = PORTAL_NAVIGATION_MAP): NavItem[] {
  return map.flatMap((s) =>
    s.items.map((i) => ({
      label: i.label,
      path: i.path,
      description: i.description,
      ...(i.entitlement ? { entitlement: i.entitlement } : {}),
    })),
  );
}

/**
 * Stable content hash (FNV-1a, hex) of the nav map. Pure TS (no node:crypto)
 * so it is safe in both browser and server code. Any change to a label, path,
 * description or entitlement changes the version.
 */
export function computeNavMapVersion(map: readonly NavSection[] = PORTAL_NAVIGATION_MAP): string {
  const text = canonicalNavMapSnapshot(map)
    .map((i) => `${i.label}\u0001${i.path}\u0001${i.description}\u0001${i.entitlement ?? ""}`)
    .join("\u0002");
  // 64-bit FNV-1a via two 32-bit passes for a longer, collision-resistant tag.
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return `nav-${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

// ── Diffing (drift-triggered re-review) ──────────────────────────────────────

export interface NavMapChange {
  path: string;
  kind: "removed" | "added" | "renamed" | "description_changed" | "moved";
  oldLabel?: string;
  newLabel?: string;
}

/**
 * Diff two flattened nav-map snapshots (old → new). Keyed by path; a label
 * change on the same path is "renamed", a path disappearing is "removed".
 * A label that moved to a different path shows as removed+added on the paths
 * involved. Used to find which stored truth docs reference a changed location.
 */
export function diffNavMaps(oldItems: readonly NavItem[], newItems: readonly NavItem[]): NavMapChange[] {
  const changes: NavMapChange[] = [];
  const oldByPath = new Map(oldItems.map((i) => [i.path, i]));
  const newByPath = new Map(newItems.map((i) => [i.path, i]));

  for (const [path, oldItem] of oldByPath) {
    const now = newByPath.get(path);
    if (!now) {
      changes.push({ path, kind: "removed", oldLabel: oldItem.label });
    } else if (now.label !== oldItem.label) {
      changes.push({ path, kind: "renamed", oldLabel: oldItem.label, newLabel: now.label });
    } else if (now.description !== oldItem.description) {
      changes.push({ path, kind: "description_changed", oldLabel: oldItem.label, newLabel: now.label });
    }
  }
  for (const [path, newItem] of newByPath) {
    if (!oldByPath.has(path)) changes.push({ path, kind: "added", newLabel: newItem.label });
  }
  return changes;
}

/**
 * The reference tokens (labels + paths) a document must mention for a change
 * to affect it. Additions don't invalidate existing docs — only changes to
 * locations a doc could already reference (removed/renamed/description/moved).
 */
export function changeReferenceTokens(changes: readonly NavMapChange[]): string[] {
  const tokens = new Set<string>();
  for (const c of changes) {
    if (c.kind === "added") continue;
    if (c.oldLabel) tokens.add(c.oldLabel);
    if (c.newLabel) tokens.add(c.newLabel);
    if (c.path && c.path !== "/") tokens.add(c.path);
  }
  return [...tokens];
}
