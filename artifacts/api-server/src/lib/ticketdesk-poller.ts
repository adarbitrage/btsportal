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
  lt,
  isNotNull,
} from "drizzle-orm";
import {
  createSessionForPolling,
  fetchThreadMessagesWithMeta,
  parseThreadStatus,
  inferAwaitingMemberReply,
  isAgentMessage,
  type TicketDeskThreadMessage,
} from "./ticketdesk-client";
import { recordFirstResponse, resumeSla } from "./sla";
import { sendTicketReplyNotification } from "./ticket-reply-notification";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const POLL_CUTOFF_DAYS = parseInt(
  process.env.TICKETDESK_POLL_CUTOFF_DAYS ?? "30",
  10,
);
const MAX_CONCURRENT = 5;
const INTER_TICKET_DELAY_MS = 300;

const ACTIVE_STATUSES = ["open", "in_progress", "awaiting_response"];

/**
 * Statuses the poll cycle watches. "resolved" is included so the poller can
 * see TicketDesk's auto-reopen (a member replying in the TicketDesk widget
 * flips a resolved thread back to open) and reopen the portal ticket to
 * match. "closed" stays excluded: it is a portal-only terminal state that
 * TicketDesk never reopens.
 */
const POLL_STATUSES = [...ACTIVE_STATUSES, "resolved"];

/**
 * Age (minutes) past which a still-'pending' ticket is treated as stuck and
 * eligible for self-healing recovery. 30 min is comfortably past the delivery
 * worker's exponential back-off retry window (~15 min for 5 attempts), so a
 * ticket older than this with no in-flight job is genuinely orphaned rather
 * than mid-retry. Override via TICKETDESK_RECONCILE_STUCK_MINUTES.
 */
const RECONCILE_STUCK_MINUTES = parseInt(
  process.env.TICKETDESK_RECONCILE_STUCK_MINUTES ?? "30",
  10,
);

/** Cap on how many stuck tickets a single cycle checks against TicketDesk, so a
 * large backlog can never flood the chat API in one pass. */
const RECONCILE_MAX_PER_CYCLE = 50;

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

  // --- Status sync (the agreed TicketDesk chat-API contract) ---------------
  //
  // parseThreadStatus reads the explicit `status` + `resolvedAt` TicketDesk
  // exposes on the messages response. An ABSENT or unrecognised status parses
  // as null — "unknown", never "closed" — in which case no status transition
  // happens at all (today's behavior until TicketDesk ships their change).
  //
  //   - remote resolved  + portal active   → resolve the portal ticket
  //     (stamp resolvedAt from TicketDesk when provided, clear the
  //     awaiting-reply nudge). Do NOT return early — any newly-seen agent
  //     messages in this same poll must still be appended so members see the
  //     final support response.
  //   - remote open/in_progress + portal resolved → TicketDesk auto-reopened
  //     the thread (the member replied in the widget): reopen the portal
  //     ticket as in_progress, clear resolvedAt, resume the SLA clock.
  //   - remote in_progress + portal open → promote, even when this cycle
  //     appended no new messages (an agent can claim a thread before typing).
  //
  // `effectiveStatus` tracks the portal status through these writes so the
  // append-driven promotion below never overwrites a fresh "resolved" with a
  // stale ticket.status.
  const remote = parseThreadStatus(rawData);
  let effectiveStatus = ticket.status;
  const threadResolved = remote.status === "resolved";

  if (threadResolved && ACTIVE_STATUSES.includes(ticket.status)) {
    try {
      await db
        .update(ticketsTable)
        .set({
          status: "resolved",
          resolvedAt: remote.resolvedAt ?? new Date(),
          awaitingMemberReply: false,
        })
        .where(eq(ticketsTable.id, ticket.id));
      effectiveStatus = "resolved";
      console.log(
        `[TicketDesk Poller] Marked ticket ${ticket.ticketNumber} as resolved (TicketDesk reports status=resolved)`,
      );
    } catch (err) {
      console.error(
        `[TicketDesk Poller] Failed to resolve ticket ${ticket.ticketNumber} from TicketDesk status:`,
        err,
      );
    }
  } else if (
    (remote.status === "open" || remote.status === "in_progress") &&
    ticket.status === "resolved"
  ) {
    // Auto-reopen: TicketDesk cleared resolved_at because the member replied
    // in the widget. Mirror it — back to in_progress, resolvedAt cleared.
    try {
      await db
        .update(ticketsTable)
        .set({ status: "in_progress", resolvedAt: null })
        .where(eq(ticketsTable.id, ticket.id));
      effectiveStatus = "in_progress";
      console.log(
        `[TicketDesk Poller] Reopened ticket ${ticket.ticketNumber} (TicketDesk reports status=${remote.status} after resolution)`,
      );
      try {
        await resumeSla(ticket.id);
      } catch (err) {
        console.error(
          `[TicketDesk Poller] Failed to resume SLA on reopen for ticket ${ticket.ticketNumber}:`,
          err,
        );
      }
    } catch (err) {
      console.error(
        `[TicketDesk Poller] Failed to reopen ticket ${ticket.ticketNumber}:`,
        err,
      );
    }
  } else if (remote.status === "in_progress" && ticket.status === "open") {
    // An agent claimed the thread (even if they haven't replied yet).
    try {
      await db
        .update(ticketsTable)
        .set({ status: "in_progress" })
        .where(eq(ticketsTable.id, ticket.id));
      effectiveStatus = "in_progress";
    } catch (err) {
      console.error(
        `[TicketDesk Poller] Failed to promote ticket ${ticket.ticketNumber} to in_progress:`,
        err,
      );
    }
  }

  // --- "Awaiting member reply" inference ------------------------------------
  // True when the last directional message in the thread is agent-authored and
  // the ticket isn't resolved. Recomputed every cycle from the full thread, so
  // it self-corrects; only written when it differs from the stored value.
  const isResolvedNow =
    effectiveStatus === "resolved" || effectiveStatus === "closed";
  const awaiting = inferAwaitingMemberReply(messages, isResolvedNow);
  // A resolve/reopen write above may already have set the flag's column; the
  // resolve path forces it false, matching inferAwaitingMemberReply(resolved).
  const storedAwaiting = threadResolved && effectiveStatus === "resolved"
    ? false
    : ticket.awaitingMemberReply;
  if (awaiting !== storedAwaiting) {
    try {
      await db
        .update(ticketsTable)
        .set({ awaitingMemberReply: awaiting })
        .where(eq(ticketsTable.id, ticket.id));
    } catch (err) {
      console.error(
        `[TicketDesk Poller] Failed to update awaiting-member-reply flag for ticket ${ticket.ticketNumber}:`,
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
    // applies when it appends an agent reply.  All are best-effort so a
    // failure here never prevents the reply from being visible to the member.
    try {
      await recordFirstResponse(ticket.id);
    } catch (err) {
      console.error(
        `[TicketDesk Poller] Failed to record first-response for ticket ${ticket.ticketNumber}:`,
        err,
      );
    }

    // Only promote to "in_progress" when the explicit status sync above left
    // the ticket active. If the remote status resolved the ticket this cycle,
    // promoting it again from the stale pre-sync status would revert it.
    if (
      effectiveStatus === "open" ||
      effectiveStatus === "awaiting_response"
    ) {
      try {
        await db
          .update(ticketsTable)
          .set({ status: "in_progress" })
          .where(eq(ticketsTable.id, ticket.id));
        effectiveStatus = "in_progress";
      } catch (err) {
        console.error(
          `[TicketDesk Poller] Failed to advance status for ticket ${ticket.ticketNumber}:`,
          err,
        );
      }
    }

    if (ticket.status === "awaiting_response") {
      try {
        await resumeSla(ticket.id);
      } catch (err) {
        console.error(
          `[TicketDesk Poller] Failed to resume SLA for ticket ${ticket.ticketNumber}:`,
          err,
        );
      }
    }

    // Notify the member (email + optional SMS nudge) that support replied —
    // the poller path previously synced the reply silently, so a member who
    // wasn't watching the portal never knew. The webhook_logs dedup claim per
    // message id guarantees each reply is processed by exactly one path, so
    // this can never double-notify with the webhook handler. One notification
    // per poll cycle regardless of how many replies were appended.
    await sendTicketReplyNotification(ticket);
  }

  return { appended, skipped };
}

/**
 * Self-healing recovery pass for orphaned deliveries.
 *
 * A ticket can be live in TicketDesk (its conversation + opening message were
 * created) yet stuck at deliveryStatus='pending' in the portal — e.g. the
 * delivery worker's 'delivered' write was lost to a restart. The main poll only
 * looks at 'delivered' tickets, so such an orphan never syncs its agent replies.
 *
 * This pass finds stuck 'pending' tickets (older than RECONCILE_STUCK_MINUTES,
 * within the poll cutoff window, owned by a known member) and asks TicketDesk
 * whether the conversation actually exists — i.e. the thread already carries
 * this ticket's opening message (its `BTS Ticket: <num>` marker) or any agent
 * reply. When it does, the ticket is flipped to 'delivered' so the main poll
 * below (and every future cycle) picks up its replies.
 *
 * Tickets whose conversation does NOT exist are left untouched: the startup
 * backfill / failed-delivery fallback email already covers genuinely
 * undelivered tickets, and a transient TicketDesk error simply retries next
 * cycle. Fully best-effort — never throws.
 */
async function reconcilePendingDeliveries(): Promise<void> {
  const stuckCutoff = new Date(
    Date.now() - RECONCILE_STUCK_MINUTES * 60 * 1000,
  );
  const ageCutoff = new Date(
    Date.now() - POLL_CUTOFF_DAYS * 24 * 60 * 60 * 1000,
  );

  let stuck: (typeof ticketsTable.$inferSelect)[];
  try {
    stuck = await db
      .select()
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.deliveryStatus, "pending"),
          lt(ticketsTable.createdAt, stuckCutoff),
          gte(ticketsTable.createdAt, ageCutoff),
          isNotNull(ticketsTable.userId),
        ),
      )
      .limit(RECONCILE_MAX_PER_CYCLE);
  } catch (err) {
    console.error("[TicketDesk Reconcile] Failed to query stuck tickets:", err);
    return;
  }

  if (stuck.length === 0) return;

  const userIds = [
    ...new Set(stuck.map((t) => t.userId).filter(Boolean) as number[]),
  ];
  let emailMap: Map<number, string>;
  try {
    const members = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));
    emailMap = new Map(members.map((m) => [m.id, m.email]));
  } catch (err) {
    console.error("[TicketDesk Reconcile] Failed to query member emails:", err);
    return;
  }

  let recovered = 0;

  for (const ticket of stuck) {
    const email = ticket.userId ? emailMap.get(ticket.userId) : undefined;
    if (!email) continue;

    let conversationExists = false;
    try {
      const sessionToken = await createSessionForPolling({
        email,
        btsTicketNumber: ticket.ticketNumber,
      });
      const { messages } = await fetchThreadMessagesWithMeta(sessionToken);
      const marker = `BTS Ticket: ${ticket.ticketNumber}`;
      conversationExists = messages.some(
        (m) => isAgentMessage(m) || m.body.includes(marker),
      );
    } catch (err) {
      console.warn(
        `[TicketDesk Reconcile] Could not check TicketDesk thread for ${ticket.ticketNumber}: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (INTER_TICKET_DELAY_MS > 0) await sleep(INTER_TICKET_DELAY_MS);
      continue;
    }

    if (conversationExists) {
      try {
        await db
          .update(ticketsTable)
          .set({
            deliveryStatus: "delivered",
            deliveryLastAttemptAt: new Date(),
            deliveryLastError: null,
          })
          .where(eq(ticketsTable.id, ticket.id));
        recovered++;
        console.log(
          `[TicketDesk Reconcile] Recovered ticket ${ticket.ticketNumber}: conversation exists in TicketDesk but was stuck at 'pending'; marked 'delivered' so agent replies sync.`,
        );
      } catch (err) {
        console.error(
          `[TicketDesk Reconcile] Failed to mark ${ticket.ticketNumber} delivered:`,
          err,
        );
      }
    }

    if (INTER_TICKET_DELAY_MS > 0) await sleep(INTER_TICKET_DELAY_MS);
  }

  if (recovered > 0) {
    console.log(
      `[TicketDesk Reconcile] Recovered ${recovered} stuck ticket(s) to 'delivered'.`,
    );
  }
}

async function runPollCycle(): Promise<void> {
  // Self-healing recovery first: flip any orphaned 'pending' tickets whose
  // conversation already exists in TicketDesk to 'delivered' so they are picked
  // up by the main poll in THIS same cycle (and every cycle thereafter).
  await reconcilePendingDeliveries().catch((err) =>
    console.error("[TicketDesk Reconcile] Cycle error:", err),
  );

  const cutoff = new Date(Date.now() - POLL_CUTOFF_DAYS * 24 * 60 * 60 * 1000);

  let tickets: (typeof ticketsTable.$inferSelect)[];
  try {
    tickets = await db
      .select()
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.deliveryStatus, "delivered"),
          inArray(ticketsTable.status, POLL_STATUSES),
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
