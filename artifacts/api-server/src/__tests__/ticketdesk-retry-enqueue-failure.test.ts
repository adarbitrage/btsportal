import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

// Force the queue to believe TicketDesk is configured so the retry path
// actually attempts an enqueue (rather than short-circuiting to 'skipped').
vi.mock("../lib/ticketdesk-client", () => ({
  isConfigured: () => true,
  createConversation: vi.fn(),
}));

// Make the BullMQ enqueue throw so we exercise the genuine "enqueue failed"
// branch — the case that used to be reported as a false-positive success.
vi.mock("bullmq", () => ({
  Queue: class {
    add(): Promise<never> {
      return Promise.reject(new Error("redis unavailable"));
    }
    async close(): Promise<void> {}
  },
  Worker: class {
    on(): void {}
    async close(): Promise<void> {}
  },
}));

// Stub ioredis so this file opens no real Redis connection (no native handle
// that could outlive the test and destabilize a shared-process test run).
vi.mock("ioredis", () => ({
  default: class {
    on(): void {}
    async quit(): Promise<void> {}
  },
}));

import {
  db,
  usersTable,
  ticketsTable,
  ticketMessagesTable,
} from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

import {
  retryTicketDeskDelivery,
  shutdownTicketDeskQueue,
} from "../lib/ticketdesk-queue";

const TEST_TAG = `retry-enqueue-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
const seededTicketIds: number[] = [];
let failedTicketId = 0;

beforeAll(async () => {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-member@example.test`,
      name: "Enqueue Failure Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(member.id);

  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      ticketNumber: `BTS-${TEST_TAG}`,
      userId: member.id,
      subject: "Enqueue failure ticket",
      category: "billing",
      priority: "normal",
      status: "open",
      deliveryStatus: "failed",
      deliveryLastError: "boom",
    })
    .returning({ id: ticketsTable.id });
  failedTicketId = ticket.id;
  seededTicketIds.push(ticket.id);

  await db.insert(ticketMessagesTable).values({
    ticketId: ticket.id,
    senderType: "member",
    body: "Original member message body.",
    isInternal: false,
  });
});

afterAll(async () => {
  await shutdownTicketDeskQueue();
  if (seededTicketIds.length > 0) {
    await db
      .delete(ticketMessagesTable)
      .where(inArray(ticketMessagesTable.ticketId, seededTicketIds));
    await db.delete(ticketsTable).where(inArray(ticketsTable.id, seededTicketIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("retryTicketDeskDelivery — enqueue failure", () => {
  it("reports enqueue_failed instead of a false-positive success", async () => {
    const result = await retryTicketDeskDelivery(failedTicketId);
    expect(result).toEqual({ ok: false, reason: "enqueue_failed" });

    // The row was reset to 'pending' before the enqueue attempt; that's the
    // honest state (no job was created), and the route surfaces a 5xx so the
    // operator knows to retry.
    const [row] = await db
      .select({ deliveryStatus: ticketsTable.deliveryStatus })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, failedTicketId));
    expect(row.deliveryStatus).toBe("pending");
  });
});
