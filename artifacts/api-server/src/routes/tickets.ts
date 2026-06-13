import { Router, type IRouter } from "express";
import { db, ticketsTable, ticketMessagesTable, ticketSatisfactionTable, usersTable } from "@workspace/db";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { queueGHLSync } from "../lib/ghl-queue";
import { queueTicketDeskDelivery } from "../lib/ticketdesk-queue";
import { emitWebhookEvent } from "../lib/webhook-events";
import {
  ListTicketsResponse,
  CreateTicketBody,
  GetTicketParams,
  GetTicketResponse,
  AddTicketMessageParams,
  AddTicketMessageBody,
} from "@workspace/api-zod";
import { createSlaForTicket, resumeSla } from "../lib/sla";
import { autoRouteTicket } from "../lib/ticket-routing";
import { getUserEntitlements, getSupportTicketLimit } from "../lib/entitlements";
import { sendError } from "../lib/api-errors";

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

  let tickets;
  if (status) {
    tickets = await db
      .select()
      .from(ticketsTable)
      .where(and(eq(ticketsTable.userId, userId), eq(ticketsTable.status, status)))
      .orderBy(desc(ticketsTable.createdAt));
  } else {
    tickets = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.userId, userId))
      .orderBy(desc(ticketsTable.createdAt));
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
        });
      }
    } catch (err) {
      console.error("[TicketDesk] Failed to queue delivery for ticket", ticket.ticketNumber, err);
    }
  })();

  res.status(201).json(updatedTicket);
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
