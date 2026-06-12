import { getParam } from "../lib/params";
import { Router, type Request, type Response } from "express";
import {
  db,
  ticketsTable,
  ticketMessagesTable,
  ticketSlaTable,
  cannedResponsesTable,
  ticketRoutingRulesTable,
  ticketSatisfactionTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql, ilike, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { recordFirstResponse, pauseSla, resumeSla, calculateBusinessMinutesFast } from "../lib/sla";
import { emitWebhookEvent } from "../lib/webhook-events";
import { requirePermission } from "../middleware/rbac";

const router = Router();


router.get("/admin/canned-responses", requirePermission("tickets:view"), async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;

    const conditions = [];
    if (category) conditions.push(eq(cannedResponsesTable.category, category));
    if (search) conditions.push(ilike(cannedResponsesTable.title, `%${search}%`));

    let responses;
    if (conditions.length > 0) {
      responses = await db.select().from(cannedResponsesTable)
        .where(and(...conditions))
        .orderBy(asc(cannedResponsesTable.sortOrder));
    } else {
      responses = await db.select().from(cannedResponsesTable)
        .orderBy(asc(cannedResponsesTable.sortOrder));
    }

    res.json(responses);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch canned responses" });
  }
});

router.post("/admin/canned-responses", requirePermission("tickets:manage"), async (req: Request, res: Response) => {
  try {
    const { title, category, body, sortOrder } = req.body;
    if (!title || !body) {
      res.status(400).json({ error: "Title and body are required" });
      return;
    }

    const [response] = await db.insert(cannedResponsesTable).values({
      title,
      category: category || "general",
      body,
      sortOrder: sortOrder || 0,
    }).returning();

    res.status(201).json(response);
  } catch (error) {
    res.status(500).json({ error: "Failed to create canned response" });
  }
});

router.put("/admin/canned-responses/:id", requirePermission("tickets:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const { title, category, body, sortOrder } = req.body;
    const updates: Record<string, any> = {};
    if (title !== undefined) updates.title = title;
    if (category !== undefined) updates.category = category;
    if (body !== undefined) updates.body = body;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;

    const [updated] = await db.update(cannedResponsesTable)
      .set(updates)
      .where(eq(cannedResponsesTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Canned response not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Failed to update canned response" });
  }
});

router.delete("/admin/canned-responses/:id", requirePermission("tickets:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const [deleted] = await db.delete(cannedResponsesTable).where(eq(cannedResponsesTable.id, id)).returning();
    if (!deleted) {
      res.status(404).json({ error: "Canned response not found" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete canned response" });
  }
});

router.get("/admin/ticket-routing", requirePermission("tickets:view"), async (_req: Request, res: Response) => {
  try {
    const rules = await db.select().from(ticketRoutingRulesTable).orderBy(asc(ticketRoutingRulesTable.sortOrder));
    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch routing rules" });
  }
});

router.post("/admin/ticket-routing", requirePermission("tickets:manage"), async (req: Request, res: Response) => {
  try {
    const { name, category, priority, tierSlug, assignToUserId, sortOrder, isActive } = req.body;
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    const [rule] = await db.insert(ticketRoutingRulesTable).values({
      name,
      category: category || null,
      priority: priority || null,
      tierSlug: tierSlug || null,
      assignToUserId: assignToUserId || null,
      sortOrder: sortOrder || 0,
      isActive: isActive !== false,
    }).returning();

    res.status(201).json(rule);
  } catch (error) {
    res.status(500).json({ error: "Failed to create routing rule" });
  }
});

router.put("/admin/ticket-routing/:id", requirePermission("tickets:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const { name, category, priority, tierSlug, assignToUserId, sortOrder, isActive } = req.body;
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (category !== undefined) updates.category = category;
    if (priority !== undefined) updates.priority = priority;
    if (tierSlug !== undefined) updates.tierSlug = tierSlug;
    if (assignToUserId !== undefined) updates.assignToUserId = assignToUserId;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    if (isActive !== undefined) updates.isActive = isActive;

    const [updated] = await db.update(ticketRoutingRulesTable)
      .set(updates)
      .where(eq(ticketRoutingRulesTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Routing rule not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Failed to update routing rule" });
  }
});

router.delete("/admin/ticket-routing/:id", requirePermission("tickets:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id));
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const [deleted] = await db.delete(ticketRoutingRulesTable).where(eq(ticketRoutingRulesTable.id, id)).returning();
    if (!deleted) {
      res.status(404).json({ error: "Routing rule not found" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete routing rule" });
  }
});

router.get("/admin/tickets/sla-dashboard", requirePermission("tickets:view"), async (_req: Request, res: Response) => {
  try {
    const allSlas = await db
      .select({
        sla: ticketSlaTable,
        ticketStatus: ticketsTable.status,
      })
      .from(ticketSlaTable)
      .innerJoin(ticketsTable, eq(ticketSlaTable.ticketId, ticketsTable.id));

    const total = allSlas.length;
    const firstResponseBreached = allSlas.filter(s => s.sla.firstResponseBreached).length;
    const resolutionBreached = allSlas.filter(s => s.sla.resolutionBreached).length;
    const firstResponseWarning = allSlas.filter(s => s.sla.firstResponseWarning && !s.sla.firstResponseBreached).length;
    const resolutionWarning = allSlas.filter(s => s.sla.resolutionWarning && !s.sla.resolutionBreached).length;
    const compliant = allSlas.filter(s => !s.sla.firstResponseBreached && !s.sla.resolutionBreached).length;

    const byTier: Record<string, { total: number; compliant: number; breached: number }> = {};
    for (const { sla } of allSlas) {
      if (!byTier[sla.tierSlug]) {
        byTier[sla.tierSlug] = { total: 0, compliant: 0, breached: 0 };
      }
      byTier[sla.tierSlug].total++;
      if (sla.firstResponseBreached || sla.resolutionBreached) {
        byTier[sla.tierSlug].breached++;
      } else {
        byTier[sla.tierSlug].compliant++;
      }
    }

    res.json({
      total,
      compliant,
      complianceRate: total > 0 ? Math.round((compliant / total) * 100) : 100,
      firstResponseBreached,
      firstResponseWarning,
      resolutionBreached,
      resolutionWarning,
      byTier,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch SLA dashboard" });
  }
});

router.get("/admin/tickets/analytics", requirePermission("tickets:view"), async (_req: Request, res: Response) => {
  try {
    const totalTickets = await db.select({ count: sql<number>`count(*)` }).from(ticketsTable);

    const byStatus = await db
      .select({
        status: ticketsTable.status,
        count: sql<number>`count(*)`,
      })
      .from(ticketsTable)
      .groupBy(ticketsTable.status);

    const byCategory = await db
      .select({
        category: ticketsTable.category,
        count: sql<number>`count(*)`,
      })
      .from(ticketsTable)
      .groupBy(ticketsTable.category);

    const byPriority = await db
      .select({
        priority: ticketsTable.priority,
        count: sql<number>`count(*)`,
      })
      .from(ticketsTable)
      .groupBy(ticketsTable.priority);

    const last30Days = await db
      .select({ count: sql<number>`count(*)` })
      .from(ticketsTable)
      .where(sql`${ticketsTable.createdAt} >= NOW() - INTERVAL '30 days'`);

    const last7Days = await db
      .select({ count: sql<number>`count(*)` })
      .from(ticketsTable)
      .where(sql`${ticketsTable.createdAt} >= NOW() - INTERVAL '7 days'`);

    const avgSatisfaction = await db
      .select({ avg: sql<number>`COALESCE(AVG(rating), 0)` })
      .from(ticketSatisfactionTable);

    res.json({
      totalTickets: Number(totalTickets[0]?.count || 0),
      last30Days: Number(last30Days[0]?.count || 0),
      last7Days: Number(last7Days[0]?.count || 0),
      byStatus: byStatus.map(s => ({ status: s.status, count: Number(s.count) })),
      byCategory: byCategory.map(c => ({ category: c.category, count: Number(c.count) })),
      byPriority: byPriority.map(p => ({ priority: p.priority, count: Number(p.count) })),
      averageSatisfaction: Number(Number(avgSatisfaction[0]?.avg || 0).toFixed(1)),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

router.get("/admin/tickets/agent-performance", requirePermission("tickets:view"), async (_req: Request, res: Response) => {
  try {
    const agents = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
      })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));

    const performance = [];

    for (const agent of agents) {
      const assigned = await db
        .select({ count: sql<number>`count(*)` })
        .from(ticketsTable)
        .where(eq(ticketsTable.assignedTo, agent.id));

      const open = await db
        .select({ count: sql<number>`count(*)` })
        .from(ticketsTable)
        .where(and(
          eq(ticketsTable.assignedTo, agent.id),
          sql`${ticketsTable.status} NOT IN ('resolved', 'closed')`
        ));

      const resolved = await db
        .select({ count: sql<number>`count(*)` })
        .from(ticketsTable)
        .where(and(
          eq(ticketsTable.assignedTo, agent.id),
          eq(ticketsTable.status, "resolved")
        ));

      const slaBreaches = await db
        .select({ count: sql<number>`count(*)` })
        .from(ticketSlaTable)
        .innerJoin(ticketsTable, eq(ticketSlaTable.ticketId, ticketsTable.id))
        .where(and(
          eq(ticketsTable.assignedTo, agent.id),
          sql`(${ticketSlaTable.firstResponseBreached} = true OR ${ticketSlaTable.resolutionBreached} = true)`
        ));

      const avgRating = await db
        .select({ avg: sql<number>`COALESCE(AVG(${ticketSatisfactionTable.rating}), 0)` })
        .from(ticketSatisfactionTable)
        .innerJoin(ticketsTable, eq(ticketSatisfactionTable.ticketId, ticketsTable.id))
        .where(eq(ticketsTable.assignedTo, agent.id));

      performance.push({
        agentId: agent.id,
        agentName: agent.name,
        agentEmail: agent.email,
        totalAssigned: Number(assigned[0]?.count || 0),
        openTickets: Number(open[0]?.count || 0),
        resolvedTickets: Number(resolved[0]?.count || 0),
        slaBreaches: Number(slaBreaches[0]?.count || 0),
        averageRating: Number(Number(avgRating[0]?.avg || 0).toFixed(1)),
      });
    }

    res.json(performance);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch agent performance" });
  }
});

router.get("/admin/tickets", requirePermission("tickets:view"), async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const category = req.query.category as string | undefined;
    const assignedTo = req.query.assignedTo as string | undefined;

    const conditions = [];
    if (status) conditions.push(eq(ticketsTable.status, status));
    if (category) conditions.push(eq(ticketsTable.category, category));
    if (assignedTo) conditions.push(eq(ticketsTable.assignedTo, parseInt(assignedTo)));

    // Join with users so the admin Ticket Detail merge dialog can render
    // "<ticketNumber> · <member name>" for each candidate without an
    // additional round-trip per row. assignedTo is nullable, so we use
    // an aliased left join for the agent.
    // Also left-join `ticket_sla` so each row carries the canonical
    // service tier and the breach / warning flags the Ticket Queue
    // uses to drive its SLA badges, tier column, row tinting, and
    // default "most urgent first" sort. Tickets that somehow don't
    // have an SLA row (legacy data, mid-flight inserts) come back
    // with `tier: null` and `slaStatus: null` so the UI can render
    // them as "—" without exploding.
    const assignedAgent = alias(usersTable, "assigned_agent");
    const baseQuery = db
      .select({
        id: ticketsTable.id,
        ticketNumber: ticketsTable.ticketNumber,
        userId: ticketsTable.userId,
        category: ticketsTable.category,
        priority: ticketsTable.priority,
        status: ticketsTable.status,
        subject: ticketsTable.subject,
        source: ticketsTable.source,
        sourceReferenceId: ticketsTable.sourceReferenceId,
        assignedTo: ticketsTable.assignedTo,
        createdAt: ticketsTable.createdAt,
        updatedAt: ticketsTable.updatedAt,
        resolvedAt: ticketsTable.resolvedAt,
        memberName: usersTable.name,
        memberEmail: usersTable.email,
        assignedAgentName: assignedAgent.name,
        assignedAgentEmail: assignedAgent.email,
        tierSlug: ticketSlaTable.tierSlug,
        firstResponseBreached: ticketSlaTable.firstResponseBreached,
        firstResponseWarning: ticketSlaTable.firstResponseWarning,
        resolutionBreached: ticketSlaTable.resolutionBreached,
        resolutionWarning: ticketSlaTable.resolutionWarning,
      })
      .from(ticketsTable)
      .leftJoin(usersTable, eq(ticketsTable.userId, usersTable.id))
      .leftJoin(assignedAgent, eq(ticketsTable.assignedTo, assignedAgent.id))
      .leftJoin(ticketSlaTable, eq(ticketsTable.id, ticketSlaTable.ticketId));

    const rows = conditions.length > 0
      ? await baseQuery.where(and(...conditions)).orderBy(desc(ticketsTable.createdAt))
      : await baseQuery.orderBy(desc(ticketsTable.createdAt));

    const tickets = rows.map((row) => {
      // Derive a single SLA status the UI can filter / sort / badge on.
      // A breach trumps a warning trumps "within target"; tickets with
      // no SLA row at all return null so the UI can render "—".
      let slaStatus: "breached" | "approaching" | "within" | null = null;
      if (row.tierSlug != null) {
        if (row.firstResponseBreached || row.resolutionBreached) {
          slaStatus = "breached";
        } else if (row.firstResponseWarning || row.resolutionWarning) {
          slaStatus = "approaching";
        } else {
          slaStatus = "within";
        }
      }
      return {
        id: row.id,
        ticketNumber: row.ticketNumber,
        userId: row.userId,
        category: row.category,
        priority: row.priority,
        status: row.status,
        subject: row.subject,
        source: row.source,
        sourceReferenceId: row.sourceReferenceId,
        assignedTo: row.assignedTo,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        resolvedAt: row.resolvedAt,
        member: row.memberName
          ? { id: row.userId, name: row.memberName, email: row.memberEmail }
          : null,
        assignee: row.assignedTo
          ? { id: row.assignedTo, name: row.assignedAgentName, email: row.assignedAgentEmail }
          : null,
        tier: row.tierSlug,
        slaStatus,
      };
    });

    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

// Light-weight list of admin users who are eligible to be assigned to a
// ticket. Powers the assignee dropdown on the admin Ticket Detail page —
// using the same `role IN (...)` filter as agent-performance so the two
// surfaces stay consistent.
router.get("/admin/tickets/assignees", requirePermission("tickets:view"), async (_req: Request, res: Response) => {
  try {
    const agents = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
      })
      .from(usersTable)
      .where(inArray(usersTable.role, ["admin", "super_admin"]))
      .orderBy(asc(usersTable.name));

    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch assignees" });
  }
});

router.post("/admin/tickets/merge", requirePermission("tickets:manage"), async (req: Request, res: Response) => {
  try {
    const { primaryTicketId, ticketIds } = req.body;

    if (!primaryTicketId || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      res.status(400).json({ error: "primaryTicketId and ticketIds array are required" });
      return;
    }

    const [primaryTicket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, primaryTicketId));
    if (!primaryTicket) {
      res.status(404).json({ error: "Primary ticket not found" });
      return;
    }

    const mergedTickets = await db.select().from(ticketsTable).where(inArray(ticketsTable.id, ticketIds));
    if (mergedTickets.length !== ticketIds.length) {
      res.status(404).json({ error: "One or more tickets to merge not found" });
      return;
    }

    for (const ticket of mergedTickets) {
      if (ticket.id === primaryTicketId) continue;

      await db.update(ticketMessagesTable)
        .set({ ticketId: primaryTicketId })
        .where(eq(ticketMessagesTable.ticketId, ticket.id));

      await db.update(ticketsTable)
        .set({ status: "closed" })
        .where(eq(ticketsTable.id, ticket.id));

      await db.insert(ticketMessagesTable).values({
        ticketId: ticket.id,
        senderType: "admin",
        body: `Merged into #${primaryTicket.ticketNumber}`,
        isInternal: true,
      });

      console.log(`[Merge] Ticket #${ticket.ticketNumber} merged into #${primaryTicket.ticketNumber}`);
    }

    const allMessages = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, primaryTicketId))
      .orderBy(ticketMessagesTable.createdAt);

    res.json({
      primaryTicket: { ...primaryTicket },
      mergedCount: mergedTickets.filter(t => t.id !== primaryTicketId).length,
      totalMessages: allMessages.length,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to merge tickets" });
  }
});

router.get("/admin/tickets/:id", requirePermission("tickets:view"), async (req: Request, res: Response) => {
  try {
    const ticketId = parseInt(getParam(req.params.id));
    if (isNaN(ticketId)) {
      res.status(400).json({ error: "Invalid ticket ID" });
      return;
    }

    // Pull the ticket plus the joined member/assignee in a single query so the
    // admin Ticket Detail page can render the header (name, email, current
    // assignee) without two extra round-trips.
    const assignedAgent = alias(usersTable, "assigned_agent");
    const [row] = await db
      .select({
        ticket: ticketsTable,
        memberId: usersTable.id,
        memberName: usersTable.name,
        memberEmail: usersTable.email,
        assigneeId: assignedAgent.id,
        assigneeName: assignedAgent.name,
        assigneeEmail: assignedAgent.email,
      })
      .from(ticketsTable)
      .leftJoin(usersTable, eq(ticketsTable.userId, usersTable.id))
      .leftJoin(assignedAgent, eq(ticketsTable.assignedTo, assignedAgent.id))
      .where(eq(ticketsTable.id, ticketId));

    if (!row) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    // SLA gives us the canonical service tier for this ticket; reuse it so
    // the page doesn't need a separate lookup just to label the header.
    const [sla] = await db
      .select({ tierSlug: ticketSlaTable.tierSlug })
      .from(ticketSlaTable)
      .where(eq(ticketSlaTable.ticketId, ticketId));

    const messages = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, ticketId))
      .orderBy(ticketMessagesTable.createdAt);

    // The messages table only stores `senderType` (member|admin), not a
    // user reference. Member messages are by definition the ticket owner;
    // admin messages we surface as a generic label so the UI doesn't have
    // to special-case unattributed admin notes/replies.
    const enrichedMessages = messages.map((msg) => ({
      ...msg,
      senderName: msg.senderType === "member"
        ? (row.memberName ?? "Member")
        : "Admin",
    }));

    res.json({
      ...row.ticket,
      member: row.memberId
        ? { id: row.memberId, name: row.memberName, email: row.memberEmail }
        : null,
      assignee: row.assigneeId
        ? { id: row.assigneeId, name: row.assigneeName, email: row.assigneeEmail }
        : null,
      tier: sla?.tierSlug ?? null,
      messages: enrichedMessages,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch ticket" });
  }
});

router.get("/admin/tickets/:id/sla", requirePermission("tickets:view"), async (req: Request, res: Response) => {
  try {
    const ticketId = parseInt(getParam(req.params.id));
    if (isNaN(ticketId)) {
      res.status(400).json({ error: "Invalid ticket ID" });
      return;
    }

    const [sla] = await db.select().from(ticketSlaTable).where(eq(ticketSlaTable.ticketId, ticketId));
    if (!sla) {
      res.status(404).json({ error: "No SLA record found for this ticket" });
      return;
    }

    const now = new Date();
    const elapsed = sla.pausedAt
      ? calculateBusinessMinutesFast(sla.createdAt, sla.pausedAt) - sla.totalPausedMinutes
      : calculateBusinessMinutesFast(sla.createdAt, now) - sla.totalPausedMinutes;

    res.json({
      ...sla,
      elapsedBusinessMinutes: elapsed,
      firstResponsePct: sla.firstResponseAt ? null : Math.round((elapsed / sla.firstResponseTargetMinutes) * 100),
      resolutionPct: Math.round((elapsed / sla.resolutionTargetMinutes) * 100),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch SLA data" });
  }
});

router.post("/admin/tickets/:id/internal-note", requirePermission("tickets:manage"), async (req: Request, res: Response) => {
  try {
    const ticketId = parseInt(getParam(req.params.id));
    if (isNaN(ticketId)) {
      res.status(400).json({ error: "Invalid ticket ID" });
      return;
    }

    const { body } = req.body;
    if (!body) {
      res.status(400).json({ error: "Body is required" });
      return;
    }

    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId));
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    const [note] = await db.insert(ticketMessagesTable).values({
      ticketId,
      senderType: "admin",
      body,
      isInternal: true,
    }).returning();

    res.status(201).json(note);
  } catch (error) {
    res.status(500).json({ error: "Failed to create internal note" });
  }
});

router.post("/admin/tickets/:id/reply", requirePermission("tickets:manage"), async (req: Request, res: Response) => {
  try {
    const ticketId = parseInt(getParam(req.params.id));
    if (isNaN(ticketId)) {
      res.status(400).json({ error: "Invalid ticket ID" });
      return;
    }

    const { body } = req.body;
    if (!body) {
      res.status(400).json({ error: "Body is required" });
      return;
    }

    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId));
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    const [message] = await db.insert(ticketMessagesTable).values({
      ticketId,
      senderType: "admin",
      body,
      isInternal: false,
    }).returning();

    await recordFirstResponse(ticketId);

    if (ticket.status === "open") {
      await db.update(ticketsTable)
        .set({ status: "in_progress" })
        .where(eq(ticketsTable.id, ticketId));
    }

    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ error: "Failed to send reply" });
  }
});

router.put("/admin/tickets/:id/status", requirePermission("tickets:manage"), async (req: Request, res: Response) => {
  try {
    const ticketId = parseInt(getParam(req.params.id));
    if (isNaN(ticketId)) {
      res.status(400).json({ error: "Invalid ticket ID" });
      return;
    }

    const { status } = req.body;
    const validStatuses = ["open", "in_progress", "awaiting_response", "resolved", "closed"];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      return;
    }

    const updates: Record<string, any> = { status };

    if (status === "resolved") {
      updates.resolvedAt = new Date();
    }

    if (status === "awaiting_response") {
      await pauseSla(ticketId);
    } else {
      await resumeSla(ticketId);
    }

    const [updated] = await db.update(ticketsTable)
      .set(updates)
      .where(eq(ticketsTable.id, ticketId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    if (status === "resolved") {
      console.log(`[STUB:SatisfactionSurvey] Trigger satisfaction survey for ticket #${updated.ticketNumber}`);
      emitWebhookEvent("ticket.resolved", {
        ticket_id: updated.id,
        ticket_number: updated.ticketNumber,
        user_id: updated.userId,
        resolved_at: updated.resolvedAt,
      }).catch(() => {});
    }

    if (status === "closed") {
      emitWebhookEvent("ticket.closed", {
        ticket_id: updated.id,
        ticket_number: updated.ticketNumber,
        user_id: updated.userId,
      }).catch(() => {});
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Failed to update ticket status" });
  }
});

router.put("/admin/tickets/:id/priority", requirePermission("tickets:manage"), async (req: Request, res: Response) => {
  try {
    const ticketId = parseInt(getParam(req.params.id));
    if (isNaN(ticketId)) {
      res.status(400).json({ error: "Invalid ticket ID" });
      return;
    }

    const { priority } = req.body;
    const validPriorities = ["urgent", "high", "normal", "low"];
    if (!validPriorities.includes(priority)) {
      res.status(400).json({ error: `Invalid priority. Must be one of: ${validPriorities.join(", ")}` });
      return;
    }

    const [updated] = await db.update(ticketsTable)
      .set({ priority })
      .where(eq(ticketsTable.id, ticketId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Failed to update ticket priority" });
  }
});

router.put("/admin/tickets/:id/assign", requirePermission("tickets:manage"), async (req: Request, res: Response) => {
  try {
    const ticketId = parseInt(getParam(req.params.id));
    if (isNaN(ticketId)) {
      res.status(400).json({ error: "Invalid ticket ID" });
      return;
    }

    // `assignedTo: null` means "unassign". Anything else must be the id of an
    // existing admin/super_admin user — we verify before writing so a stale
    // id from the client doesn't silently dangle the FK.
    const { assignedTo } = req.body as { assignedTo: number | null | undefined };
    if (assignedTo !== null && (typeof assignedTo !== "number" || !Number.isFinite(assignedTo))) {
      res.status(400).json({ error: "assignedTo must be a number or null" });
      return;
    }

    if (assignedTo !== null) {
      const [agent] = await db
        .select({ id: usersTable.id, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, assignedTo as number));
      if (!agent || (agent.role !== "admin" && agent.role !== "super_admin")) {
        res.status(400).json({ error: "Assignee must be an admin user" });
        return;
      }
    }

    const [updated] = await db.update(ticketsTable)
      .set({ assignedTo: assignedTo as number | null })
      .where(eq(ticketsTable.id, ticketId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Failed to update ticket assignee" });
  }
});

export default router;
