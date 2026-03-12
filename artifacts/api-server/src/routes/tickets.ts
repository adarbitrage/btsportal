import { Router, type IRouter } from "express";
import { db, ticketsTable, ticketMessagesTable, ticketSatisfactionTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { queueGHLSync } from "../lib/ghl-queue";
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

  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      ticketNumber: generateTicketNumber(),
      userId,
      category: parsed.data.category,
      priority: "normal",
      status: "open",
      subject: parsed.data.subject,
    })
    .returning();

  await db.insert(ticketMessagesTable).values({
    ticketId: ticket.id,
    senderType: "member",
    body: parsed.data.description,
  });

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
