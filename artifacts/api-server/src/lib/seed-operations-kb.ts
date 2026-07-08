import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { scrubPrivateContent } from "./content-privacy-filter";
import { COACHING_ROSTER, VA_ROSTER, WEEKLY_QA_SCHEDULE } from "./coaching-roster";
import { COACHING_TIMEZONE } from "./ghl-coaching-calendar";
import { PORTAL_NAVIGATION_MAP, renderNavigationMapLines } from "./kb-portal-navigation-map";
import { LEGACY_CROSSWALK } from "./kb-legacy-crosswalk";
import type { Ceiling, HandoffTarget } from "./kb-taxonomy";

/**
 * Operations root content (Task #3, Bucket C — human-verified truth).
 *
 * Authors the irreducible Operations facts the AI assistant must get right:
 * the real coach roster, support routing/escalation, coaching call hours,
 * refunds, membership basics, "how to get help", and the current portal
 * navigation map. Every doc is curated/overview, member-facing, and stamped
 * with a FIXED authored verification date so it is immediately citable
 * ({@link "./kb-citable-filter"}: doc_class citable + last_verified NOT NULL)
 * while the freshness/aging clock stays stable across re-runs.
 *
 * Concept→coaching and troubleshooting→support handoffs are represented via
 * each doc's ceiling + handoff (the destinations live in the `coaching-access`
 * and `support` Operations nodes — see HANDOFF_TARGET_NODES).
 *
 * Reaches production only on boot (prod is a separate DB the agent cannot
 * write). Idempotent: keyed on title, only rewrites rows whose content/taxonomy
 * actually differs, and never resets last_verified on re-run.
 */

// Fixed authored-verification date. Keep stable so the §8.5 aging signal works
// and re-runs never reset the clock. Bump ONLY when the truth is re-verified.
const OPERATIONS_VERIFIED_AT = "2026-06-26T00:00:00.000Z";

interface OperationsDoc {
  title: string;
  slug: string;
  node: string;
  docClass: "curated" | "overview";
  ceiling: Ceiling;
  handoff: HandoffTarget;
  tags: string[];
  content: string;
  sourcePath: string;
  sourceLabel: string;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatHour(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${period}`;
}

// First names only (privacy filter), sorted by their roster sort order.
function rosterFirstNames(): string[] {
  return [...COACHING_ROSTER].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.name);
}

function buildCoachRosterDoc(): OperationsDoc {
  const coaches = rosterFirstNames();
  const last = coaches[coaches.length - 1];
  const coachList = coaches.slice(0, -1).join(", ") + ` and ${last}`;

  const vaOneOnOne = VA_ROSTER.filter((v) => v.doesOneOnOneVaCalls).map((v) => v.name);

  const lines = [
    "BTS Coaching Roster",
    "",
    `BTS coaching is delivered by the BTS coaches: ${coachList}. Each coach runs both the live group Q&A coaching calls and 1-on-1 private coaching sessions, so you can learn from any of them.`,
    "",
    "What each coaching format is for:",
    "- Live group Q&A coaching calls: bring your questions to a scheduled call and get answered live. Find the schedule under Coaching Calls.",
    "- Private 1-on-1 coaching: book a dedicated session with a coach using your session-pack credits, under Private Coaching.",
  ];

  if (vaOneOnOne.length > 0) {
    lines.push(
      `- 1-on-1 VA calls: for hands-on software and technical help, you can book a 1-on-1 call with a VA (${vaOneOnOne.join(", ")}) under 1-on-1 VA Calls. VAs handle technical/setup questions; the coaches handle strategy.`,
    );
  }

  lines.push(
    "",
    "For deeper, account-specific strategy, the next step is always a live coaching call or a 1-on-1 private session with one of the coaches.",
  );

  return {
    title: "BTS Coaching Roster",
    slug: "operations-coach-roster",
    node: "coaching-access",
    docClass: "curated",
    ceiling: "operational",
    handoff: "coaching",
    tags: [],
    content: lines.join("\n"),
    sourcePath: "/coaching",
    sourceLabel: "Coaching",
  };
}

function buildCallHoursDoc(): OperationsDoc {
  // Group the current weekly group-Q&A schedule by weekday, deriving the human
  // text from the roster constant so this can never drift from what's booked.
  const byDay = new Map<number, Array<{ name: string; hour: number }>>();
  for (const slot of WEEKLY_QA_SCHEDULE) {
    const arr = byDay.get(slot.weekday) ?? [];
    arr.push({ name: slot.coachName, hour: slot.hour });
    byDay.set(slot.weekday, arr);
  }

  const scheduleLines: string[] = [];
  for (let d = 0; d < 7; d++) {
    const slots = byDay.get(d);
    if (!slots || slots.length === 0) continue;
    slots.sort((a, b) => a.hour - b.hour);
    const times = slots.map((s) => `${formatHour(s.hour)} with ${s.name}`).join(", ");
    scheduleLines.push(`- ${WEEKDAY_NAMES[d]}: ${times}`);
  }

  const lines = [
    "Coaching Call Hours",
    "",
    "BTS runs live group Q&A coaching calls throughout the week. Calls are scheduled at a mix of morning, afternoon, and evening times so there is a slot that works across time zones.",
    "",
    `Current weekly group Q&A schedule (times shown in the coaching time zone, ${COACHING_TIMEZONE.replace("_", " ")}):`,
    ...scheduleLines,
    "",
    "Always check the Coaching Calls page in the portal for the exact upcoming times — the page shows each call converted to YOUR local time zone and reflects any schedule changes. To join, open Coaching Calls and use the call's join link at the scheduled time.",
    "",
    "Private 1-on-1 coaching is booked on demand (not on this weekly schedule) from the Private Coaching page using your session-pack credits.",
  ];

  return {
    title: "Coaching Call Hours",
    slug: "operations-coaching-call-hours",
    node: "coaching-access",
    docClass: "curated",
    ceiling: "operational",
    handoff: "coaching",
    tags: [],
    content: lines.join("\n"),
    sourcePath: "/coaching",
    sourceLabel: "Coaching Calls",
  };
}

function buildSupportRoutingDoc(): OperationsDoc {
  const lines = [
    "Support Routing & Escalation",
    "",
    "If something isn't working or you need help, here is where to go and in what order:",
    "",
    "1. Support (Help): open the Support page in the portal. This is the front door for technical problems, account questions, and anything that isn't coaching strategy. You can open a support ticket and use live chat there.",
    "2. The AI Assistant (text) or Voice Assistant: for quick how-to and 'where do I find X' questions, the assistant can answer immediately and point you to the right page.",
    "3. BTS Concierge: for done-for-you task requests (work you'd like the BTS team to handle for you), use the Concierge page.",
    "",
    "Escalation: when the AI assistant can't resolve a technical issue or account problem, the next step is to open a support ticket on the Support page so a person can help. Billing, refund, and account-access issues always go through Support.",
    "",
    "Coaching vs. support: questions about marketing strategy, campaigns, and 'what should I do next' belong in coaching (group calls or 1-on-1). Questions about the platform, your account, billing, or something being broken belong in Support.",
  ];

  return {
    title: "Support Routing & Escalation",
    slug: "operations-support-routing",
    node: "support",
    docClass: "curated",
    ceiling: "troubleshooting",
    handoff: "support",
    tags: ["troubleshooting"],
    content: lines.join("\n"),
    sourcePath: "/support",
    sourceLabel: "Support",
  };
}

function buildRefundsDoc(): OperationsDoc {
  const lines = [
    "Refunds — Overview",
    "",
    "Refund and billing questions are handled by the BTS support team, not by coaching. If you have a question about a charge, a refund request, or your billing, open a support ticket on the Support page so the team can look at your specific account.",
    "",
    "The specific refund terms that apply to you are governed by the BTS Mentorship Agreement you accepted when you joined — refer to that agreement and the related refund FAQ articles for the exact policy. For anything account-specific (a particular charge or request), Support is the place to resolve it.",
    "",
    "Note: 'refund' in a media-buying context can also refer to clawbacks on the affiliate side (when a customer refunds a product you promoted) — that is a separate concept from a refund of your BTS membership. If you mean a charge on your BTS account, go to Support.",
  ];

  return {
    title: "Refunds — Overview",
    slug: "operations-refunds-overview",
    node: "billing-and-refunds",
    docClass: "curated",
    ceiling: "operational",
    handoff: "support",
    tags: [],
    content: lines.join("\n"),
    sourcePath: "/support",
    sourceLabel: "Support",
  };
}

function buildMembershipDoc(): OperationsDoc {
  const lines = [
    "Membership Basics",
    "",
    "Your BTS membership gives you access to the training, the BTS software suite, the resource library, live and 1-on-1 coaching, the community, and the AI assistants — based on the products you own.",
    "",
    "Where to manage your membership:",
    "- Account: update your profile, manage your signed-in devices/sessions, and set your notification preferences (Account page).",
    "- My Products: see the products and memberships you currently own (My Products page).",
    "",
    "If a part of the portal is locked or you think you should have access to something you don't, that's an account/entitlement question — open a ticket on the Support page and the team can check your account. Refunds and billing are also handled through Support.",
  ];

  return {
    title: "Membership Basics",
    slug: "operations-membership-basics",
    node: "membership",
    docClass: "curated",
    ceiling: "operational",
    handoff: "support",
    tags: [],
    content: lines.join("\n"),
    sourcePath: "/account",
    sourceLabel: "Account",
  };
}

function buildGettingHelpDoc(): OperationsDoc {
  const lines = [
    "How to Get Help",
    "",
    "Not sure where to go? Use this to route your question to the right place:",
    "",
    "- 'How do I... / where do I find...': ask the AI Assistant (text) or the Voice Assistant — they can answer instantly and link you to the right page.",
    "- 'What should I do with my campaign / strategy questions': bring it to coaching — a live group Q&A coaching call, or a 1-on-1 private coaching session for account-specific strategy.",
    "- 'Something is broken / billing / refund / my account / access': go to Support and open a ticket. Support is the front door for anything technical, billing, or account-related.",
    "- 'I want the BTS team to do a task for me': use BTS Concierge.",
    "",
    "When in doubt, Support can always point you in the right direction.",
  ];

  return {
    title: "How to Get Help",
    slug: "operations-how-to-get-help",
    node: "getting-help",
    docClass: "overview",
    ceiling: "operational",
    handoff: "support",
    tags: [],
    content: lines.join("\n"),
    sourcePath: "/support",
    sourceLabel: "Support",
  };
}

function buildNavigationMapDoc(): OperationsDoc {
  const lines = [
    "BTS Portal Navigation Map — Where to Find Things",
    "",
    "This is the current map of the BTS member portal. Use it to point members at the right page by its current name and location.",
    "",
  ];

  // Single shared rendering (also used by the synthesis navigation-grounding
  // prompt) so the seeded doc and the drafting prompt can never diverge.
  lines.push(...renderNavigationMapLines(PORTAL_NAVIGATION_MAP));

  // Append the legacy → current crosswalk so "I'm looking for <old name>"
  // questions resolve to the current location.
  lines.push("If you've heard an older name, here's what it's called now:");
  for (const entry of LEGACY_CROSSWALK) {
    const suffix =
      entry.confidence === "uncertain"
        ? " (needs human confirmation — do not state as fact)"
        : "";
    lines.push(`- ${entry.legacy.join(" / ")} → ${entry.current}${suffix}`);
  }

  return {
    title: "BTS Portal Navigation Map",
    slug: "operations-portal-navigation-map",
    node: "navigation",
    docClass: "overview",
    ceiling: "operational",
    handoff: "support",
    tags: [],
    content: lines.join("\n"),
    sourcePath: "/",
    sourceLabel: "Portal",
  };
}

export function buildOperationsDocs(): OperationsDoc[] {
  return [
    buildCoachRosterDoc(),
    buildCallHoursDoc(),
    buildSupportRoutingDoc(),
    buildRefundsDoc(),
    buildMembershipDoc(),
    buildGettingHelpDoc(),
    buildNavigationMapDoc(),
  ];
}

export async function seedOperationsKb(): Promise<void> {
  const docs = buildOperationsDocs();
  let upserted = 0;
  let errors = 0;

  for (const doc of docs) {
    const cleanTitle = scrubPrivateContent(doc.title);
    const cleanContent = scrubPrivateContent(doc.content);
    const tagsJson = JSON.stringify(doc.tags);
    try {
      await db.execute(
        sql`INSERT INTO knowledgebase_docs
              (title, category, content, audience, doc_class, slug, home_root, node,
               tags, ceiling, handoff, last_verified, source_path, source_label)
            VALUES
              (${cleanTitle}, 'operations', ${cleanContent}, 'member', ${doc.docClass},
               ${doc.slug}, 'operations', ${doc.node}, ${tagsJson}::jsonb, ${doc.ceiling},
               ${doc.handoff}, ${OPERATIONS_VERIFIED_AT}::timestamptz, ${doc.sourcePath},
               ${doc.sourceLabel})
            ON CONFLICT (title) DO UPDATE SET
              category = EXCLUDED.category,
              content = EXCLUDED.content,
              audience = EXCLUDED.audience,
              doc_class = EXCLUDED.doc_class,
              slug = EXCLUDED.slug,
              home_root = EXCLUDED.home_root,
              node = EXCLUDED.node,
              tags = EXCLUDED.tags,
              ceiling = EXCLUDED.ceiling,
              handoff = EXCLUDED.handoff,
              source_path = EXCLUDED.source_path,
              source_label = EXCLUDED.source_label,
              updated_at = NOW()
            WHERE
              knowledgebase_docs.content IS DISTINCT FROM EXCLUDED.content
              OR knowledgebase_docs.doc_class IS DISTINCT FROM EXCLUDED.doc_class
              OR knowledgebase_docs.home_root IS DISTINCT FROM EXCLUDED.home_root
              OR knowledgebase_docs.node IS DISTINCT FROM EXCLUDED.node
              OR knowledgebase_docs.ceiling IS DISTINCT FROM EXCLUDED.ceiling
              OR knowledgebase_docs.handoff IS DISTINCT FROM EXCLUDED.handoff
              OR knowledgebase_docs.tags IS DISTINCT FROM EXCLUDED.tags
              OR knowledgebase_docs.slug IS DISTINCT FROM EXCLUDED.slug
              OR knowledgebase_docs.source_path IS DISTINCT FROM EXCLUDED.source_path
              OR knowledgebase_docs.source_label IS DISTINCT FROM EXCLUDED.source_label`,
      );
      upserted++;
    } catch (err) {
      errors++;
      console.error(
        `[seed-operations-kb] Error upserting "${doc.title}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `[seed-operations-kb] Done. Processed: ${upserted}, Errors: ${errors}, Total: ${docs.length}`,
  );
}
