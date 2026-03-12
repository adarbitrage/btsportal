import { db, ticketRoutingRulesTable, ticketsTable, usersTable } from "@workspace/db";
import { eq, and, sql, asc } from "drizzle-orm";
import { getUserEntitlements, getHighestProductLabel } from "./entitlements";

export async function autoRouteTicket(ticketId: number, userId: number, category: string, priority: string): Promise<number | null> {
  const entitlements = await getUserEntitlements(userId);
  const highest = getHighestProductLabel(entitlements);
  const tierSlug = highest.slug;

  const rules = await db
    .select()
    .from(ticketRoutingRulesTable)
    .where(eq(ticketRoutingRulesTable.isActive, true))
    .orderBy(asc(ticketRoutingRulesTable.sortOrder));

  let matchedRule = null;

  for (const rule of rules) {
    if (rule.category && rule.category !== category) continue;
    if (rule.priority && rule.priority !== priority) continue;
    if (rule.tierSlug && rule.tierSlug !== tierSlug) continue;
    matchedRule = rule;
    break;
  }

  if (!matchedRule) return null;

  if (matchedRule.assignToUserId) {
    await db.update(ticketsTable)
      .set({ assignedTo: matchedRule.assignToUserId })
      .where(eq(ticketsTable.id, ticketId));
    return matchedRule.assignToUserId;
  }

  const agents = await db
    .select({
      id: usersTable.id,
      openCount: sql<number>`COALESCE((SELECT COUNT(*) FROM tickets WHERE assigned_to = ${usersTable.id} AND status NOT IN ('resolved', 'closed')), 0)`,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"))
    .orderBy(sql`COALESCE((SELECT COUNT(*) FROM tickets WHERE assigned_to = ${usersTable.id} AND status NOT IN ('resolved', 'closed')), 0) ASC`);

  if (agents.length === 0) return null;

  const assignedAgent = agents[0];
  await db.update(ticketsTable)
    .set({ assignedTo: assignedAgent.id })
    .where(eq(ticketsTable.id, ticketId));

  return assignedAgent.id;
}
