import { Router, type IRouter } from "express";
import { db, ticketsTable, ticketMessagesTable, ticketSatisfactionTable, ticketAttachmentsTable, usersTable, webhookLogsTable } from "@workspace/db";
import { eq, and, desc, gte, sql, asc } from "drizzle-orm";
import { queueGHLSync } from "../lib/ghl-queue";
import { queueTicketDeskDelivery } from "../lib/ticketdesk-queue";
import {
  verifyWebhookSignature as verifyTicketDeskSignature,
  isWebhookConfigured as isTicketDeskWebhookConfigured,
  parseInboundReply as parseTicketDeskReply,
  parseInboundClosure as parseTicketDeskClosure,
  isMemberAuthor as isTicketDeskMemberAuthor,
  signalResolutionToTicketDesk,
} from "../lib/ticketdesk-client";
import { emitWebhookEvent } from "../lib/webhook-events";
import {
  ListTicketsResponse,
  CreateTicketBody,
  GetTicketParams,
  GetTicketResponse,
  AddTicketMessageParams,
  AddTicketMessageBody,
} from "@workspace/api-zod";
import { createSlaForTicket, resumeSla, recordFirstResponse } from "../lib/sla";
import { autoRouteTicket } from "../lib/ticket-routing";
import { getUserEntitlements, getSupportTicketLimit } from "../lib/entitlements";
import { sendError } from "../lib/api-errors";
import { CommunicationService } from "../lib/communication-service";

// Stable namespace for the per-user advisory lock used by POST /tickets so
// concurrent ticket-create requests for the same user are serialized and
// can't both slip past the monthly cap check. Any constant int32 works —
// only collisions with another advisory_xact_lock(NS, userId) caller in this
// codebase would matter, and there are none.
const TICKET_CREATE_LOCK_NAMESPACE = 0x71_43_5e_71;

function startOfCurrentMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// Counts how many tickets the given user has opened since the start of the
// current calendar month (UTC). Used to enforce the per-tier monthly cap on
// POST /tickets so the limit shown in the portal is real, not just a label.
// Accepts either the top-level db or a transaction handle so the count and
// the subsequent insert can run inside the same advisory-locked transaction.
//
// Typed against the minimal surface we use (`select(...).from(...).where(...)`)
// because drizzle's PgTransaction<...> generic is not assignable to the
// concrete NodePgDatabase type and we don't need anything else here.
type DbOrTx = Pick<typeof db, "select">;

async function countUserTicketsThisMonth(
  tx: DbOrTx,
  userId: number,
  now: Date = new Date(),
): Promise<number> {
  const monthStart = startOfCurrentMonthUtc(now);
  const [row] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(ticketsTable)
    .where(and(eq(ticketsTable.userId, userId), gte(ticketsTable.createdAt, monthStart)));
  return row?.value ?? 0;
}

const router: IRouter = Router();

function generateTicketNumber(): string {
  const prefix = "BTS";
  const num = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${num}`;
}

router.get("/tickets", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const status = req.query.status as string | undefined;

  // Sort: active tickets first (open/in_progress/awaiting_response), then
  // resolved/closed, both groups ordered by most-recently-updated first.
  // We use a CASE expression to assign a sort group: active = 0, rest = 1.
  const activeGroup = sql<number>`CASE WHEN ${ticketsTable.status} IN ('open','in_progress','awaiting_response') THEN 0 ELSE 1 END`;

  let tickets;
  if (status) {
    tickets = await db
      .select()
      .from(ticketsTable)
      .where(and(eq(ticketsTable.userId, userId), eq(ticketsTable.status, status)))
      .orderBy(asc(activeGroup), desc(ticketsTable.updatedAt));
  } else {
    tickets = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.userId, userId))
      .orderBy(asc(activeGroup), desc(ticketsTable.updatedAt));
  }

  res.json(ListTicketsResponse.parse(tickets));
});

router.post("/tickets", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const parsed = CreateTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Enforce the per-tier monthly ticket cap server-side. The portal already
  // surfaces this number on the support page (3 / 5 / 10 / unlimited based
  // on the support entitlement) but until now nothing stopped a member from
  // calling POST /tickets directly to bypass it.
  //
  // The check + insert run inside one transaction guarded by a per-user
  // advisory lock so two parallel requests at the cap can't both pass the
  // count check and both insert (which would let a 3-ticket-tier member open
  // a 4th ticket by submitting twice fast). The advisory lock is keyed by
  // (namespace, userId) and released at COMMIT/ROLLBACK, so it serializes
  // ticket-create requests for *the same user* without contending across
  // different members.
  const entitlements = await getUserEntitlements(userId);
  const ticketLimit = getSupportTicketLimit(entitlements);

  type CreateOutcome =
    | { kind: "ok"; ticket: typeof ticketsTable.$inferSelect }
    | { kind: "limit_reached"; limit: number; usedThisMonth: number };

  let outcome: CreateOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<CreateOutcome> => {
      if (ticketLimit > 0) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(${TICKET_CREATE_LOCK_NAMESPACE}::int, ${userId}::int)`,
        );
        const usedThisMonth = await countUserTicketsThisMonth(tx, userId);
        if (usedThisMonth >= ticketLimit) {
          return { kind: "limit_reached", limit: ticketLimit, usedThisMonth };
        }
      }

      const [created] = await tx
        .insert(ticketsTable)
        .values({
          ticketNumber: generateTicketNumber(),
          userId,
          category: parsed.data.category,
          priority: "normal",
          status: "open",
          subject: parsed.data.subject,
          // Persist the originating-surface tag so the support team can
          // filter / prioritise these tickets as a group and the admin
          // Ticket Detail page can deep-link back to the originating record
          // (currently the cancelled email-change attempt). Both fields are
          // optional — generic support form submissions leave them null.
          source: parsed.data.source ?? null,
          sourceReferenceId: parsed.data.sourceReferenceId ?? null,
        })
        .returning();

      await tx.insert(ticketMessagesTable).values({
        ticketId: created.id,
        senderType: "member",
        body: parsed.data.description,
      });

      return { kind: "ok", ticket: created };
    });
  } catch (err) {
    console.error("[Tickets] Failed to create ticket:", err);
    sendError(res, 500, "INTERNAL_ERROR", "Failed to create ticket");
    return;
  }

  if (outcome.kind === "limit_reached") {
    sendError(
      res,
      429,
      "TICKET_LIMIT_REACHED",
      `You've reached your monthly limit of ${outcome.limit} support ticket${outcome.limit === 1 ? "" : "s"}. Upgrade your plan to file more.`,
      { limit: outcome.limit, usedThisMonth: outcome.usedThisMonth },
    );
    return;
  }

  const ticket = outcome.ticket;

  await queueGHLSync({
    action: "add_tags",
    userId,
    tags: ["support_ticket_open"],
  });

  await queueGHLSync({
    action: "add_note",
    userId,
    noteBody: `Support ticket opened: ${parsed.data.subject} (${ticket.ticketNumber}) — Category: ${parsed.data.category}`,
  });

  try {
    await createSlaForTicket(ticket.id, userId);
  } catch (err) {
    console.error("[SLA] Failed to create SLA for ticket:", err);
  }

  try {
    const assignedTo = await autoRouteTicket(ticket.id, userId, parsed.data.category, "normal");
    if (assignedTo) {
      console.log(`[Routing] Ticket ${ticket.ticketNumber} assigned to agent ${assignedTo}`);
    }
  } catch (err) {
    console.error("[Routing] Failed to auto-route ticket:", err);
  }

  const [updatedTicket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticket.id));

  emitWebhookEvent("ticket.created", {
    ticket_id: ticket.id,
    ticket_number: ticket.ticketNumber,
    user_id: userId,
    category: parsed.data.category,
    subject: parsed.data.subject,
  }).catch(() => {});

  // Mirror the new ticket into TicketDesk so the support team sees it in their
  // triage queue. Delivery is non-blocking (async queue with retry) so a
  // TicketDesk outage or missing API key never fails the member's submission.
  //
  // For the Contact Us / General Support form the member may have typed a
  // different name/email in the form body (stored as "From: Name <email>\n\n…"
  // in the description). We always key the TicketDesk contact off the logged-in
  // member's account email so tickets group under the right person.
  (async () => {
    try {
      const [member] = await db
        .select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (member) {
        await queueTicketDeskDelivery({
          contactEmail: member.email,
          contactName: member.name,
          subject: parsed.data.subject,
          body: parsed.data.description,
          btsTicketNumber: ticket.ticketNumber,
          ticketId: ticket.id,
        });
      }
    } catch (err) {
      console.error("[TicketDesk] Failed to queue delivery for ticket", ticket.ticketNumber, err);
    }
  })();

  res.status(201).json(updatedTicket);
});

// Inbound webhook from TicketDesk: mirror a support agent's reply back into
// the member's portal ticket thread so they don't have to check both surfaces.
//
// Mounted under /api/webhooks/* so the raw-body middleware in app.ts captures
// req.rawBody for signature verification and the auth middleware lets it
// through unauthenticated (see middleware/auth.ts PUBLIC bypass for /webhooks/).
//
// Authenticity: when TICKETDESK_WEBHOOK_SECRET is set we require a valid
// X-TicketDesk-Signature (HMAC-SHA256 of the raw body). Missing secret fails
// closed in production (503) but open in dev/test so local testing works.
//
// Matching: the BTS ticket number is stored in the TicketDesk conversation's
// `reference` field on outbound delivery, and echoed back here. We look the
// portal ticket up by that number and append the reply as an "admin" message.
//
// Idempotency: each reply is recorded in webhook_logs keyed by the TicketDesk
// reply id (`ticketdesk_reply_<id>`) so a redelivery never double-posts.
//
// All non-actionable cases (unparseable payload, member-side echo, unknown
// ticket, duplicate) are ACKed with 200 so TicketDesk does not retry forever.
router.post("/webhooks/ticketdesk", async (req, res): Promise<void> => {
  const signature =
    (req.headers["x-ticketdesk-signature"] as string) ||
    (req.headers["x-ticketdesk-signature-256"] as string) ||
    "";
  const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});

  if (!isTicketDeskWebhookConfigured() && process.env.NODE_ENV === "production") {
    console.error(
      "[TicketDesk Webhook] TICKETDESK_WEBHOOK_SECRET not configured — rejecting in production",
    );
    res.status(503).json({ error: "TicketDesk webhook not configured" });
    return;
  }

  if (!verifyTicketDeskSignature(rawBody, signature)) {
    console.error("[TicketDesk Webhook] Invalid signature — rejecting");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = (req.body as Record<string, unknown>) ?? {};

  // --- Step 1: closure-event detection (independent of reply parsing) ------
  // Handles "conversation.resolved", "conversation.closed", etc. — events that
  // may carry no reply body so parseInboundReply returns null, but which still
  // need to mirror the resolution back to the portal ticket.
  const closureTicketNumber = parseTicketDeskClosure(payload);
  if (closureTicketNumber) {
    const closureExternalId = `ticketdesk_closure_${closureTicketNumber}_${Date.now()}`;
    try {
      const [closureTicket] = await db
        .select()
        .from(ticketsTable)
        .where(eq(ticketsTable.ticketNumber, closureTicketNumber))
        .limit(1);

      if (
        closureTicket &&
        closureTicket.status !== "resolved" &&
        closureTicket.status !== "closed"
      ) {
        await db
          .update(ticketsTable)
          .set({ status: "resolved", resolvedAt: new Date() })
          .where(eq(ticketsTable.id, closureTicket.id));

        await db.insert(webhookLogsTable).values({
          externalId: closureExternalId,
          eventType: "ticketdesk.closure",
          status: "processed",
          payload: payload as Record<string, unknown>,
          result: {
            action: "resolved",
            ticketId: closureTicket.id,
            ticketNumber: closureTicket.ticketNumber,
          },
          processedAt: new Date(),
        }).onConflictDoNothing({ target: webhookLogsTable.externalId });

        console.log(
          `[TicketDesk Webhook] Resolved ticket ${closureTicket.ticketNumber} from closure event`,
        );
      }
    } catch (err) {
      console.error(
        `[TicketDesk Webhook] Failed to process closure for ${closureTicketNumber}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // --- Step 2: reply processing (existing logic) ----------------------------
  const parsed = parseTicketDeskReply(payload);

  if (!parsed) {
    // Not a reply (may have been a pure closure event handled above, or
    // an unrecognised event type). ACK so TicketDesk doesn't retry forever.
    res.status(200).json({
      received: true,
      ignored: closureTicketNumber ? "closure_only" : "not_a_reply",
    });
    return;
  }

  // Don't mirror the member's own messages back into their thread — they're
  // already there, and re-posting them would duplicate and could loop.
  if (isTicketDeskMemberAuthor(parsed.authorType)) {
    res.status(200).json({ received: true, ignored: "member_reply" });
    return;
  }

  const externalId = parsed.externalId
    ? `ticketdesk_reply_${parsed.externalId}`
    : null;

  // Atomically claim the dedup key before doing any work. A read-then-write
  // check has a race window: two concurrent redeliveries can both pass the
  // read and both post the reply. Inserting the webhook_logs row up-front with
  // ON CONFLICT DO NOTHING means exactly one delivery wins the unique key; the
  // loser gets an empty `returning` and ACKs as a duplicate. On any downstream
  // failure we release the claim (below) so TicketDesk's retry can reprocess.
  let claimedLogId: number | null = null;

  try {
    if (externalId) {
      const claimed = await db
        .insert(webhookLogsTable)
        .values({
          externalId,
          eventType: parsed.eventType ?? "ticketdesk.reply",
          status: "processing",
          payload: payload as Record<string, unknown>,
          result: {},
        })
        .onConflictDoNothing({ target: webhookLogsTable.externalId })
        .returning({ id: webhookLogsTable.id });

      if (claimed.length === 0) {
        res.status(200).json({ received: true, duplicate: true });
        return;
      }
      claimedLogId = claimed[0].id;
    }

    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.ticketNumber, parsed.btsTicketNumber))
      .limit(1);

    if (!ticket) {
      console.warn(
        `[TicketDesk Webhook] No portal ticket matches reference ${parsed.btsTicketNumber} — ignoring`,
      );
      await finalizeTicketDeskWebhook(
        claimedLogId,
        externalId,
        parsed.eventType,
        req.body,
        {
          action: "ignored",
          reason: "ticket_not_found",
          reference: parsed.btsTicketNumber,
        },
      );
      res.status(200).json({ received: true, ignored: "ticket_not_found" });
      return;
    }

    const [message] = await db
      .insert(ticketMessagesTable)
      .values({
        ticketId: ticket.id,
        senderType: "admin",
        body: parsed.body,
        isInternal: false,
      })
      .returning();

    // Mirror the side-effects of an in-portal admin reply: stamp first-response
    // for SLA and move a brand-new ("open") ticket into "in_progress". A ticket
    // that was paused awaiting the member resumes its SLA clock now that support
    // has responded again.
    // Only advance status if the ticket is still active — it may have already
    // been resolved by the closure-event branch above (Step 1).
    await recordFirstResponse(ticket.id);

    if (ticket.status === "open") {
      await db
        .update(ticketsTable)
        .set({ status: "in_progress" })
        .where(eq(ticketsTable.id, ticket.id));
    } else if (ticket.status === "awaiting_response") {
      await db
        .update(ticketsTable)
        .set({ status: "in_progress" })
        .where(eq(ticketsTable.id, ticket.id));
      try {
        await resumeSla(ticket.id);
      } catch (err) {
        console.error(
          "[TicketDesk Webhook] Failed to resume SLA on inbound reply:",
          err,
        );
      }
    }

    await finalizeTicketDeskWebhook(
      claimedLogId,
      externalId,
      parsed.eventType,
      req.body,
      {
        action: "appended",
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        messageId: message.id,
      },
    );

    // Notify the member by email that support replied, with a deep link back
    // to the ticket thread, so they don't have to be watching the portal to
    // know there's a response. The dedup claim above already guarantees this
    // block runs at most once per unique reply, so there's no risk of a
    // redelivered webhook sending a duplicate email.
    //
    // Best-effort and fully swallowed: a mailer failure must NOT throw out of
    // the handler. If it did, the catch block below would release the dedup
    // claim and return 500, prompting TicketDesk to retry and re-post the
    // reply (a duplicate message) — far worse than a missed notification.
    await sendTicketReplyNotification(ticket);

    console.log(
      `[TicketDesk Webhook] Appended agent reply to ticket ${ticket.ticketNumber} (message ${message.id})`,
    );
    res.status(200).json({ received: true, ticketNumber: ticket.ticketNumber });
  } catch (err) {
    console.error("[TicketDesk Webhook] Processing error:", err);
    // Release the dedup claim so TicketDesk's retry can reprocess this reply
    // instead of being permanently swallowed as a "duplicate".
    if (claimedLogId !== null) {
      try {
        await db
          .delete(webhookLogsTable)
          .where(eq(webhookLogsTable.id, claimedLogId));
      } catch (cleanupErr) {
        console.error(
          "[TicketDesk Webhook] Failed to release dedup claim:",
          cleanupErr,
        );
      }
    }
    res.status(500).json({ error: "Failed to process reply" });
  }
});

// Finalize the webhook_logs row for an inbound TicketDesk reply.
//
// When the reply carried a stable id we already claimed its dedup row up-front
// (status "processing"); here we just mark it "processed" with the outcome. For
// payloads with no id to dedup on (claimedLogId === null) we insert a fresh
// audit row keyed by a random anon id. Best-effort: a logging failure must not
// fail the webhook, since the reply has already been posted.
async function finalizeTicketDeskWebhook(
  claimedLogId: number | null,
  externalId: string | null,
  eventType: string | null,
  payload: unknown,
  result: Record<string, unknown>,
): Promise<void> {
  try {
    if (claimedLogId !== null) {
      await db
        .update(webhookLogsTable)
        .set({ status: "processed", result, processedAt: new Date() })
        .where(eq(webhookLogsTable.id, claimedLogId));
      return;
    }

    await db.insert(webhookLogsTable).values({
      externalId:
        externalId ??
        `ticketdesk_reply_anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      eventType: eventType ?? "ticketdesk.reply",
      status: "processed",
      payload: (payload ?? {}) as Record<string, unknown>,
      result,
      processedAt: new Date(),
    });
  } catch (err) {
    console.error("[TicketDesk Webhook] Failed to record webhook log:", err);
  }
}

// Queue the "support replied" notification email for the member who owns the
// ticket. Looks up the member's current email + name so the deep link and
// greeting are correct, then hands off to CommunicationService.queueEmail
// (which has its own Redis-down direct-send fallback and template/portal-url
// skip handling). Fully best-effort: every failure path is logged and
// swallowed so the inbound webhook handler never throws on a mailer problem.
async function sendTicketReplyNotification(
  ticket: typeof ticketsTable.$inferSelect,
): Promise<void> {
  try {
    if (ticket.userId == null) return;

    const [member] = await db
      .select({
        email: usersTable.email,
        name: usersTable.name,
        phone: usersTable.phone,
        smsOptIn: usersTable.smsOptIn,
        ticketReplySmsOptIn: usersTable.ticketReplySmsOptIn,
      })
      .from(usersTable)
      .where(eq(usersTable.id, ticket.userId))
      .limit(1);

    if (!member) return;

    await CommunicationService.queueEmail({
      templateSlug: "ticket_reply",
      to: member.email,
      userId: ticket.userId,
      variables: {
        member_name: member.name,
        ticket_number: ticket.ticketNumber,
        ticket_id: String(ticket.id),
      },
    });

    // Members who opted into SMS get a short text nudge in addition to the
    // email so they hear about the reply faster. queueSms (via sendSmsDirect)
    // re-checks the master smsOptIn server-side from userId, so that gate is
    // the source of truth even though we pre-check here to avoid queueing a
    // job for a member with no phone on file. The webhook dedup claim
    // guarantees this whole block runs at most once per reply, so a
    // redelivered webhook never sends a duplicate text.
    //
    // ticketReplySmsOptIn is the finer-grained, per-category preference: a
    // member can keep the master SMS opt-in on (so they still get
    // account-security/billing texts) while silencing the text they get on
    // every support reply. Email always sends regardless — this only gates
    // the SMS nudge. There is no server-side re-check of this category flag
    // in queueSms (which is channel-generic), so this caller is the sole
    // enforcement point for the ticket-reply category.
    if (member.smsOptIn && member.ticketReplySmsOptIn && member.phone) {
      await CommunicationService.queueSms({
        templateSlug: "ticket_reply",
        to: member.phone,
        userId: ticket.userId,
        variables: {
          ticket_number: ticket.ticketNumber,
          ticket_id: String(ticket.id),
        },
      });
    }
  } catch (err) {
    console.error(
      `[TicketDesk Webhook] Failed to queue reply notification for ticket ${ticket.ticketNumber}:`,
      err,
    );
  }
}

// Member-initiated ticket resolution.
// POST /tickets/:id/resolve sets the portal ticket to "resolved" and signals
// TicketDesk so both surfaces agree.  It is:
//   - Member-only (enforced by userId ownership check)
//   - Idempotent: no-op when ticket is already resolved/closed
//   - Best-effort TicketDesk notification: a TicketDesk failure never blocks
//     the portal status change
router.post("/tickets/:id/resolve", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const ticketId = parseInt(req.params.id as string);
  if (isNaN(ticketId)) {
    res.status(400).json({ error: "Invalid ticket ID" });
    return;
  }

  const [ticket] = await db
    .select()
    .from(ticketsTable)
    .where(and(eq(ticketsTable.id, ticketId), eq(ticketsTable.userId, userId)));

  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  // Idempotent: already resolved or closed — just return current state
  if (ticket.status === "resolved" || ticket.status === "closed") {
    res.json(ticket);
    return;
  }

  // Update the portal ticket
  const [updated] = await db
    .update(ticketsTable)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(eq(ticketsTable.id, ticketId))
    .returning();

  // Signal TicketDesk best-effort — never block or fail the response
  ;(async () => {
    try {
      const [member] = await db
        .select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (member && ticket.deliveryStatus === "delivered") {
        await signalResolutionToTicketDesk({
          email: member.email,
          btsTicketNumber: ticket.ticketNumber,
          memberName: member.name,
        });
        console.log(
          `[Tickets] Signalled resolution to TicketDesk for ticket ${ticket.ticketNumber}`,
        );
      }
    } catch (err) {
      console.error(
        `[Tickets] Failed to signal resolution to TicketDesk for ticket ${ticket.ticketNumber}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  })();

  res.json(updated);
});

router.get("/tickets/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = GetTicketParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [ticket] = await db
    .select()
    .from(ticketsTable)
    .where(and(eq(ticketsTable.id, params.data.id), eq(ticketsTable.userId, userId)));

  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const messages = await db
    .select()
    .from(ticketMessagesTable)
    .where(and(
      eq(ticketMessagesTable.ticketId, ticket.id),
      eq(ticketMessagesTable.isInternal, false)
    ))
    .orderBy(ticketMessagesTable.createdAt);

  res.json(GetTicketResponse.parse({ ...ticket, messages }));
});

router.post("/tickets/:id/messages", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const params = AddTicketMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = AddTicketMessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [ticket] = await db
    .select()
    .from(ticketsTable)
    .where(and(eq(ticketsTable.id, params.data.id), eq(ticketsTable.userId, userId)));

  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const [message] = await db
    .insert(ticketMessagesTable)
    .values({
      ticketId: ticket.id,
      senderType: "member",
      body: body.data.body,
    })
    .returning();

  if (ticket.status === "awaiting_response") {
    await db.update(ticketsTable)
      .set({ status: "open" })
      .where(eq(ticketsTable.id, ticket.id));
    try {
      await resumeSla(ticket.id);
    } catch (err) {
      console.error("[SLA] Failed to resume SLA on member reply:", err);
    }
  }

  res.status(201).json(message);
});

router.post("/tickets/:id/satisfaction", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const ticketId = parseInt(req.params.id);
  if (isNaN(ticketId)) {
    res.status(400).json({ error: "Invalid ticket ID" });
    return;
  }

  const { rating, feedback } = req.body;
  if (!rating || typeof rating !== "number" || rating < 1 || rating > 5) {
    res.status(400).json({ error: "Rating must be a number between 1 and 5" });
    return;
  }

  const [ticket] = await db
    .select()
    .from(ticketsTable)
    .where(and(eq(ticketsTable.id, ticketId), eq(ticketsTable.userId, userId)));

  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  if (ticket.status !== "resolved" && ticket.status !== "closed") {
    res.status(400).json({ error: "Satisfaction surveys can only be submitted for resolved or closed tickets" });
    return;
  }

  const [existing] = await db
    .select()
    .from(ticketSatisfactionTable)
    .where(eq(ticketSatisfactionTable.ticketId, ticketId));

  if (existing) {
    res.status(409).json({ error: "Satisfaction survey already submitted for this ticket" });
    return;
  }

  const [survey] = await db
    .insert(ticketSatisfactionTable)
    .values({
      ticketId,
      userId,
      rating,
      feedback: feedback || null,
    })
    .returning();

  res.status(201).json(survey);
});

// POST /tickets/concierge
// Accepts structured Concierge™ form data, builds a formatted ticket in the
// `concierge_task` category, and sends the member a confirmation email.
// No monthly ticket cap — these are service requests, not support tickets.
router.post("/tickets/concierge", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const {
    firstName, lastName, email,
    networks, offerName, offerUrl,
    traffic, phase, selectedTasks, selectedSizes, otherInfo,
  } = req.body as Record<string, unknown>;

  if (!firstName || !lastName || !email || !offerName || !offerUrl) {
    res.status(400).json({ error: "Missing required fields: firstName, lastName, email, offerName, offerUrl" });
    return;
  }

  const subject = `Concierge Task — ${String(offerName)}`;

  const lines: string[] = [
    `From: ${String(firstName)} ${String(lastName)} <${String(email)}>`,
    ``,
    `Affiliate Network(s): ${Array.isArray(networks) && networks.length ? networks.join(", ") : "Not specified"}`,
    `Offer Name: ${String(offerName)}`,
    `Offer URL: ${String(offerUrl)}`,
    `Traffic Source(s): ${Array.isArray(traffic) && traffic.length ? traffic.join(", ") : "Not specified"}`,
    `Phase: ${phase ? String(phase) : "Not specified"}`,
    `Selected Task(s): ${Array.isArray(selectedTasks) && selectedTasks.length ? selectedTasks.join("; ") : "None selected"}`,
  ];

  if (Array.isArray(selectedSizes) && selectedSizes.length > 0) {
    lines.push(`Banner Sizes: ${selectedSizes.join(", ")}`);
  }

  if (otherInfo && String(otherInfo).trim()) {
    lines.push(``, `Additional Info:`, String(otherInfo).trim());
  }

  const description = lines.join("\n");

  let ticket: typeof ticketsTable.$inferSelect;
  try {
    const result = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(ticketsTable)
        .values({
          ticketNumber: generateTicketNumber(),
          userId,
          category: "concierge_task",
          priority: "normal",
          status: "open",
          subject,
          source: "concierge_form",
        })
        .returning();

      await tx.insert(ticketMessagesTable).values({
        ticketId: created.id,
        senderType: "member",
        body: description,
      });

      return created;
    });
    ticket = result;
  } catch (err) {
    console.error("[Tickets] Failed to create concierge ticket:", err);
    res.status(500).json({ error: "Failed to submit your request. Please try again." });
    return;
  }

  // SLA + routing — best-effort
  try { await createSlaForTicket(ticket.id, userId); } catch {}
  try { await autoRouteTicket(ticket.id, userId, "concierge_task", "normal"); } catch {}

  // TicketDesk delivery
  ;(async () => {
    try {
      const [member] = await db.select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (member) {
        await queueTicketDeskDelivery({
          contactEmail: member.email,
          contactName: member.name,
          subject,
          body: description,
          btsTicketNumber: ticket.ticketNumber,
          ticketId: ticket.id,
        });
      }
    } catch (err) {
      console.error("[TicketDesk] Failed to queue concierge ticket delivery:", err);
    }
  })();

  // Confirmation email — best-effort
  ;(async () => {
    try {
      const [member] = await db.select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (member) {
        await CommunicationService.queueEmail({
          templateSlug: "concierge_task_created",
          to: member.email,
          userId,
          variables: {
            member_name: member.name,
            ticket_number: ticket.ticketNumber,
            task_subject: String(offerName),
          },
        });
      }
    } catch (err) {
      console.error("[Comms] Failed to send concierge confirmation email:", err);
    }
  })();

  res.status(201).json({ ticketNumber: ticket.ticketNumber, ticketId: ticket.id });
});

// POST /tickets/compliance
// Accepts structured Compliance Review form data (including optional file
// attachments that were uploaded via the presigned-URL flow). Attachment
// metadata is persisted in `ticket_attachments` so admins can open files
// directly from the ticket detail — not just read paths in message text.
router.post("/tickets/compliance", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const {
    firstName, lastName, email,
    offerName, selectedCreatives, selectedTraffic,
    driveLink, shareStatus,
    attachments,
    notes,
  } = req.body as Record<string, unknown>;

  type AttachmentInput = { objectPath: string; fileName?: string; fileSize?: number; contentType?: string };
  const parsedAttachments: AttachmentInput[] = Array.isArray(attachments)
    ? (attachments as AttachmentInput[]).filter(
        (a) => a && typeof a === "object" && typeof a.objectPath === "string",
      )
    : [];

  if (!firstName || !lastName || !email || !offerName) {
    res.status(400).json({ error: "Missing required fields: firstName, lastName, email, offerName" });
    return;
  }

  const subject = `Compliance Review — ${String(offerName)}`;

  const lines: string[] = [
    `From: ${String(firstName)} ${String(lastName)} <${String(email)}>`,
    ``,
    `Offer Name: ${String(offerName)}`,
    `Creative Type(s): ${Array.isArray(selectedCreatives) && selectedCreatives.length ? selectedCreatives.join(", ") : "Not specified"}`,
    `Traffic Source(s): ${Array.isArray(selectedTraffic) && selectedTraffic.length ? selectedTraffic.join(", ") : "Not specified"}`,
  ];

  if (driveLink && String(driveLink).trim()) {
    lines.push(`Google Drive Link: ${String(driveLink).trim()}`);
    if (shareStatus && String(shareStatus).trim()) {
      lines.push(`Drive Access Status: ${String(shareStatus).trim()}`);
    }
  }

  if (parsedAttachments.length > 0) {
    lines.push(``, `Uploaded Files (${parsedAttachments.length}):`);
    parsedAttachments.forEach((a, i) => {
      lines.push(`  ${i + 1}. ${a.fileName ?? a.objectPath}`);
    });
  }

  if (notes && String(notes).trim()) {
    lines.push(``, `Additional Notes:`, String(notes).trim());
  }

  const description = lines.join("\n");

  let ticket: typeof ticketsTable.$inferSelect;
  try {
    const result = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(ticketsTable)
        .values({
          ticketNumber: generateTicketNumber(),
          userId,
          category: "compliance_review",
          priority: "normal",
          status: "open",
          subject,
          source: "compliance_form",
        })
        .returning();

      await tx.insert(ticketMessagesTable).values({
        ticketId: created.id,
        senderType: "member",
        body: description,
      });

      // Persist each uploaded file as a structured attachment row so admins
      // can open files directly from the ticket detail (not just read paths
      // buried in message text).
      if (parsedAttachments.length > 0) {
        await tx.insert(ticketAttachmentsTable).values(
          parsedAttachments.map((a) => ({
            ticketId: created.id,
            objectPath: a.objectPath,
            fileName: a.fileName ?? null,
            fileSize: typeof a.fileSize === "number" ? a.fileSize : null,
            contentType: a.contentType ?? null,
          })),
        );
      }

      return created;
    });
    ticket = result;
  } catch (err) {
    console.error("[Tickets] Failed to create compliance ticket:", err);
    res.status(500).json({ error: "Failed to submit your request. Please try again." });
    return;
  }

  // SLA + routing — best-effort
  try { await createSlaForTicket(ticket.id, userId); } catch {}
  try { await autoRouteTicket(ticket.id, userId, "compliance_review", "normal"); } catch {}

  // TicketDesk delivery
  ;(async () => {
    try {
      const [member] = await db.select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (member) {
        await queueTicketDeskDelivery({
          contactEmail: member.email,
          contactName: member.name,
          subject,
          body: description,
          btsTicketNumber: ticket.ticketNumber,
          ticketId: ticket.id,
        });
      }
    } catch (err) {
      console.error("[TicketDesk] Failed to queue compliance ticket delivery:", err);
    }
  })();

  // Confirmation email — best-effort
  ;(async () => {
    try {
      const [member] = await db.select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (member) {
        await CommunicationService.queueEmail({
          templateSlug: "compliance_review_created",
          to: member.email,
          userId,
          variables: {
            member_name: member.name,
            ticket_number: ticket.ticketNumber,
            task_subject: String(offerName),
          },
        });
      }
    } catch (err) {
      console.error("[Comms] Failed to send compliance confirmation email:", err);
    }
  })();

  res.status(201).json({ ticketNumber: ticket.ticketNumber, ticketId: ticket.id });
});

router.get("/tickets/:id/satisfaction", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const ticketId = parseInt(req.params.id);
  if (isNaN(ticketId)) {
    res.status(400).json({ error: "Invalid ticket ID" });
    return;
  }

  const [ticket] = await db
    .select()
    .from(ticketsTable)
    .where(and(eq(ticketsTable.id, ticketId), eq(ticketsTable.userId, userId)));

  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const [survey] = await db
    .select()
    .from(ticketSatisfactionTable)
    .where(eq(ticketSatisfactionTable.ticketId, ticketId));

  if (!survey) {
    res.json({ submitted: false });
    return;
  }

  res.json({ submitted: true, rating: survey.rating, feedback: survey.feedback, createdAt: survey.createdAt });
});

export default router;
