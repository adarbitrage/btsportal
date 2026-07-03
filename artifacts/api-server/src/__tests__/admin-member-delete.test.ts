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
