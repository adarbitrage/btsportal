import { db, ticketsTable, ticketMessagesTable } from "@workspace/db";
import { eq, and, lt, sql } from "drizzle-orm";
import { checkSlaBreaches } from "./sla";

export async function autoCloseStaleTickets(): Promise<number> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const staleTickets = await db
    .select()
    .from(ticketsTable)
    .where(
      and(
        eq(ticketsTable.status, "awaiting_response"),
        lt(ticketsTable.updatedAt, sevenDaysAgo)
      )
    );

  for (const ticket of staleTickets) {
    await db.update(ticketsTable)
      .set({ status: "closed" })
      .where(eq(ticketsTable.id, ticket.id));

    await db.insert(ticketMessagesTable).values({
      ticketId: ticket.id,
      senderType: "admin",
      body: "This ticket has been automatically closed due to inactivity (no response for 7 days). If you still need assistance, please open a new ticket.",
      isInternal: false,
    });

    console.log(`[AutoClose] Closed ticket #${ticket.ticketNumber} (ID: ${ticket.id}) due to 7 days of inactivity`);
  }

  return staleTickets.length;
}

export async function followUpAfterResolution(): Promise<number> {
  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setDate(twentyFourHoursAgo.getDate() - 1);

  const resolvedTickets = await db
    .select()
    .from(ticketsTable)
    .where(
      and(
        eq(ticketsTable.status, "resolved"),
        sql`${ticketsTable.resolvedAt} IS NOT NULL AND ${ticketsTable.resolvedAt} <= ${twentyFourHoursAgo}`
      )
    );

  for (const ticket of resolvedTickets) {
    const existingFollowUp = await db
      .select()
      .from(ticketMessagesTable)
      .where(
        and(
          eq(ticketMessagesTable.ticketId, ticket.id),
          sql`${ticketMessagesTable.body} LIKE '%follow-up%satisfaction%'`
        )
      );

    if (existingFollowUp.length > 0) continue;

    await db.insert(ticketMessagesTable).values({
      ticketId: ticket.id,
      senderType: "admin",
      body: "Thank you for using our support! As a follow-up, we'd love to hear about your experience. Please take a moment to rate your satisfaction with the support you received.",
      isInternal: false,
    });

    console.log(`[FollowUp] Sent follow-up for ticket #${ticket.ticketNumber} (ID: ${ticket.id})`);
  }

  return resolvedTickets.length;
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startTicketJobs(): void {
  if (jobInterval) return;

  jobInterval = setInterval(async () => {
    try {
      const closed = await autoCloseStaleTickets();
      if (closed > 0) console.log(`[TicketJobs] Auto-closed ${closed} stale tickets`);

      const followedUp = await followUpAfterResolution();
      if (followedUp > 0) console.log(`[TicketJobs] Sent ${followedUp} follow-ups`);

      const slaResult = await checkSlaBreaches();
      if (slaResult.warnings > 0 || slaResult.breaches > 0) {
        console.log(`[TicketJobs] SLA check: ${slaResult.warnings} warnings, ${slaResult.breaches} breaches`);
      }
    } catch (err) {
      console.error("[TicketJobs] Error running ticket jobs:", err);
    }
  }, 60 * 60 * 1000);

  console.log("[TicketJobs] Started ticket background jobs (hourly interval)");
}

export function stopTicketJobs(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
