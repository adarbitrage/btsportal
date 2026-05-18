import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  ticketsTable,
  ticketMessagesTable,
  ticketSlaTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => "job_test_id"),
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

import { buildTestAppWithRouters } from "./test-app";
import ticketsRouter from "../routes/tickets";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `ticket-source-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberCookie = "";
let memberUserId = 0;
const seededUserIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([ticketsRouter]);
  const passwordHash = await bcrypt.hash("irrelevant", 4);

  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-member@example.test`,
      name: "Source Tag Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  memberUserId = member.id;
  memberCookie = signCookie(member.id, member.email);
  seededUserIds.push(member.id);
});

afterAll(async () => {
  // Tear down in FK-safe order: messages + SLA rows before tickets, then
  // users last. We scope by userId so a flaky run can't leak rows owned by
  // unrelated tests.
  const ticketRows = await db
    .select({ id: ticketsTable.id })
    .from(ticketsTable)
    .where(eq(ticketsTable.userId, memberUserId));
  if (ticketRows.length > 0) {
    const ids = ticketRows.map((r) => r.id);
    await db.delete(ticketSlaTable).where(inArray(ticketSlaTable.ticketId, ids));
    await db.delete(ticketMessagesTable).where(inArray(ticketMessagesTable.ticketId, ids));
    await db.delete(ticketsTable).where(inArray(ticketsTable.id, ids));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /api/tickets — source / sourceReferenceId tagging", () => {
  it("persists source and sourceReferenceId when supplied by the cancelled-email banner flow", async () => {
    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", memberCookie)
      .send({
        category: "other",
        subject: "Question about cancelled email change",
        description:
          "From: Source Tag Member <member@example.test>\n\nMy email change was cancelled.",
        source: "email_admin_cancelled_banner",
        sourceReferenceId: 9999,
      });

    expect(res.status).toBe(201);

    // Round-trip through the DB rather than trusting only the response so we
    // catch a case where the columns were validated by zod but silently
    // dropped before the insert (regression guard for the "spread the parsed
    // body in directly" refactor).
    const [row] = await db
      .select({
        source: ticketsTable.source,
        sourceReferenceId: ticketsTable.sourceReferenceId,
      })
      .from(ticketsTable)
      .where(eq(ticketsTable.userId, memberUserId));
    expect(row.source).toBe("email_admin_cancelled_banner");
    expect(row.sourceReferenceId).toBe(9999);

    await db.delete(ticketSlaTable).where(eq(ticketSlaTable.ticketId, res.body.id));
    await db.delete(ticketMessagesTable).where(eq(ticketMessagesTable.ticketId, res.body.id));
    await db.delete(ticketsTable).where(eq(ticketsTable.id, res.body.id));
  });

  it("leaves source and sourceReferenceId null when the body omits them (generic ticket)", async () => {
    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", memberCookie)
      .send({
        category: "technical",
        subject: "Generic ticket without source tag",
        description:
          "From: Source Tag Member <member@example.test>\n\nNot from any banner.",
      });

    expect(res.status).toBe(201);

    const [row] = await db
      .select({
        source: ticketsTable.source,
        sourceReferenceId: ticketsTable.sourceReferenceId,
      })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, res.body.id));
    expect(row.source).toBeNull();
    expect(row.sourceReferenceId).toBeNull();
  });
});
