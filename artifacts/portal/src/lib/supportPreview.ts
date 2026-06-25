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
// Realism note: the intake message bodies below mirror the EXACT format the
// live POST /tickets/concierge and POST /tickets/compliance routes generate
// (From / Affiliate Network / Offer Name / Offer URL / Traffic Source / Phase /
// Selected Task(s) / Banner Sizes / Google Drive Link / Uploaded Files /
// Additional Info|Notes). The task labels, creative categories, traffic-source
// code names, phases, and network→page / traffic→banner relabeling all match
// the real intake forms (ConciergeSubmit.tsx / ComplianceSubmit.tsx), and the
// offers are real Media Mavens products (in-portal catalog) or real ClickBank
// offers — so the cards read like genuine member submissions.
//
// To remove: delete this file and the small `usePreviewEnabled()` /
// `getPreviewTicketDetail()` / `appendPreviewReply()` call sites in
// Concierge.tsx, ComplianceReview.tsx, and components/support/ConversationModal.tsx.
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

// The member name stamped on the intake "From:" line — these are this account's
// own submissions, so they all read as coming from the preview member.
const PREVIEW_MEMBER_NAME = "Sasha Cherrington";

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

// ── Intake body builders ────────────────────────────────────────────────────
// These reproduce the EXACT line format the live API routes emit so the card's
// summary parser (Selected Task(s) / Uploaded Files) works and the conversation
// modal reads like a real submission.

function conciergeIntake(opts: {
  network: string;
  offer: string;
  offerUrl: string;
  traffic: string;
  phase: string;
  tasks: string[];
  sizes?: string[];
  driveLink?: string;
  driveAccess?: string;
  files?: string[];
  info?: string;
}): string {
  const lines: string[] = [
    `From: ${PREVIEW_MEMBER_NAME} <${PREVIEW_EMAIL}>`,
    ``,
    `Affiliate Network: ${opts.network}`,
    `Offer Name: ${opts.offer}`,
    `Offer URL: ${opts.offerUrl}`,
    `Traffic Source: ${opts.traffic}`,
    `Phase: ${opts.phase}`,
    `Selected Task(s): ${opts.tasks.length ? opts.tasks.join("; ") : "None selected"}`,
  ];
  if (opts.sizes && opts.sizes.length > 0) {
    lines.push(`Banner Sizes: ${opts.sizes.join(", ")}`);
  }
  if (opts.driveLink) {
    lines.push(`Google Drive Link: ${opts.driveLink}`);
    if (opts.driveAccess) lines.push(`Drive Access Status: ${opts.driveAccess}`);
  }
  if (opts.files && opts.files.length > 0) {
    lines.push(``, `Uploaded Files (${opts.files.length}):`);
    opts.files.forEach((f, i) => lines.push(`  ${i + 1}. ${f}`));
  }
  if (opts.info) lines.push(``, `Additional Info:`, opts.info);
  return lines.join("\n");
}

function complianceIntake(opts: {
  offer: string;
  network: string;
  traffic: string;
  creatives: string[];
  driveLink?: string;
  driveAccess?: string;
  files?: string[];
  notes?: string;
}): string {
  const lines: string[] = [
    `From: ${PREVIEW_MEMBER_NAME} <${PREVIEW_EMAIL}>`,
    ``,
    `Offer Name: ${opts.offer}`,
    `Affiliate Network: ${opts.network}`,
    `Traffic Source: ${opts.traffic}`,
    `Creative Categories: ${opts.creatives.length ? opts.creatives.join(", ") : "Not specified"}`,
  ];
  if (opts.driveLink) {
    lines.push(`Google Drive Link: ${opts.driveLink}`);
    if (opts.driveAccess) lines.push(`Drive Access Status: ${opts.driveAccess}`);
  }
  if (opts.files && opts.files.length > 0) {
    lines.push(``, `Uploaded Files (${opts.files.length}):`);
    opts.files.forEach((f, i) => lines.push(`  ${i + 1}. ${f}`));
  }
  if (opts.notes) lines.push(``, `Additional Notes:`, opts.notes);
  return lines.join("\n");
}

// ── Concierge preview tickets ───────────────────────────────────────────────
// Ids -1001..-1008. Current (active) then Past (completed).
const C1: Ticket = listTicket({ id: -1001, ticketNumber: "CNC-2041", category: "concierge_task", status: "in_progress", subject: "Concierge Task — Eye Ease™", createdAt: "2026-06-23T15:10:00.000Z" });
const C2: Ticket = listTicket({ id: -1002, ticketNumber: "CNC-2039", category: "concierge_task", status: "open", subject: "Concierge Task — Sugar Defender", createdAt: "2026-06-22T18:40:00.000Z" });
const C3: Ticket = listTicket({ id: -1003, ticketNumber: "CNC-2036", category: "concierge_task", status: "in_progress", subject: "Concierge Task — Heat Haven™", createdAt: "2026-06-21T13:05:00.000Z" });
const C4: Ticket = listTicket({ id: -1004, ticketNumber: "CNC-2030", category: "concierge_task", status: "in_progress", subject: "Concierge Task — Relivé™", createdAt: "2026-06-20T09:25:00.000Z" });
const C5: Ticket = listTicket({ id: -1005, ticketNumber: "CNC-2028", category: "concierge_task", status: "awaiting_response", subject: "Concierge Task — Java Burn", createdAt: "2026-06-19T16:50:00.000Z" });
const C6: Ticket = listTicket({ id: -1006, ticketNumber: "CNC-1994", category: "concierge_task", status: "resolved", subject: "Concierge Task — Vista Veil™", createdAt: "2026-06-12T14:00:00.000Z" });
const C7: Ticket = listTicket({ id: -1007, ticketNumber: "CNC-1981", category: "concierge_task", status: "closed", subject: "Concierge Task — ProDentim", createdAt: "2026-06-08T11:15:00.000Z" });
const C8: Ticket = listTicket({ id: -1008, ticketNumber: "CNC-1972", category: "concierge_task", status: "resolved", subject: "Concierge Task — Soothe Steps™", createdAt: "2026-06-04T10:30:00.000Z" });

const PREVIEW_CONCIERGE_TICKETS: Ticket[] = [C1, C2, C3, C4, C5, C6, C7, C8];

// ── Compliance preview tickets ──────────────────────────────────────────────
// Ids -2001..-2005. Current (active) then Past (completed). Compliance rows show
// no summary chips, so only conversation content matters.
const K1: Ticket = listTicket({ id: -2001, ticketNumber: "CMP-1183", category: "compliance_review", status: "in_progress", subject: "Compliance Review — Skin Spectra™", createdAt: "2026-06-24T12:20:00.000Z" });
const K2: Ticket = listTicket({ id: -2002, ticketNumber: "CMP-1180", category: "compliance_review", status: "awaiting_response", subject: "Compliance Review — Sugar Defender", createdAt: "2026-06-23T17:35:00.000Z" });
const K3: Ticket = listTicket({ id: -2003, ticketNumber: "CMP-1147", category: "compliance_review", status: "resolved", subject: "Compliance Review — Eye Ease™", createdAt: "2026-06-14T15:45:00.000Z" });
const K4: Ticket = listTicket({ id: -2004, ticketNumber: "CMP-1139", category: "compliance_review", status: "closed", subject: "Compliance Review — Java Burn", createdAt: "2026-06-10T09:10:00.000Z" });
const K5: Ticket = listTicket({ id: -2005, ticketNumber: "CMP-1131", category: "compliance_review", status: "resolved", subject: "Compliance Review — Barkchester United™", createdAt: "2026-06-06T13:55:00.000Z" });

const PREVIEW_COMPLIANCE_TICKETS: Ticket[] = [K1, K2, K3, K4, K5];

// ── Conversation / summary detail for every preview ticket ──────────────────
const PREVIEW_DETAILS: Record<number, TicketWithMessages> = {
  // C1 — In Progress · Media Mavens + Grasshopper, Build phase. 2 task chips +
  // 2 files. Advertorial wording (Media Mavens), Banner wording (Grasshopper),
  // Full Banner task reveals Banner Sizes. Modal: intake + team reply.
  [C1.id]: detail(
    C1,
    [
      msg(-110101, C1.id, "member",
        conciergeIntake({
          network: "MediaMavens",
          offer: "Eye Ease™",
          offerUrl: "https://geteyeease.com/vsl",
          traffic: "Grasshopper",
          phase: '"Build" Phase',
          tasks: [
            "Create Advertorial Hero Shot Images (10 images max)",
            "Create Full Banner (10 Max)",
          ],
          sizes: ["300x250", "970x250"],
          files: ["eye-ease-brand-kit.zip", "hero-reference-shots.zip"],
          info: "Running the digital eye-strain angle for the work-from-home avatar. Brand colors are in the kit — please keep the calm teal/charcoal palette.",
        }),
        "2026-06-23T15:10:00.000Z"),
      msg(-110102, C1.id, "admin",
        "Got the brand kit and reference shots, thanks! We've started on the advertorial hero shots — first drafts by Thursday. The full banner set in 300x250 and 970x250 will follow right after.",
        "2026-06-23T19:42:00.000Z"),
    ],
    [
      att(-1101001, "eye-ease-brand-kit.zip", 4_200_000, -110101, "2026-06-23T15:10:00.000Z"),
      att(-1101002, "hero-reference-shots.zip", 5_800_000, -110101, "2026-06-23T15:10:00.000Z"),
    ],
  ),
  // C2 — Open · ClickBank + Crane, Build phase. 2 task chips, no files. Jump
  // Page wording (ClickBank), DIYTrax campaign setup.
  [C2.id]: detail(
    C2,
    [
      msg(-110201, C2.id, "member",
        conciergeIntake({
          network: "Clickbank",
          offer: "Sugar Defender",
          offerUrl: "https://sugardefender24.com/",
          traffic: "Crane",
          phase: '"Build" Phase',
          tasks: [
            "Create Jump Page Headlines (10 headlines max)",
            "Set Up Initial DIYTrax™ Campaign",
          ],
          info: "Blood-sugar / energy angle. Copy is finalized in Flexy already — I just need the headline variations and the DIYTrax campaign wired up so I can start sending Crane traffic.",
        }),
        "2026-06-22T18:40:00.000Z"),
    ],
    [],
  ),
  // C3 — In Progress · Media Mavens + Crane, Build phase. Split-test task
  // (requires assets → Drive link + zip). 1 file chip via the attachment row.
  [C3.id]: detail(
    C3,
    [
      msg(-110301, C3.id, "member",
        conciergeIntake({
          network: "MediaMavens",
          offer: "Heat Haven™",
          offerUrl: "https://getheathaven.com/",
          traffic: "Crane",
          phase: '"Build" Phase',
          tasks: [
            "Create Advertorial Headlines (10 headlines max)",
            "Create Split Tests With MetricMover™ & Integrate With DIYTrax™ (25 Variations)",
          ],
          driveLink: "https://drive.google.com/drive/folders/heat-haven-assets",
          driveAccess: "Yes, I have shared access",
          files: ["heat-haven-advertorial-export.zip"],
          info: "Recovery / chronic-pain angle. I've shared the current advertorial in the Drive folder — please run the 25 MetricMover variations against the hero shot and the lead headline.",
        }),
        "2026-06-21T13:05:00.000Z"),
      msg(-110302, C3.id, "admin",
        "Access confirmed and the advertorial export came through. We're setting up the 25 split-test variations in MetricMover now and will integrate the winners with your DIYTrax campaign once we have data.",
        "2026-06-21T17:18:00.000Z"),
    ],
    [
      att(-1103001, "heat-haven-advertorial-export.zip", 7_400_000, -110301, "2026-06-21T13:05:00.000Z"),
    ],
  ),
  // C4 — In Progress · Media Mavens + Caterpillar, Test phase. 1 task chip (Test
  // = max 1), Ad wording (Caterpillar), Advertorial wording (Media Mavens). No
  // files (points us at the live campaign).
  [C4.id]: detail(
    C4,
    [
      msg(-110401, C4.id, "member",
        conciergeIntake({
          network: "MediaMavens",
          offer: "Relivé™",
          offerUrl: "https://getrelive.com/",
          traffic: "Caterpillar",
          phase: '"Test" Phase',
          tasks: ["Iterate Off Of Promising Ads (20 new ads max)"],
          driveLink: "https://drive.google.com/drive/folders/relive-caterpillar-winners",
          driveAccess: "Yes, I have shared access",
          info: "Two Caterpillar ads are clearly pulling ahead (the {city} neck-pain hook and the desk-worker hook). Please iterate 20 new variations off those two winners — same angle, fresh imagery and titles.",
        }),
        "2026-06-20T09:25:00.000Z"),
    ],
    [],
  ),
  // C5 — Action Needed (awaiting_response) · ClickBank + Grasshopper, Build
  // phase. Opens the TEXT-ONLY respond modal. 2 task chips + 1 file. Team has
  // asked a question, so the member needs to reply.
  [C5.id]: detail(
    C5,
    [
      msg(-110501, C5.id, "member",
        conciergeIntake({
          network: "Clickbank",
          offer: "Java Burn",
          offerUrl: "https://javaburn.com/",
          traffic: "Grasshopper",
          phase: '"Build" Phase',
          tasks: [
            "Create Jump Page Hero Shot Images (10 images max)",
            "Create Banner Images (10 Max)",
          ],
          files: ["java-burn-offer-brief.pdf"],
          info: "Morning-coffee metabolism angle. Offer brief with the approved claims and brand assets is attached.",
        }),
        "2026-06-19T16:50:00.000Z"),
      msg(-110502, C5.id, "admin",
        "Quick question before we design the banner images: do you want the income/results disclaimer baked into the image itself, or shown as caption text under the banner? Once you confirm we'll get the hero shots and banners rolling.",
        "2026-06-20T14:05:00.000Z"),
    ],
    [att(-1105001, "java-burn-offer-brief.pdf", 320_000, -110501, "2026-06-19T16:50:00.000Z")],
  ),
  // C6 — Completed (resolved) · Media Mavens + Crane, Build phase. Banner set
  // delivered. Modal: MULTIPLE messages + attachments (intake-linked + reply-
  // linked). 1 task chip group + banner sizes.
  [C6.id]: detail(
    C6,
    [
      msg(-110601, C6.id, "member",
        conciergeIntake({
          network: "MediaMavens",
          offer: "Vista Veil™",
          offerUrl: "https://getvistaveil.com/",
          traffic: "Crane",
          phase: '"Build" Phase',
          tasks: [
            "Create Advertorial Hero Shot Images (10 images max)",
            "Create Full Banner (10 Max)",
          ],
          sizes: ["300x250", "970x250", "900x750"],
          files: ["vista-veil-brand-assets.zip"],
          info: "Anti-aging / tired-eyes angle for the 45+ female avatar. Brand assets attached.",
        }),
        "2026-06-12T14:00:00.000Z"),
      msg(-110602, C6.id, "admin",
        "First drafts are ready — see the attached pack with the advertorial hero shots and the full banners in all three sizes. Let us know if you'd like any tweaks to the lead headline.",
        "2026-06-13T16:20:00.000Z"),
      msg(-110603, C6.id, "admin",
        "Final versions delivered and exported in 300x250, 970x250, and 900x750. Marking this complete — good luck with the launch on Crane!",
        "2026-06-15T10:05:00.000Z"),
    ],
    [
      att(-1106001, "vista-veil-brand-assets.zip", 3_100_000, -110601, "2026-06-12T14:00:00.000Z"),
      att(-1106002, "vista-veil-banners-final.zip", 6_800_000, -110603, "2026-06-15T10:05:00.000Z"),
    ],
  ),
  // C7 — Completed (closed) · ClickBank + Crane, Build phase. DIYTrax setup only.
  // Modal: SINGLE message, no files.
  [C7.id]: detail(
    C7,
    [
      msg(-110701, C7.id, "member",
        conciergeIntake({
          network: "Clickbank",
          offer: "ProDentim",
          offerUrl: "https://prodentim.com/",
          traffic: "Crane",
          phase: '"Build" Phase',
          tasks: ["Set Up Initial DIYTrax™ Campaign"],
          info: "Dental-probiotic angle. Jump page is already live in Flexy — I just need the DIYTrax campaign and tracking set up so I can point Crane traffic at it.",
        }),
        "2026-06-08T11:15:00.000Z"),
    ],
    [],
  ),
  // C8 — Completed (resolved) · modal EMPTY fallback (no member-visible messages).
  [C8.id]: detail(C8, [], []),

  // K1 — Under Review (in_progress) · Media Mavens + Grasshopper. Banner
  // creatives. Modal: intake + team reply.
  [K1.id]: detail(
    K1,
    [
      msg(-210101, K1.id, "member",
        complianceIntake({
          offer: "Skin Spectra™",
          network: "Media Mavens",
          traffic: "Grasshopper",
          creatives: ["Banner Images", "Banner Headlines/Descriptions"],
          files: ["skin-spectra-banners-v1.zip"],
          notes: "Submitting my banner set for Skin Spectra before I run it on Grasshopper. Anti-aging angle — let me know if any of the headlines need a qualifier.",
        }),
        "2026-06-24T12:20:00.000Z"),
      msg(-210102, K1.id, "admin",
        "Thanks — we've got your banner set in the queue and are reviewing now. We'll get back to you within 24 hours. Hold off on running it until we confirm.",
        "2026-06-24T14:02:00.000Z"),
    ],
    [att(-2101001, "skin-spectra-banners-v1.zip", 4_250_000, -210101, "2026-06-24T12:20:00.000Z")],
  ),
  // K2 — Action Needed (awaiting_response) · ClickBank + Caterpillar. Opens the
  // TEXT-ONLY respond modal. Ad creatives, team flagged an income claim.
  [K2.id]: detail(
    K2,
    [
      msg(-210201, K2.id, "member",
        complianceIntake({
          offer: "Sugar Defender",
          network: "ClickBank",
          traffic: "Caterpillar",
          creatives: ["Ad Images", "Ad Headlines/Descriptions"],
          files: ["sugar-defender-ads-v1.zip"],
          notes: "Native ad creatives for Sugar Defender, submitting for review before I run them on Caterpillar.",
        }),
        "2026-06-23T17:35:00.000Z"),
      msg(-210202, K2.id, "admin",
        "Almost there — the headline \"Drop your blood sugar 40 points in a week\" is too strong a claim for native. Can you soften it (e.g. lead with the mechanism, not a number) and add a \"results not typical\" qualifier, then reply here so we can re-check? Everything else looks compliant.",
        "2026-06-24T10:48:00.000Z"),
    ],
    [att(-2102001, "sugar-defender-ads-v1.zip", 2_900_000, -210201, "2026-06-23T17:35:00.000Z")],
  ),
  // K3 — Completed (resolved) · Media Mavens + Crane. Advertorial creatives.
  // Modal: MULTIPLE messages + attachments.
  [K3.id]: detail(
    K3,
    [
      msg(-210301, K3.id, "member",
        complianceIntake({
          offer: "Eye Ease™",
          network: "Media Mavens",
          traffic: "Crane",
          creatives: ["Advertorial Hero Shot Images", "Advertorial Headlines"],
          driveLink: "https://drive.google.com/drive/folders/eye-ease-advertorial-review",
          driveAccess: "Yes, I have shared access",
          notes: "Advertorial hero shots and headlines for Eye Ease, submitting for compliance review before launch on Crane.",
        }),
        "2026-06-14T15:45:00.000Z"),
      msg(-210302, K3.id, "admin",
        "Reviewed the advertorial — looks good overall. One note: the hero shot needs the device-results disclaimer added near the testimonial section. Update that and you're clear.",
        "2026-06-15T09:30:00.000Z"),
      msg(-210303, K3.id, "admin",
        "Revised advertorial received and approved. You're clear to run this on Crane. See the approval summary attached.",
        "2026-06-16T11:10:00.000Z"),
    ],
    [
      att(-2103001, "compliance-approval-summary.pdf", 210_000, -210303, "2026-06-16T11:10:00.000Z"),
    ],
  ),
  // K4 — Completed (closed) · ClickBank + Grasshopper. Modal: SINGLE message
  // (approval; member submitted via shared Drive).
  [K4.id]: detail(
    K4,
    [
      msg(-210401, K4.id, "admin",
        "Approved — your Java Burn jump page headlines are compliant and cleared to run on Grasshopper. Keep the income disclaimer visible above the fold for the full duration.",
        "2026-06-11T13:20:00.000Z"),
    ],
    [],
  ),
  // K5 — Completed (resolved) · modal EMPTY fallback.
  [K5.id]: detail(K5, [], []),
};

// ── Preview reply store ─────────────────────────────────────────────────────
// The Action-Needed cards open a TEXT-ONLY reply popup (Option A). Because
// preview tickets are fake (negative ids), there's no API to post to — so a
// reply is appended to this in-memory store and merged into the conversation by
// getPreviewTicketDetail, making the respond flow demo end-to-end. This resets
// on a full page reload (it's intentionally session-only) and is removed along
// with the rest of this file before the real API is wired.
const PREVIEW_REPLIES: Record<number, TicketMessage[]> = {};
let previewReplySeq = -900000;

/** Append a member reply to a preview ticket's conversation (no API call). */
export function appendPreviewReply(ticketId: number, body: string): void {
  const trimmed = body.trim();
  if (!trimmed || !isPreviewTicketId(ticketId)) return;
  const list = PREVIEW_REPLIES[ticketId] ?? (PREVIEW_REPLIES[ticketId] = []);
  list.push(msg(previewReplySeq--, ticketId, "member", trimmed, new Date().toISOString()));
}

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
 * preview rows without any API call. Any replies the member has posted in this
 * session (see appendPreviewReply) are merged in oldest-first, after the
 * original intake + team messages.
 */
export function getPreviewTicketDetail(
  id: number | null | undefined,
): TicketWithMessages | undefined {
  if (id == null) return undefined;
  const base = PREVIEW_DETAILS[id];
  if (!base) return undefined;
  const extra = PREVIEW_REPLIES[id];
  if (!extra || extra.length === 0) return base;
  return { ...base, messages: [...base.messages, ...extra] };
}
