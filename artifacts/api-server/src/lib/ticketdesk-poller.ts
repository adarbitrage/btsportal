/**
 * TicketDesk reply poller — mirrors agent replies into the portal ticket thread.
 *
 * ## Why polling instead of webhooks?
 *
 * TicketDesk (tickets.buildtestscale.com) is a custom platform that does NOT
 * expose an outgoing webhook registration API. The webhook endpoints that the
 * inbound handler at POST /api/webhooks/ticketdesk would require TicketDesk to
 * call are simply not present in the TicketDesk admin API (404 on all admin
 * webhook paths, confirmed against the live instance).
 *
 * TicketDesk DOES expose a reliable chat-session messages API (the same one
 * the live-chat widget uses):
 *   GET /api/chat/messages?limit=N    (with Authorization: Bearer <sessionToken>)
 *
 * Sessions are get-or-create keyed by (email, externalId), so we can re-obtain
 * a valid session token for any portal-delivered ticket by calling
 * POST /api/chat/session with the member's email and the BTS ticket number as
 * externalId — no stored credential required.
 *
 * ## What this job does
 *
 * Every POLL_INTERVAL_MS (5 minutes) the job:
 *   1. Finds all portal tickets whose deliveryStatus is 'delivered' and whose
 *      status is still active (open / in_progress / awaiting_response), created
 *      within the last POLL_CUTOFF_DAYS (30 days).
 *
 *      The 30-day window is intentional: it keeps the per-cycle query small and
 *      prevents churning on tickets that have been idle for weeks.  Any ticket
 *      whose conversation goes quiet and is then replied to after the cutoff
 *      will pick up again once an admin manually updates its status back to
 *      active.  Override via TICKETDESK_POLL_CUTOFF_DAYS env var if needed.
 *
 *   2. For each ticket, re-creates a TicketDesk session (idempotent — returns the
 *      same underlying thread every time for the same email + externalId).
 *   3. Fetches all messages from that thread via GET /api/chat/messages.
 *   4. Filters to agent-side messages (type: "chat_outbound", "outbound", or similar).
 *   5. Deduplicates each message via a webhook_logs ON CONFLICT DO NOTHING insert
 *      keyed by "ticketdesk_msg_<messageId>".  This is the same mechanism the
 *      inbound webhook handler uses, so if TicketDesk ever gains outgoing webhook
 *      support and is configured, both paths can coexist without double-posting.
 *   6. Appends new agent messages to the portal ticket thread.
 *   7. Mirrors the same status and SLA side-effects as the inbound webhook handler:
 *        - recordFirstResponse (stamps the SLA first-response timestamp)
 *        - open → in_progress
 *        - awaiting_response → in_progress + resumeSla
 *
 * ## Concurrency and rate-limiting
 *
 * Tickets are processed at most MAX_CONCURRENT at a time with a small inter-call
 * delay to avoid flooding TicketDesk with session creation requests.  Errors on
 * individual tickets are fully swallowed so one bad ticket never stalls the
 * batch.
 */

import {
  db,
  ticketsTable,
  ticketMessagesTable,
  webhookLogsTable,
  usersTable,
} from "@workspace/db";
import {
  eq,
  and,
  inArray,
  gte,
  isNotNull,
} from "drizzle-orm";
import {
  createSessionForPolling,
  fetchThreadMessagesWithMeta,
  detectThreadClosed,
  isAgentMessage,
  type TicketDeskThreadMessage,
} from "./ticketdesk-client";
import { recordFirstResponse, resumeSla } from "./sla";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const POLL_CUTOFF_DAYS = parseInt(
  process.env.TICKETDESK_POLL_CUTOFF_DAYS ?? "30",
  10,
);
const MAX_CONCURRENT = 5;
const INTER_TICKET_DELAY_MS = 300;

const ACTIVE_STATUSES = ["open", "in_progress", "awaiting_response"];

let pollerInterval: ReturnType<typeof setInterval> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollSingleTicket(
  ticket: typeof ticketsTable.$inferSelect,
  memberEmail: string,
): Promise<{ appended: number; skipped: number }> {
  let sessionToken: string;
  try {
    sessionToken = await createSessionForPolling({
      email: memberEmail,
      btsTicketNumber: ticket.ticketNumber,
    });
  } catch (err) {
    console.warn(
      `[TicketDesk Poller] Could not create session for ticket ${ticket.ticketNumber}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { appended: 0, skipped: 0 };
  }

  let messages: TicketDeskThreadMessage[];
  let rawData: Record<string, unknown> = {};
  try {
    const result = await fetchThreadMessagesWithMeta(sessionToken);
    messages = result.messages;
    rawData = result.rawData;
  } catch (err) {
    console.warn(
      `[TicketDesk Poller] Could not fetch messages for ticket ${ticket.ticketNumber}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { appended: 0, skipped: 0 };
  }

  // Check whether TicketDesk has closed/resolved this conversation.
  // When closure is detected:
  //   1. Set the portal ticket to "resolved" (best-effort, idempotent on ticket.id).
  //   2. Do NOT return early — any newly-seen agent messages in this same poll
  //      must still be appended so members see the final support response.
  //   3. The threadClosed flag is used below to skip the "in_progress" status
  //      promotion (which would overwrite "resolved" using the stale ticket.status).
  const threadClosed = detectThreadClosed(messages, rawData);
  if (threadClosed && ACTIVE_STATUSES.includes(ticket.status)) {
    try {
      await db
        .update(ticketsTable)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(eq(ticketsTable.id, ticket.id));
      console.log(
        `[TicketDesk Poller] Marked ticket ${ticket.ticketNumber} as resolved (TicketDesk closed the conversation)`,
      );
    } catch (err) {
      console.error(
        `[TicketDesk Poller] Failed to resolve ticket ${ticket.ticketNumber} from TicketDesk closure:`,
        err,
      );
    }
  }

  const agentMessages = messages.filter((m) => isAgentMessage(m));
  if (agentMessages.length === 0) return { appended: 0, skipped: 0 };

  let appended = 0;
  let skipped = 0;

  for (const msg of agentMessages) {
    if (!msg.id || !msg.body) continue;
    const externalId = `ticketdesk_msg_${msg.id}`;

    try {
      const claimed = await db
        .insert(webhookLogsTable)
        .values({
          externalId,
          eventType: "ticketdesk.poll",
          status: "processing",
          payload: msg as unknown as Record<string, unknown>,
          result: {},
        })
        .onConflictDoNothing({ target: webhookLogsTable.externalId })
        .returning({ id: webhookLogsTable.id });

      if (claimed.length === 0) {
        skipped++;
        continue;
      }

      const logId = claimed[0].id;

      try {
        await db.insert(ticketMessagesTable).values({
          ticketId: ticket.id,
          senderType: "admin",
          body: msg.body,
          isInternal: false,
        });

        await db
          .update(webhookLogsTable)
          .set({
            status: "processed",
            result: { action: "appended", ticketNumber: ticket.ticketNumber },
            processedAt: new Date(),
          })
          .where(eq(webhookLogsTable.id, logId));

        appended++;
      } catch (insertErr) {
        await db
          .delete(webhookLogsTable)
          .where(eq(webhookLogsTable.id, logId));
        throw insertErr;
      }
    } catch (err) {
      console.error(
        `[TicketDesk Poller] Failed to append message ${msg.id} to ticket ${ticket.ticketNumber}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (appended > 0) {
    console.log(
      `[TicketDesk Poller] Appended ${appended} agent reply(s) to ticket ${ticket.ticketNumber}`,
    );

    // Mirror the same status and SLA side-effects the inbound webhook handler
    // applies when it appends an agent reply.  All three are best-effort so a
    // failure here never prevents the reply from being visible to the member.
    try {
      await recordFirstResponse(ticket.id);
    } catch (err) {
      console.error(
        `[TicketDesk Poller] Failed to record first-response for ticket ${ticket.ticketNumber}:`,
        err,
      );
    }

    // Only promote to "in_progress" when the thread was NOT already closed.
    // If threadClosed is true the ticket has already been set to "resolved"
    // above; promoting it again using the stale ticket.status would revert it.
    if (
      !threadClosed &&
      (ticket.status === "open" || ticket.status === "awaiting_response")
    ) {
      try {
        await db
          .update(ticketsTable)
          .set({ status: "in_progress" })
          .where(eq(ticketsTable.id, ticket.id));
      } catch (err) {
        console.error(
          `[TicketDesk Poller] Failed to advance status for ticket ${ticket.ticketNumber}:`,
          err,
        );
      }
    }

    if (!threadClosed && ticket.status === "awaiting_response") {
      try {
        await resumeSla(ticket.id);
      } catch (err) {
        console.error(
          `[TicketDesk Poller] Failed to resume SLA for ticket ${ticket.ticketNumber}:`,
          err,
        );
      }
    }
  }

  return { appended, skipped };
}

async function runPollCycle(): Promise<void> {
  const cutoff = new Date(Date.now() - POLL_CUTOFF_DAYS * 24 * 60 * 60 * 1000);

  let tickets: (typeof ticketsTable.$inferSelect)[];
  try {
    tickets = await db
      .select()
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.deliveryStatus, "delivered"),
          inArray(ticketsTable.status, ACTIVE_STATUSES),
          gte(ticketsTable.createdAt, cutoff),
          isNotNull(ticketsTable.userId),
        ),
      );
  } catch (err) {
    console.error("[TicketDesk Poller] Failed to query tickets:", err);
    return;
  }

  if (tickets.length === 0) return;

  const userIds = [
    ...new Set(
      tickets.map((t) => t.userId).filter(Boolean) as number[],
    ),
  ];
  let emailMap: Map<number, string>;
  try {
    const members = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));
    emailMap = new Map(members.map((m) => [m.id, m.email]));
  } catch (err) {
    console.error("[TicketDesk Poller] Failed to query member emails:", err);
    return;
  }

  let totalAppended = 0;

  for (let i = 0; i < tickets.length; i += MAX_CONCURRENT) {
    const batch = tickets.slice(i, i + MAX_CONCURRENT);
    await Promise.all(
      batch.map(async (ticket) => {
        const email = ticket.userId ? emailMap.get(ticket.userId) : undefined;
        if (!email) return;
        const result = await pollSingleTicket(ticket, email);
        totalAppended += result.appended;
        if (INTER_TICKET_DELAY_MS > 0) await sleep(INTER_TICKET_DELAY_MS);
      }),
    );
  }

  if (totalAppended > 0) {
    console.log(
      `[TicketDesk Poller] Cycle complete — appended ${totalAppended} agent reply(s) across ${tickets.length} ticket(s)`,
    );
  }
}

export function startTicketDeskPoller(): void {
  if (pollerInterval) return;

  runPollCycle().catch((err) =>
    console.error("[TicketDesk Poller] Initial poll cycle error:", err),
  );

  pollerInterval = setInterval(() => {
    runPollCycle().catch((err) =>
      console.error("[TicketDesk Poller] Poll cycle error:", err),
    );
  }, POLL_INTERVAL_MS);

  console.log(
    `[TicketDesk Poller] Started (interval: ${POLL_INTERVAL_MS / 1000}s, cutoff: ${POLL_CUTOFF_DAYS}d)`,
  );
}

export function stopTicketDeskPoller(): void {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
}
