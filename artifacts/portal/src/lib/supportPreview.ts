// ──────────────────────────────────────────────────────────────────────────
// TEMPORARY UI PREVIEW DATA — Concierge & Compliance submission cards
//
// This module injects fake, front-end-only submission cards into the Concierge
// (/concierge) and Compliance Review (/compliance) landing pages so the
// submission-card UI can be designed against realistic content BEFORE it is
// wired to the live ticket API.
//
// Scope & safety:
//   • Gated strictly to a single account (PREVIEW_EMAIL). Every other member —
//     and production — sees the real, live view, unchanged.
//   • Purely client-side. Nothing here touches the API or the database, so the
//     fake submissions can never leak into another account.
//   • Preview tickets use NEGATIVE ids so they can never collide with real
//     tickets, and the detail lookups below key off that.
//
// To remove: delete this file and the small `usePreviewEnabled()` /
// `getPreviewTicketDetail()` call sites in Concierge.tsx, ComplianceReview.tsx,
// and components/support/ConversationModal.tsx.
// ──────────────────────────────────────────────────────────────────────────
import { useContext } from "react";
import { AuthContext } from "@/lib/auth";
import type {
  Ticket,
  TicketWithMessages,
  TicketMessage,
  TicketAttachment,
} from "@workspace/api-client-react";

// Only this account sees the preview cards.
export const PREVIEW_EMAIL = "sasha@cherringtonmedia.com";

/**
 * True when the fake preview cards should show: the logged-in user is the
 * designated preview account AND we're not running in a production build. The
 * production guard ensures these temporary mockups can never appear on the live
 * site, even for the preview account.
 */
export function usePreviewEnabled(): boolean {
  // Read the context directly (not useAuth) so this never throws outside an
  // AuthProvider — e.g. in page unit tests that render the page bare.
  const auth = useContext(AuthContext);
  if (import.meta.env.PROD) return false;
  return (auth?.user?.email ?? "").trim().toLowerCase() === PREVIEW_EMAIL;
}

/** Preview ids are negative so they never collide with real ticket ids. */
export function isPreviewTicketId(id: number): boolean {
  return id < 0;
}

// Small builders keep the fixtures below readable and correctly typed.
function listTicket(t: {
  id: number;
  ticketNumber: string;
  category: "concierge_task" | "compliance_review";
  status: "open" | "in_progress" | "awaiting_response" | "resolved" | "closed";
  subject: string;
  createdAt: string;
}): Ticket {
  return {
    id: t.id,
    ticketNumber: t.ticketNumber,
    userId: 0,
    category: t.category,
    priority: "normal",
    status: t.status,
    subject: t.subject,
    assignedTo: null,
    createdAt: t.createdAt,
    updatedAt: t.createdAt,
    resolvedAt:
      t.status === "resolved" || t.status === "closed" ? t.createdAt : null,
  };
}

function msg(
  id: number,
  ticketId: number,
  senderType: "member" | "admin",
  body: string,
  createdAt: string,
): TicketMessage {
  return { id, ticketId, senderType, body, createdAt };
}

function att(
  id: number,
  fileName: string,
  fileSize: number,
  messageId: number | null,
  createdAt: string,
): TicketAttachment {
  return {
    id,
    messageId,
    fileName,
    fileSize,
    contentType: null,
    createdAt,
  };
}

function detail(
  ticket: Ticket,
  messages: TicketMessage[],
  attachments: TicketAttachment[],
): TicketWithMessages {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    userId: ticket.userId,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    subject: ticket.subject,
    source: null,
    sourceReferenceId: null,
    assignedTo: null,
    deliveryStatus: "delivered",
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    resolvedAt: ticket.resolvedAt ?? null,
    messages,
    attachments,
  };
}

// The Concierge intake message is formatted with `Selected Task(s): a; b` and
// `Uploaded Files (N):` lines (see the POST /tickets/concierge route). The
// summary parser on the card reads those lines, so the fixtures reproduce them
// faithfully to drive the task-pill / file-count chips.
function conciergeIntake(opts: {
  offer: string;
  tasks: string[];
  fileCount: number;
  extra?: string;
}): string {
  const lines = [
    `Offer: ${opts.offer}`,
    `Selected Task(s): ${opts.tasks.length ? opts.tasks.join("; ") : "None selected"}`,
  ];
  if (opts.extra) lines.push("", opts.extra);
  if (opts.fileCount > 0) lines.push("", `Uploaded Files (${opts.fileCount}):`);
  return lines.join("\n");
}

// ── Concierge preview tickets ───────────────────────────────────────────────
// Ids -1001..-1008. Current (active) then Past (completed).
const C1: Ticket = listTicket({ id: -1001, ticketNumber: "CNC-2041", category: "concierge_task", status: "in_progress", subject: "Concierge Task — Keto Shred Pro", createdAt: "2026-06-23T15:10:00.000Z" });
const C2: Ticket = listTicket({ id: -1002, ticketNumber: "CNC-2039", category: "concierge_task", status: "open", subject: "Concierge Task — AI Profit Engine", createdAt: "2026-06-22T18:40:00.000Z" });
const C3: Ticket = listTicket({ id: -1003, ticketNumber: "CNC-2036", category: "concierge_task", status: "in_progress", subject: "Concierge Task — Lean Greens Daily", createdAt: "2026-06-21T13:05:00.000Z" });
const C4: Ticket = listTicket({ id: -1004, ticketNumber: "CNC-2030", category: "concierge_task", status: "in_progress", subject: "Concierge Task — Solar Saver Funnel", createdAt: "2026-06-20T09:25:00.000Z" });
const C5: Ticket = listTicket({ id: -1005, ticketNumber: "CNC-2028", category: "concierge_task", status: "awaiting_response", subject: "Concierge Task — Crypto Wealth Blueprint", createdAt: "2026-06-19T16:50:00.000Z" });
const C6: Ticket = listTicket({ id: -1006, ticketNumber: "CNC-1994", category: "concierge_task", status: "resolved", subject: "Concierge Task — Macro Meal Plans", createdAt: "2026-06-12T14:00:00.000Z" });
const C7: Ticket = listTicket({ id: -1007, ticketNumber: "CNC-1981", category: "concierge_task", status: "closed", subject: "Concierge Task — Fit After Forty", createdAt: "2026-06-08T11:15:00.000Z" });
const C8: Ticket = listTicket({ id: -1008, ticketNumber: "CNC-1972", category: "concierge_task", status: "resolved", subject: "Concierge Task — Budget Bootcamp", createdAt: "2026-06-04T10:30:00.000Z" });

const PREVIEW_CONCIERGE_TICKETS: Ticket[] = [C1, C2, C3, C4, C5, C6, C7, C8];

// ── Compliance preview tickets ──────────────────────────────────────────────
// Ids -2001..-2005. Current (active) then Past (completed). Compliance rows show
// no summary chips, so only conversation content matters.
const K1: Ticket = listTicket({ id: -2001, ticketNumber: "CMP-1183", category: "compliance_review", status: "in_progress", subject: "Compliance Review — Keto Shred Pro (Facebook Creative)", createdAt: "2026-06-24T12:20:00.000Z" });
const K2: Ticket = listTicket({ id: -2002, ticketNumber: "CMP-1180", category: "compliance_review", status: "awaiting_response", subject: "Compliance Review — AI Profit Engine (Native Ad)", createdAt: "2026-06-23T17:35:00.000Z" });
const K3: Ticket = listTicket({ id: -2003, ticketNumber: "CMP-1147", category: "compliance_review", status: "resolved", subject: "Compliance Review — Lean Greens (TikTok Video)", createdAt: "2026-06-14T15:45:00.000Z" });
const K4: Ticket = listTicket({ id: -2004, ticketNumber: "CMP-1139", category: "compliance_review", status: "closed", subject: "Compliance Review — Solar Saver (YouTube Pre-roll)", createdAt: "2026-06-10T09:10:00.000Z" });
const K5: Ticket = listTicket({ id: -2005, ticketNumber: "CMP-1131", category: "compliance_review", status: "resolved", subject: "Compliance Review — Crypto Blueprint (Display Banner)", createdAt: "2026-06-06T13:55:00.000Z" });

const PREVIEW_COMPLIANCE_TICKETS: Ticket[] = [K1, K2, K3, K4, K5];

// ── Conversation / summary detail for every preview ticket ──────────────────
const PREVIEW_DETAILS: Record<number, TicketWithMessages> = {
  // C1 — In Progress · 2 task chips + 2 files. Modal: intake + team reply.
  [C1.id]: detail(
    C1,
    [
      msg(-110101, C1.id, "member",
        conciergeIntake({ offer: "Keto Shred Pro", tasks: ["Banner Ad Set (5 sizes)", "Tracking Link Setup"], fileCount: 2, extra: "Brand colors are in the style guide PDF. Please match the green/charcoal palette." }),
        "2026-06-23T15:10:00.000Z"),
      msg(-110102, C1.id, "admin",
        "Got everything, thanks! We've started on the banner set — first drafts are coming your way by Thursday. We'll set up the tracking links once the creatives are approved.",
        "2026-06-23T19:42:00.000Z"),
    ],
    [
      att(-1101001, "keto-shred-style-guide.pdf", 845_000, null, "2026-06-23T15:10:00.000Z"),
      att(-1101002, "product-shots.zip", 5_200_000, null, "2026-06-23T15:10:00.000Z"),
    ],
  ),
  // C2 — In Progress · task chip only (no files).
  [C2.id]: detail(
    C2,
    [
      msg(-110201, C2.id, "member",
        conciergeIntake({ offer: "AI Profit Engine", tasks: ["Landing Page Build"], fileCount: 0, extra: "Copy is final — just need it built on the standard template with the opt-in above the fold." }),
        "2026-06-22T18:40:00.000Z"),
    ],
    [],
  ),
  // C3 — In Progress · file chip only (no tasks).
  [C3.id]: detail(
    C3,
    [
      msg(-110301, C3.id, "member",
        conciergeIntake({ offer: "Lean Greens Daily", tasks: [], fileCount: 3, extra: "Uploading the raw creative assets — please advise on the best ad format for these." }),
        "2026-06-21T13:05:00.000Z"),
    ],
    [
      att(-1103001, "lean-greens-hero.png", 1_400_000, null, "2026-06-21T13:05:00.000Z"),
      att(-1103002, "lean-greens-lifestyle.jpg", 980_000, null, "2026-06-21T13:05:00.000Z"),
      att(-1103003, "lean-greens-logo.svg", 42_000, null, "2026-06-21T13:05:00.000Z"),
    ],
  ),
  // C4 — In Progress · NO chips (no tasks, no files) → minimal row.
  [C4.id]: detail(
    C4,
    [
      msg(-110401, C4.id, "member",
        conciergeIntake({ offer: "Solar Saver Funnel", tasks: [], fileCount: 0, extra: "Can you audit my current funnel and recommend what to fix first? Link is in my profile." }),
        "2026-06-20T09:25:00.000Z"),
    ],
    [],
  ),
  // C5 — Action Needed · chips (1 task + 1 file). Links to ticket page (no modal),
  // but the summary parser still reads this for the chips.
  [C5.id]: detail(
    C5,
    [
      msg(-110501, C5.id, "member",
        conciergeIntake({ offer: "Crypto Wealth Blueprint", tasks: ["Ad Creative Design"], fileCount: 1, extra: "Here's the offer brief for the creative." }),
        "2026-06-19T16:50:00.000Z"),
      msg(-110502, C5.id, "admin",
        "Quick question before we start: do you want the disclaimer baked into the image, or shown as caption text? Let us know and we'll get rolling.",
        "2026-06-20T14:05:00.000Z"),
    ],
    [att(-1105001, "crypto-offer-brief.pdf", 320_000, null, "2026-06-19T16:50:00.000Z")],
  ),
  // C6 — Completed · modal with MULTIPLE messages + attachments (linked + unlinked).
  [C6.id]: detail(
    C6,
    [
      msg(-110601, C6.id, "member",
        conciergeIntake({ offer: "Macro Meal Plans", tasks: ["Banner Ad Set (5 sizes)"], fileCount: 1, extra: "Brand assets attached." }),
        "2026-06-12T14:00:00.000Z"),
      msg(-110602, C6.id, "admin",
        "First drafts are ready — see the attached pack. Let us know if you'd like any tweaks to the headline.",
        "2026-06-13T16:20:00.000Z"),
      msg(-110603, C6.id, "admin",
        "Final versions delivered and exported in all five sizes. Marking this complete — enjoy the launch!",
        "2026-06-15T10:05:00.000Z"),
    ],
    [
      att(-1106001, "macro-meal-brand-assets.zip", 3_100_000, -110601, "2026-06-12T14:00:00.000Z"),
      att(-1106002, "macro-meal-banners-final.zip", 6_800_000, -110603, "2026-06-15T10:05:00.000Z"),
    ],
  ),
  // C7 — Completed · modal with a SINGLE message.
  [C7.id]: detail(
    C7,
    [
      msg(-110701, C7.id, "member",
        conciergeIntake({ offer: "Fit After Forty", tasks: ["Tracking Link Setup"], fileCount: 0, extra: "Just need the tracking links wired up for the new offer." }),
        "2026-06-08T11:15:00.000Z"),
    ],
    [],
  ),
  // C8 — Completed · modal EMPTY fallback (no member-visible messages).
  [C8.id]: detail(C8, [], []),

  // K1 — Under Review · modal with intake + team reply.
  [K1.id]: detail(
    K1,
    [
      msg(-210101, K1.id, "member",
        "Submitting this Facebook creative for Keto Shred Pro before I run it. Traffic source: Facebook. Let me know if anything needs to change.",
        "2026-06-24T12:20:00.000Z"),
      msg(-210102, K1.id, "admin",
        "Thanks — we've got it in the queue and are reviewing now. We'll get back to you within 24 hours.",
        "2026-06-24T14:02:00.000Z"),
    ],
    [att(-2101001, "keto-fb-creative-v1.png", 1_250_000, null, "2026-06-24T12:20:00.000Z")],
  ),
  // K2 — Action Needed · links to ticket page (no modal). Detail kept for completeness.
  [K2.id]: detail(
    K2,
    [
      msg(-210201, K2.id, "member",
        "Native ad creative for AI Profit Engine, submitting for review before I run on the native networks.",
        "2026-06-23T17:35:00.000Z"),
      msg(-210202, K2.id, "admin",
        "Almost there — the income claim in the headline needs a qualifier. Can you revise to 'results not typical' and re-upload? Reply here once updated.",
        "2026-06-24T10:48:00.000Z"),
    ],
    [att(-2102001, "ai-profit-native-v1.jpg", 720_000, null, "2026-06-23T17:35:00.000Z")],
  ),
  // K3 — Completed · modal MULTIPLE messages + attachments.
  [K3.id]: detail(
    K3,
    [
      msg(-210301, K3.id, "member",
        "TikTok video creative for Lean Greens, submitting for compliance review before launch.",
        "2026-06-14T15:45:00.000Z"),
      msg(-210302, K3.id, "admin",
        "Reviewed — looks good overall. One note: add the supplement disclaimer to the final frame.",
        "2026-06-15T09:30:00.000Z"),
      msg(-210303, K3.id, "admin",
        "Revised version received and approved. You're clear to run this. See the approval summary attached.",
        "2026-06-16T11:10:00.000Z"),
    ],
    [
      att(-2103001, "lean-greens-tiktok-v1.mp4", 18_400_000, -210301, "2026-06-14T15:45:00.000Z"),
      att(-2103002, "compliance-approval-summary.pdf", 210_000, -210303, "2026-06-16T11:10:00.000Z"),
    ],
  ),
  // K4 — Completed · modal SINGLE message.
  [K4.id]: detail(
    K4,
    [
      msg(-210401, K4.id, "admin",
        "Approved — your YouTube pre-roll for Solar Saver is compliant and cleared to run. Keep the on-screen disclaimer for the full duration.",
        "2026-06-11T13:20:00.000Z"),
    ],
    [],
  ),
  // K5 — Completed · modal EMPTY fallback.
  [K5.id]: detail(K5, [], []),
};

/** Preview tickets for the Concierge list (only render when preview enabled). */
export function getPreviewConciergeTickets(): Ticket[] {
  return PREVIEW_CONCIERGE_TICKETS;
}

/** Preview tickets for the Compliance list (only render when preview enabled). */
export function getPreviewComplianceTickets(): Ticket[] {
  return PREVIEW_COMPLIANCE_TICKETS;
}

/**
 * Full conversation/summary detail for a preview ticket id, or undefined for a
 * real ticket. The summary chips and the conversation modal use this to render
 * preview rows without any API call.
 */
export function getPreviewTicketDetail(
  id: number | null | undefined,
): TicketWithMessages | undefined {
  if (id == null) return undefined;
  return PREVIEW_DETAILS[id];
}
