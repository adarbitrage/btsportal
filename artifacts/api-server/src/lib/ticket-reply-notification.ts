import { db, ticketsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CommunicationService } from "./communication-service";

/**
 * Queue the "support replied" notification (email + optional SMS nudge) for
 * the member who owns the ticket.
 *
 * Shared by BOTH agent-reply ingestion paths so a member is notified no
 * matter how the reply arrived:
 *   - the inbound TicketDesk webhook handler (routes/tickets.ts), and
 *   - the 5-minute TicketDesk reply poller (lib/ticketdesk-poller.ts).
 *
 * Duplicate-safety: both paths claim each TicketDesk message id in
 * webhook_logs before appending, so a given agent reply is processed — and
 * this notification fired — at most once, regardless of which path saw it
 * first or how often it is redelivered.
 *
 * Looks up the member's current email + name so the deep link and greeting
 * are correct, then hands off to CommunicationService.queueEmail (which has
 * its own Redis-down direct-send fallback and template/portal-url skip
 * handling). Fully best-effort: every failure path is logged and swallowed so
 * neither caller ever throws on a mailer problem.
 */
export async function sendTicketReplyNotification(
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
    // job for a member with no phone on file. The webhook_logs dedup claim
    // guarantees this whole block runs at most once per reply, so a
    // redelivered webhook or overlapping poll never sends a duplicate text.
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
      `[Tickets] Failed to queue reply notification for ticket ${ticket.ticketNumber}:`,
      err,
    );
  }
}
