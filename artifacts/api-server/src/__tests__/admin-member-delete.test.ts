import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  auditLogTable,
  partnersTable,
  partnerAssignmentsTable,
  callBookingsTable,
  partnerNotesTable,
  adSpendTransactionsTable,
  memberRefundEventsTable,
  btsOrdersTable,
  communicationLogTable,
  ticketsTable,
  ticketSlaTable,
  ticketAttachmentsTable,
} from "@workspace/db";
import { and, eq, inArray, desc, sql } from "drizzle-orm";

const cancelAppointmentMock = vi.fn(async (_eventId: string, _locationId?: string) => undefined);

vi.mock("../lib/ghl-coaching-calendar", () => ({
  cancelAppointment: (eventId: string, locationId?: string) => cancelAppointmentMock(eventId, locationId),
  COACHING_LOCATION_ID: "loc_test_default",
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import { generateAccessToken } from "../middleware/auth";

const TEST_TAG = `admin-member-delete-${randomUUID().slice(0, 8)}`;

const userIds: number[] = [];
const partnerIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let superAdminId: number;
let superAdminCookie: string;
let regularAdminId: number;
let regularAdminCookie: string;

function authCookie(userId: number, email: string): string {
  return `access_token=${generateAccessToken(userId, email)}`;
}

async function insertUser(role: string, suffix: string): Promise<{ id: number; email: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  userIds.push(row.id);
  return { id: row.id, email };
}

async function insertPartner(suffix: string): Promise<number> {
  const [row] = await db
    .insert(partnersTable)
    .values({
      displayName: `Delete Test Partner ${suffix}`,
      ghlCalendarId: `${TEST_TAG}-partner-cal-${suffix}`,
      isActive: true,
      maxDailyCalls: 5,
    })
    .returning({ id: partnersTable.id });
  partnerIds.push(row.id);
  return row.id;
}

async function activeAssignmentCount(partnerId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(partnerAssignmentsTable)
    .where(
      and(
        eq(partnerAssignmentsTable.partnerId, partnerId),
        eq(partnerAssignmentsTable.status, "active"),
      ),
    );
  return row?.count ?? 0;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const admin = await insertUser("super_admin", "super-admin");
  superAdminId = admin.id;
  superAdminCookie = authCookie(admin.id, admin.email);

  const regular = await insertUser("admin", "regular-admin");
  regularAdminId = regular.id;
  regularAdminCookie = authCookie(regular.id, regular.email);
});

afterAll(async () => {
  if (userIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, userIds));
    await db.delete(callBookingsTable).where(inArray(callBookingsTable.memberId, userIds));
    await db.delete(partnerNotesTable).where(inArray(partnerNotesTable.memberId, userIds));
    await db.delete(partnerAssignmentsTable).where(inArray(partnerAssignmentsTable.memberId, userIds));
    await db.delete(memberRefundEventsTable).where(inArray(memberRefundEventsTable.memberId, userIds));
    await db.delete(adSpendTransactionsTable).where(inArray(adSpendTransactionsTable.userId, userIds));
    await db.delete(btsOrdersTable).where(inArray(btsOrdersTable.userId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  if (partnerIds.length > 0) {
    await db.delete(partnerAssignmentsTable).where(inArray(partnerAssignmentsTable.partnerId, partnerIds));
    await db.delete(partnersTable).where(inArray(partnersTable.id, partnerIds));
  }
});

describe("DELETE /api/admin/members/:id", () => {
  it("returns 403 for a non-super-admin admin", async () => {
    const target = await insertUser("member", `rbac-target-${randomUUID().slice(0, 6)}`);

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", regularAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(403);

    const [stillThere] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(stillThere).toBeDefined();
  });

  it("refuses with 422 and does not delete an admin-role account, even for a super-admin caller", async () => {
    const target = await insertUser("admin", `role-guard-admin-${randomUUID().slice(0, 6)}`);

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(422);

    const [stillThere] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(stillThere).toBeDefined();
  });

  it("refuses with 422 and does not delete a super_admin-role account", async () => {
    const target = await insertUser("super_admin", `role-guard-superadmin-${randomUUID().slice(0, 6)}`);

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(422);

    const [stillThere] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(stillThere).toBeDefined();
  });

  it("refuses with 422 and does not delete a coach-role account", async () => {
    const target = await insertUser("coach", `role-guard-coach-${randomUUID().slice(0, 6)}`);

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(422);

    const [stillThere] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(stillThere).toBeDefined();
  });

  it("refuses with 422 and does not delete a partner-role account", async () => {
    const target = await insertUser("partner", `role-guard-partner-${randomUUID().slice(0, 6)}`);

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(422);

    const [stillThere] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(stillThere).toBeDefined();
  });

  it("refuses with 422 when the member has ad-spend transaction history", async () => {
    const target = await insertUser("member", `finhist-adspend-${randomUUID().slice(0, 6)}`);
    await db.insert(adSpendTransactionsTable).values({
      userId: target.id,
      amountCents: 1000,
      type: "funding",
      source: "nmi",
      nmiTransactionId: `${TEST_TAG}-tx-${randomUUID().slice(0, 8)}`,
    });

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(422);
    expect(res.body.financialHistory.adSpendTransactions).toBeGreaterThan(0);

    const [stillThere] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(stillThere).toBeDefined();
  });

  it("refuses with 422 when the member has a refund/chargeback event", async () => {
    const target = await insertUser("member", `finhist-refund-${randomUUID().slice(0, 6)}`);
    await db.insert(memberRefundEventsTable).values({
      memberId: target.id,
      type: "refund",
      amountCents: 500,
      nmiTransactionId: `${TEST_TAG}-refund-${randomUUID().slice(0, 8)}`,
      occurredAt: new Date(),
    });

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(422);
    expect(res.body.financialHistory.refundEvents).toBeGreaterThan(0);

    const [stillThere] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(stillThere).toBeDefined();
  });

  it("refuses with 422 when the member has a bts_orders row", async () => {
    const target = await insertUser("member", `finhist-order-${randomUUID().slice(0, 6)}`);
    await db.insert(btsOrdersTable).values({
      orderNumber: `${TEST_TAG}-order-${randomUUID().slice(0, 8)}`,
      userId: target.id,
      email: target.email,
      totalCents: 9900,
      status: "paid",
      orderType: "one_time",
    });

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(422);
    expect(res.body.financialHistory.orders).toBeGreaterThan(0);

    const [stillThere] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(stillThere).toBeDefined();
  });

  it("aborts entirely (nothing deleted) when a GHL cancel fails, and the failed booking stays booked", async () => {
    const target = await insertUser("member", `ghl-fail-${randomUUID().slice(0, 6)}`);
    const [booking] = await db
      .insert(callBookingsTable)
      .values({
        memberId: target.id,
        staffType: "partner",
        staffId: 0,
        type: "partner",
        ghlCalendarId: `${TEST_TAG}-cal`,
        ghlAppointmentId: `${TEST_TAG}-appt-${randomUUID().slice(0, 8)}`,
        ghlLocationId: "loc_test_specific",
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
        durationMinutes: 30,
        status: "booked",
      })
      .returning({ id: callBookingsTable.id });

    cancelAppointmentMock.mockImplementationOnce(async () => {
      throw new Error("GHL cancel failed (simulated)");
    });

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(502);
    expect(res.body.failedBookingId).toBe(booking.id);

    // Nothing should have been deleted — user, booking all intact.
    const [stillThere] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(stillThere).toBeDefined();
    const [stillBooked] = await db
      .select()
      .from(callBookingsTable)
      .where(eq(callBookingsTable.id, booking.id));
    expect(stillBooked).toBeDefined();
    expect(stillBooked.status).toBe("booked");

    await db.delete(callBookingsTable).where(eq(callBookingsTable.id, booking.id));
  });

  it("cancels booked calls via GHL using the booking's own location, ends the active partner assignment, keeps the round-robin count correct, deletes all rows, and writes one audit log entry", async () => {
    const target = await insertUser("member", `happy-path-${randomUUID().slice(0, 6)}`);
    const partnerA = await insertPartner(`a-${randomUUID().slice(0, 6)}`);

    const beforeActiveCount = await activeAssignmentCount(partnerA);

    const [assignment] = await db
      .insert(partnerAssignmentsTable)
      .values({ memberId: target.id, partnerId: partnerA, status: "active" })
      .returning({ id: partnerAssignmentsTable.id });

    await db.insert(partnerNotesTable).values({
      memberId: target.id,
      authorPartnerId: partnerA,
      body: "Test note for deletion",
    });

    const ghlAppointmentId = `${TEST_TAG}-appt-${randomUUID().slice(0, 8)}`;
    const [booking] = await db
      .insert(callBookingsTable)
      .values({
        memberId: target.id,
        staffType: "partner",
        staffId: partnerA,
        type: "partner",
        ghlCalendarId: `${TEST_TAG}-cal`,
        ghlAppointmentId,
        ghlLocationId: "loc_test_specific",
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
        durationMinutes: 30,
        status: "booked",
      })
      .returning({ id: callBookingsTable.id });

    cancelAppointmentMock.mockClear();

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.counts.callBookingsCanceled).toBe(1);
    expect(res.body.counts.activeAssignmentsEnded).toBe(1);
    expect(res.body.counts.partnerNotesDeleted).toBe(1);
    expect(res.body.counts.callBookingsDeleted).toBe(1);

    // GHL was called with the booking's OWN location, not the global default.
    expect(cancelAppointmentMock).toHaveBeenCalledTimes(1);
    expect(cancelAppointmentMock).toHaveBeenCalledWith(ghlAppointmentId, "loc_test_specific");

    // The user row and all dependent rows are gone.
    const [userRow] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(userRow).toBeUndefined();
    const remainingBookings = await db
      .select()
      .from(callBookingsTable)
      .where(eq(callBookingsTable.memberId, target.id));
    expect(remainingBookings).toHaveLength(0);
    const remainingNotes = await db
      .select()
      .from(partnerNotesTable)
      .where(eq(partnerNotesTable.memberId, target.id));
    expect(remainingNotes).toHaveLength(0);

    // The assignment was ended (not silently vanished) before removal, so the
    // partner's active count returns to what it was before this test's
    // assignment was created — round-robin math stays correct for anyone
    // else concurrently reading active counts.
    const afterActiveCount = await activeAssignmentCount(partnerA);
    expect(afterActiveCount).toBe(beforeActiveCount);

    const [endedRow] = await db
      .select()
      .from(partnerAssignmentsTable)
      .where(eq(partnerAssignmentsTable.id, assignment.id));
    expect(endedRow).toBeUndefined(); // deleted after being ended, per the pipeline

    // Exactly one audit log entry for this deletion.
    const auditRows = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, "delete_member"),
          eq(auditLogTable.entityType, "user"),
          eq(auditLogTable.entityId, String(target.id)),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorId).toBe(superAdminId);
    const metadata = auditRows[0].metadata as { callBookingsCanceled: number; activeAssignmentsEnded: number };
    expect(metadata.callBookingsCanceled).toBe(1);
    expect(metadata.activeAssignmentsEnded).toBe(1);
  });

  it("rejects with 400 when the confirmation email does not match", async () => {
    const target = await insertUser("member", `bad-confirm-${randomUUID().slice(0, 6)}`);

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: "not-the-right-email@example.test" });

    expect(res.status).toBe(400);

    const [stillThere] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(stillThere).toBeDefined();
  });

  it("rejects with 400 when the confirmation email differs only by case (exact match required)", async () => {
    const target = await insertUser("member", `case-confirm-${randomUUID().slice(0, 6)}`);

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email.toUpperCase() });

    expect(res.status).toBe(400);

    const [stillThere] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(stillThere).toBeDefined();
  });

  it("aborts with 502 when a booked call has no GHL appointment id (cannot be verified as canceled)", async () => {
    const target = await insertUser("member", `no-appt-id-${randomUUID().slice(0, 6)}`);
    const [booking] = await db
      .insert(callBookingsTable)
      .values({
        memberId: target.id,
        staffType: "partner",
        staffId: 0,
        type: "partner",
        ghlCalendarId: `${TEST_TAG}-cal`,
        ghlAppointmentId: null,
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
        durationMinutes: 30,
        status: "booked",
      })
      .returning({ id: callBookingsTable.id });

    cancelAppointmentMock.mockClear();

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(502);
    expect(res.body.failedBookingId).toBe(booking.id);
    expect(cancelAppointmentMock).not.toHaveBeenCalled();

    const [stillThere] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(stillThere).toBeDefined();

    await db.delete(callBookingsTable).where(eq(callBookingsTable.id, booking.id));
  });
});

describe("GET /api/admin/members/:id/delete-eligibility", () => {
  it("returns 403 for a non-super-admin admin", async () => {
    const target = await insertUser("member", `elig-rbac-${randomUUID().slice(0, 6)}`);
    const res = await request(app)
      .get(`/api/admin/members/${target.id}/delete-eligibility`)
      .set("Cookie", regularAdminCookie);
    expect(res.status).toBe(403);
  });

  it("reports eligible:true with zero financial history for a clean member", async () => {
    const target = await insertUser("member", `elig-clean-${randomUUID().slice(0, 6)}`);
    const res = await request(app)
      .get(`/api/admin/members/${target.id}/delete-eligibility`)
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(true);
    expect(res.body.blockedReason).toBeNull();
    expect(res.body.financialHistory).toEqual({
      adSpendTransactions: 0,
      refundEvents: 0,
      orders: 0,
    });
  });

  it("reports eligible:false with a reason when financial history exists", async () => {
    const target = await insertUser("member", `elig-blocked-${randomUUID().slice(0, 6)}`);
    await db.insert(adSpendTransactionsTable).values({
      userId: target.id,
      amountCents: 250,
      type: "funding",
      source: "nmi",
      nmiTransactionId: `${TEST_TAG}-elig-tx-${randomUUID().slice(0, 8)}`,
    });

    const res = await request(app)
      .get(`/api/admin/members/${target.id}/delete-eligibility`)
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(false);
    expect(res.body.blockedReason).toBeTruthy();
  });

  it("reports eligible:false (200) with a role-specific reason for a non-member (e.g. coach) account", async () => {
    const target = await insertUser("coach", `elig-role-coach-${randomUUID().slice(0, 6)}`);
    const res = await request(app)
      .get(`/api/admin/members/${target.id}/delete-eligibility`)
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(false);
    expect(res.body.blockedReason).toBeTruthy();
    expect(res.body.preview).toBeNull();
  });

  it("reports eligible:false (200) for an admin-role account", async () => {
    const target = await insertUser("admin", `elig-role-admin-${randomUUID().slice(0, 6)}`);
    const res = await request(app)
      .get(`/api/admin/members/${target.id}/delete-eligibility`)
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(false);
  });
});

describe("DELETE /api/admin/members/:id — communication_log and comprehensive cleanup", () => {
  it("successfully deletes a member who has communication_log rows (the prod-failure case)", async () => {
    const target = await insertUser("member", `comm-log-${randomUUID().slice(0, 6)}`);

    // Insert communication_log rows mimicking welcome + onboarding emails
    await db.insert(communicationLogTable).values([
      {
        userId: target.id,
        channel: "email",
        category: "transactional",
        templateSlug: "welcome",
        status: "delivered",
        recipientEmail: target.email,
        subject: "Welcome",
      },
      {
        userId: target.id,
        channel: "email",
        category: "marketing",
        templateSlug: "onboarding_day1",
        status: "delivered",
        recipientEmail: target.email,
        subject: "Day 1",
      },
    ]);

    cancelAppointmentMock.mockClear();

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.counts.communicationLogDeleted).toBe(2);

    // User row must be gone
    const [userRow] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(userRow).toBeUndefined();

    // communication_log rows must be gone
    const commRows = await db
      .select()
      .from(communicationLogTable)
      .where(eq(communicationLogTable.userId, target.id));
    expect(commRows).toHaveLength(0);
  });

  it("treats a GHL 404 (already-cancelled) as success so a retry after a rolled-back attempt can proceed", async () => {
    const target = await insertUser("member", `ghl-404-retry-${randomUUID().slice(0, 6)}`);
    const ghlAppointmentId = `${TEST_TAG}-appt-404-${randomUUID().slice(0, 8)}`;
    await db.insert(callBookingsTable).values({
      memberId: target.id,
      staffType: "partner",
      staffId: 0,
      type: "partner",
      ghlCalendarId: `${TEST_TAG}-cal`,
      ghlAppointmentId,
      ghlLocationId: "loc_test_specific",
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
      durationMinutes: 30,
      status: "booked",
    });

    // Simulate a "already cancelled on GHL" 404 — as would happen on a retry
    // after a prior attempt that cancelled the GHL appointment but then had
    // its DB transaction rolled back.
    cancelAppointmentMock.mockImplementationOnce(async () => {
      throw new Error(`GHL DELETE /calendars/events/${ghlAppointmentId} failed: HTTP 404 — {"message":"Not Found"}`);
    });

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // callBookingsCanceled should count the 404 as a successful cancel
    expect(res.body.counts.callBookingsCanceled).toBe(1);

    // User row must be gone
    const [userRow] = await db.select().from(usersTable).where(eq(usersTable.id, target.id));
    expect(userRow).toBeUndefined();
  });
});

describe("DELETE /api/admin/members/:id — ticket and community transitive FK cleanup", () => {
  it("deletes a member who has tickets with sla + attachment child rows (transitive FK chain)", async () => {
    const target = await insertUser("member", `ticket-chain-${randomUUID().slice(0, 6)}`);

    cancelAppointmentMock.mockClear();

    // Create a ticket for the member
    const [ticket] = await db
      .insert(ticketsTable)
      .values({
        userId: target.id,
        ticketNumber: `TEST-${randomUUID().slice(0, 8).toUpperCase()}`,
        subject: "Test issue",
        status: "open",
      })
      .returning({ id: ticketsTable.id });

    // Add a ticket_sla row (references ticket_id, NO ACTION)
    await db.insert(ticketSlaTable).values({
      ticketId: ticket.id,
      tierSlug: "standard",
      firstResponseTargetMinutes: 240,
      resolutionTargetMinutes: 1440,
    });

    // Add a ticket_attachment row (references ticket_id AND optionally message_id, NO ACTION)
    await db.insert(ticketAttachmentsTable).values({
      ticketId: ticket.id,
      objectPath: "/objects/test-file.pdf",
      fileName: "test-file.pdf",
    });

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.counts.ticketsDeleted).toBe(1);

    // Verify no orphaned sla or attachment rows remain
    const slaRows = await db.select().from(ticketSlaTable).where(eq(ticketSlaTable.ticketId, ticket.id));
    expect(slaRows).toHaveLength(0);
    const attachRows = await db.select().from(ticketAttachmentsTable).where(eq(ticketAttachmentsTable.ticketId, ticket.id));
    expect(attachRows).toHaveLength(0);
  });
});

describe("DELETE /api/admin/members/:id — FK abort surfacing", () => {
  it("surfaces a residual 23503 FK violation as 409 with constraint + table, not a bare 500", async () => {
    const target = await insertUser("member", `fk-surf-${randomUUID().slice(0, 6)}`);

    // Simulate a DrizzleQueryError wrapping a Postgres 23503 error —
    // the kind thrown when a table is not in the delete pipeline.
    // error.cause holds the raw pg error with .code/.constraint/.table.
    const fakeErr = Object.assign(new Error("FK violation (simulated)"), {
      cause: Object.assign(new Error("FK"), {
        code: "23503",
        constraint: "unclassified_table_user_id_fk",
        table: "unclassified_table",
      }),
    });
    const txSpy = vi.spyOn(db, "transaction").mockImplementationOnce(() => { throw fakeErr; });

    const res = await request(app)
      .delete(`/api/admin/members/${target.id}`)
      .set("Cookie", superAdminCookie)
      .send({ confirmEmail: target.email });

    txSpy.mockRestore();

    // Clean up: the delete did not execute so the user still exists
    await db.delete(usersTable).where(eq(usersTable.id, target.id));

    expect(res.status).toBe(409);
    expect(res.body.constraint).toBe("unclassified_table_user_id_fk");
    expect(res.body.table).toBe("unclassified_table");
    expect(res.body.pgCode).toBe("23503");
    expect(res.body.error).toContain("unclassified_table_user_id_fk");
  });
});

describe("FK exhaustiveness guard — every FK referencing users must be classified", () => {
  // This test queries information_schema for ALL foreign key constraints that
  // reference the users table and asserts that each one appears in the
  // classification list below. If a future migration adds a new FK to users
  // without classifying it in the delete pipeline, this test breaks CI loudly
  // (rather than surfacing as a silent 23503 in production).
  //
  // Classification codes:
  //   CASCADE      – Postgres auto-deletes/nulls on user deletion; no pipeline action needed
  //   SET_NULL     – Postgres sets the FK column to NULL; no pipeline action needed
  //   FINANCIAL    – blocked by the financial-history pre-flight guard
  //   STAFF_REF    – blocked by the staff-reference pre-flight guard
  //   PIPELINE     – explicitly deleted/handled inside the delete transaction
  it("every FK constraint referencing users.id is classified in the delete pipeline", async () => {
    const result = await db.execute(sql`
      SELECT tc.constraint_name, tc.table_name, kcu.column_name, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'users'
        AND tc.table_schema = 'public'
      ORDER BY tc.constraint_name
    `);

    const knownConstraints = new Set<string>([
      // --- CASCADE: auto-handled by Postgres ---
      "email_change_attempts_user_id_users_id_fk",
      "email_change_history_user_id_users_id_fk",
      "payment_methods_user_id_fkey",
      "phone_change_history_user_id_users_id_fk",
      "sessions_user_id_users_id_fk",
      // --- SET NULL: auto-handled by Postgres ---
      "app_global_settings_updated_by_id_users_id_fk",
      "coaches_user_id_users_id_fk",
      "coaching_calls_cancelled_by_users_id_fk",
      "email_change_attempts_cancelled_by_admin_id_users_id_fk",
      "kb_proposed_tool_tags_reviewed_by_fkey",
      "kb_tool_tags_created_by_fkey",
      "kb_triage_audit_log_actor_user_id_fkey",
      "kickoff_coaches_user_id_fkey",
      "partners_user_id_fkey",
      "upgrade_prompt_events_user_id_users_id_fk",
      // --- FINANCIAL_GUARD: blocked before any DB/GHL action ---
      "ad_spend_transactions_user_id_fkey",
      "bts_orders_user_id_fkey",
      "member_refund_events_member_id_fkey",
      // --- STAFF_REF: blocked by staff-reference pre-flight ---
      "admin_notes_author_id_users_id_fk",
      "api_keys_created_by_id_users_id_fk",
      "api_keys_revoked_by_id_users_id_fk",
      "audit_log_actor_id_users_id_fk",
      "broadcasts_created_by_users_id_fk",
      "coaching_credit_ledger_created_by_user_id_users_id_fk",
      "coach_google_connections_user_id_users_id_fk",
      "dm_threads_admin_id_users_id_fk",
      "email_template_versions_saved_by_users_id_fk",
      "kb_staging_docs_reviewed_by_users_id_fk",
      "moderation_queue_reviewed_by_users_id_fk",
      "ticket_routing_rules_assign_to_user_id_users_id_fk",
      "tickets_assigned_to_users_id_fk",
      "wins_featured_by_users_id_fk",
      "wins_testimonial_approved_by_users_id_fk",
      // --- PIPELINE: explicitly deleted inside the delete transaction ---
      "admin_notes_user_id_users_id_fk",
      "affiliate_profiles_user_id_users_id_fk",
      "blitz_daily_activity_user_id_users_id_fk",
      "blitz_events_user_id_users_id_fk",
      "call_bookings_member_id_fkey",
      "chat_daily_usage_user_id_users_id_fk",
      "chat_prompts_user_id_users_id_fk",
      "chat_sessions_user_id_users_id_fk",
      "checkout_idempotency_user_id_fkey",
      "coaching_call_attendance_user_id_users_id_fk",
      "coaching_credit_ledger_member_id_users_id_fk",
      "communication_log_user_id_users_id_fk",
      "community_badges_user_id_users_id_fk",
      "community_comments_author_id_users_id_fk",
      "community_notifications_actor_id_users_id_fk",
      "community_notifications_user_id_users_id_fk",
      "community_posts_author_id_users_id_fk",
      "community_reactions_user_id_users_id_fk",
      "course_progress_user_id_users_id_fk",
      "dm_messages_sender_id_users_id_fk",
      "dm_threads_member_id_users_id_fk",
      "email_unsubscribes_user_id_users_id_fk",
      "ghl_sync_log_user_id_users_id_fk",
      "knowledgebase_bookmarks_user_id_fkey",
      "member_app_instances_user_id_users_id_fk",
      "member_health_scores_user_id_users_id_fk",
      "moderation_queue_author_id_users_id_fk",
      "onboarding_effects_user_id_fkey",
      "partner_assignments_member_id_fkey",
      "partner_notes_member_id_fkey",
      "progress_user_id_users_id_fk",
      "sequence_enrollments_user_id_users_id_fk",
      "session_pack_bookings_member_id_users_id_fk",
      "signed_documents_user_id_users_id_fk",
      "subscriptions_user_id_fkey",
      "ticket_satisfaction_user_id_users_id_fk",
      "tickets_user_id_users_id_fk",
      "tool_daily_usage_user_id_users_id_fk",
      "tool_usage_log_user_id_users_id_fk",
      "tool_user_data_user_id_users_id_fk",
      "user_products_user_id_users_id_fk",
      "user_strikes_user_id_users_id_fk",
      "vault_favorites_user_id_users_id_fk",
      "voice_calls_user_id_fkey",
      "voice_daily_usage_user_id_fkey",
      "wins_user_id_users_id_fk",
    ]);

    // db.execute() returns { rows: [...] }, not a direct array.
    const rows = (result as unknown as { rows: { constraint_name: string; table_name: string; column_name: string; delete_rule: string }[] }).rows;
    const unclassified: string[] = [];
    for (const row of rows) {
      if (!knownConstraints.has(row.constraint_name)) {
        unclassified.push(`${row.constraint_name} (${row.table_name}.${row.column_name}, delete_rule=${row.delete_rule})`);
      }
    }

    if (unclassified.length > 0) {
      throw new Error(
        `The following FK constraints referencing users are NOT classified in the delete pipeline:\n` +
        unclassified.map((c) => `  - ${c}`).join("\n") +
        `\n\nAdd each one to the knownConstraints set in admin-member-delete.test.ts with the appropriate classification code, AND ensure it is handled (deleted, guarded, or SET NULL/CASCADE) in the delete pipeline in admin-panel.ts.`,
      );
    }

    expect(unclassified).toHaveLength(0);
  });
});
