/**
 * FE-Intensive booking routes — gating + flow tests (mocked GHL).
 *
 * Assertions:
 *   1. Born enforced   — 401 unauthenticated, 403 no-product member,
 *                        200 FE-owner, 200 admin bypass on /fe-intensive/status.
 *   2. Dormant config  — settings unset ⇒ status/availability report
 *                        configured:false (Welcome page keeps pending state).
 *   3. Availability    — configured ⇒ mocked free slots + calendar duration.
 *   4. Book            — creates a local fe_intensive_bookings row, calls
 *                        upsertContact + createAppointment with the member's
 *                        account identity; a second book is an idempotent
 *                        alreadyBooked replay, not a duplicate.
 *   5. Cancel          — cancels GHL first, flips the row to canceled;
 *                        repeat cancel is alreadyCanceled.
 *
 * Isolation (SHARED DEV DB): the two fe_intensive_* system_settings rows are
 * snapshotted in beforeAll and restored verbatim in afterAll; seeded users,
 * grants and booking rows are deleted. Run with --pool=threads
 * --no-file-parallelism like the other DB suites.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  contentAccessMapTable,
  systemSettingsTable,
  feIntensiveBookingsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/ghl-coaching-calendar", () => ({
  getFreeSlots: vi.fn(),
  getCalendarDurationMinutes: vi.fn(),
  upsertContact: vi.fn(),
  createAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
}));

import {
  getFreeSlots,
  getCalendarDurationMinutes,
  upsertContact,
  createAppointment,
  cancelAppointment,
} from "../lib/ghl-coaching-calendar";
import { buildTestAppWithRouters } from "./test-app";
import feIntensiveBookingRouter from "../routes/fe-intensive-booking";
import {
  FE_INTENSIVE_CALENDAR_SETTING_KEY,
  FE_INTENSIVE_LOCATION_SETTING_KEY,
} from "../lib/fe-intensive-settings";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `fe-intensive-${randomUUID().slice(0, 8)}`;
const PAGE_KEY = "frontend-welcome";
const TEST_CALENDAR_ID = `${TAG}-cal`;
const TEST_LOCATION_ID = `${TAG}-loc`;

const SETTING_KEYS = [FE_INTENSIVE_CALENDAR_SETTING_KEY, FE_INTENSIVE_LOCATION_SETTING_KEY];

const mockGetFreeSlots = vi.mocked(getFreeSlots);
const mockGetDuration = vi.mocked(getCalendarDurationMinutes);
const mockUpsertContact = vi.mocked(upsertContact);
const mockCreateAppointment = vi.mocked(createAppointment);
const mockCancelAppointment = vi.mocked(cancelAppointment);

const seededUserIds: number[] = [];
let noProductUserId: number;
let ownerUserId: number;
let adminUserId: number;
let noProductCookie: string;
let ownerCookie: string;
let adminCookie: string;
let ownerEmail: string;

let settingsSnapshot: (typeof systemSettingsTable.$inferSelect)[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function setConfig(calendarId: string | null, locationId?: string) {
  await db.delete(systemSettingsTable).where(inArray(systemSettingsTable.key, SETTING_KEYS));
  if (calendarId) {
    await db.insert(systemSettingsTable).values([
      { key: FE_INTENSIVE_CALENDAR_SETTING_KEY, value: calendarId, category: "booking" },
      ...(locationId
        ? [{ key: FE_INTENSIVE_LOCATION_SETTING_KEY, value: locationId, category: "booking" }]
        : []),
    ]);
  }
}

/** A slot start comfortably beyond the 1-hour lead time. */
function futureSlotIso(hoursAhead = 26): string {
  const d = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

beforeAll(async () => {
  app = buildTestAppWithRouters([feIntensiveBookingRouter]);

  // Snapshot any pre-existing fe_intensive settings rows (restored verbatim).
  settingsSnapshot = await db
    .select()
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, SETTING_KEYS));

  // Owner product: first slug on the frontend-welcome map row (boot-seeded).
  const [mapRow] = await db
    .select({ productSlugs: contentAccessMapTable.productSlugs })
    .from(contentAccessMapTable)
    .where(eq(contentAccessMapTable.pageKey, PAGE_KEY));
  if (!mapRow || mapRow.productSlugs.length === 0) {
    throw new Error(`content_access_map has no populated row for "${PAGE_KEY}" — boot seed missing.`);
  }
  const ownerSlug = mapRow.productSlugs[0];
  const [ownerProduct] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, ownerSlug));
  if (!ownerProduct) throw new Error(`Product "${ownerSlug}" not found`);

  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const mkUser = async (label: string, role: string) => {
    const email = `${TAG}-${label}@example.test`;
    const [u] = await db
      .insert(usersTable)
      .values({
        name: `FE Test ${label}`,
        email,
        passwordHash,
        role,
        sourceProduct: "bts",
        emailVerified: true,
      })
      .returning({ id: usersTable.id });
    seededUserIds.push(u.id);
    return { id: u.id, email };
  };

  const np = await mkUser("noproduct", "member");
  noProductUserId = np.id;
  noProductCookie = signCookie(np.id, np.email);

  const owner = await mkUser("owner", "member");
  ownerUserId = owner.id;
  ownerEmail = owner.email;
  ownerCookie = signCookie(owner.id, owner.email);
  await db.insert(userProductsTable).values({
    userId: owner.id,
    productId: ownerProduct.id,
    status: "active",
  });

  const admin = await mkUser("admin", "admin");
  adminUserId = admin.id;
  adminCookie = signCookie(admin.id, admin.email);
});

afterAll(async () => {
  await db
    .delete(feIntensiveBookingsTable)
    .where(inArray(feIntensiveBookingsTable.memberId, seededUserIds));
  await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
  await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  // Restore settings exactly as found.
  await db.delete(systemSettingsTable).where(inArray(systemSettingsTable.key, SETTING_KEYS));
  if (settingsSnapshot.length > 0) {
    await db.insert(systemSettingsTable).values(settingsSnapshot);
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDuration.mockResolvedValue(60);
  mockUpsertContact.mockResolvedValue("contact-123");
  mockCreateAppointment.mockResolvedValue({ id: `appt-${randomUUID().slice(0, 8)}` } as any);
  mockCancelAppointment.mockResolvedValue(undefined as any);
});

describe("gating (born enforced)", () => {
  it("401s unauthenticated", async () => {
    const res = await request(app).get("/api/fe-intensive/status");
    expect(res.status).toBe(401);
  });

  it("403s a member with no products", async () => {
    const res = await request(app)
      .get("/api/fe-intensive/status")
      .set("Cookie", noProductCookie);
    expect(res.status).toBe(403);
  });

  it("200s an FE owner", async () => {
    const res = await request(app).get("/api/fe-intensive/status").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
  });

  it("200s an admin (role bypass)", async () => {
    const res = await request(app).get("/api/fe-intensive/status").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
  });
});

describe("dormant until configured", () => {
  beforeEach(async () => {
    await setConfig(null);
  });

  it("status reports configured:false with no booking", async () => {
    const res = await request(app).get("/api/fe-intensive/status").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, booking: null });
  });

  it("availability reports configured:false and never calls GHL", async () => {
    const res = await request(app)
      .get("/api/fe-intensive/availability")
      .set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(mockGetFreeSlots).not.toHaveBeenCalled();
  });

  it("book is refused while unconfigured", async () => {
    const res = await request(app)
      .post("/api/fe-intensive/book")
      .set("Cookie", ownerCookie)
      .send({ startTime: futureSlotIso() });
    expect(res.status).toBe(409);
  });
});

describe("configured flow", () => {
  beforeAll(async () => {
    await setConfig(TEST_CALENDAR_ID, TEST_LOCATION_ID);
  });

  beforeEach(async () => {
    await db
      .delete(feIntensiveBookingsTable)
      .where(inArray(feIntensiveBookingsTable.memberId, seededUserIds));
  });

  it("availability returns mocked slots + duration", async () => {
    const slot = futureSlotIso();
    mockGetFreeSlots.mockResolvedValue([{ startTime: slot }]);
    const res = await request(app)
      .get("/api/fe-intensive/availability")
      .set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      slots: [{ startTime: slot }],
      durationMinutes: 60,
    });
    expect(mockGetFreeSlots).toHaveBeenCalledWith(
      TEST_CALENDAR_ID,
      expect.any(Number),
      expect.any(Number),
      TEST_LOCATION_ID,
    );
  });

  it("availability GHL failure → 502 friendly error", async () => {
    mockGetFreeSlots.mockRejectedValue(new Error("GHL down"));
    const res = await request(app)
      .get("/api/fe-intensive/availability")
      .set("Cookie", ownerCookie);
    expect(res.status).toBe(502);
    expect(typeof res.body.error).toBe("string");
  });

  it("book creates a local row with account identity prefilled", async () => {
    const slot = futureSlotIso();
    mockGetFreeSlots.mockResolvedValue([{ startTime: slot }]);

    const res = await request(app)
      .post("/api/fe-intensive/book")
      .set("Cookie", ownerCookie)
      .send({ startTime: slot });
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ status: "booked", durationMinutes: 60 });

    expect(mockUpsertContact).toHaveBeenCalledWith(
      expect.objectContaining({ email: ownerEmail, locationId: TEST_LOCATION_ID }),
    );
    expect(mockCreateAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: TEST_CALENDAR_ID,
        contactId: "contact-123",
        startTime: slot,
      }),
    );

    const rows = await db
      .select()
      .from(feIntensiveBookingsTable)
      .where(eq(feIntensiveBookingsTable.memberId, ownerUserId));
    expect(rows).toHaveLength(1);
    expect(rows[0].ghlCalendarId).toBe(TEST_CALENDAR_ID);

    // Status now surfaces the booking (booked-state UI source of truth).
    const status = await request(app).get("/api/fe-intensive/status").set("Cookie", ownerCookie);
    expect(status.body.configured).toBe(true);
    expect(status.body.booking?.id).toBe(rows[0].id);
  });

  it("second book replays idempotently instead of duplicating", async () => {
    const slot = futureSlotIso();
    mockGetFreeSlots.mockResolvedValue([{ startTime: slot }]);
    const first = await request(app)
      .post("/api/fe-intensive/book")
      .set("Cookie", ownerCookie)
      .send({ startTime: slot });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/fe-intensive/book")
      .set("Cookie", ownerCookie)
      .send({ startTime: futureSlotIso(50) });
    expect(second.status).toBe(200);
    expect(second.body.alreadyBooked).toBe(true);
    expect(mockCreateAppointment).toHaveBeenCalledTimes(1);
  });

  it("book 409s when the slot vanished from GHL", async () => {
    mockGetFreeSlots.mockResolvedValue([]);
    const res = await request(app)
      .post("/api/fe-intensive/book")
      .set("Cookie", ownerCookie)
      .send({ startTime: futureSlotIso() });
    expect(res.status).toBe(409);
    expect(mockCreateAppointment).not.toHaveBeenCalled();
  });

  it("cancel cancels GHL first then flips the row; repeat is alreadyCanceled", async () => {
    const slot = futureSlotIso();
    mockGetFreeSlots.mockResolvedValue([{ startTime: slot }]);
    const booked = await request(app)
      .post("/api/fe-intensive/book")
      .set("Cookie", ownerCookie)
      .send({ startTime: slot });
    const bookingId = booked.body.booking.id as number;

    const res = await request(app)
      .post("/api/fe-intensive/cancel")
      .set("Cookie", ownerCookie)
      .send({ bookingId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ canceled: true, alreadyCanceled: false });
    expect(mockCancelAppointment).toHaveBeenCalledTimes(1);

    const [row] = await db
      .select()
      .from(feIntensiveBookingsTable)
      .where(eq(feIntensiveBookingsTable.id, bookingId));
    expect(row.status).toBe("canceled");
    expect(row.cancelledAt).not.toBeNull();

    const again = await request(app)
      .post("/api/fe-intensive/cancel")
      .set("Cookie", ownerCookie)
      .send({ bookingId });
    expect(again.status).toBe(200);
    expect(again.body.alreadyCanceled).toBe(true);
  });

  it("cancel keeps the row booked when GHL cancel fails (no phantom cancel)", async () => {
    const slot = futureSlotIso();
    mockGetFreeSlots.mockResolvedValue([{ startTime: slot }]);
    const booked = await request(app)
      .post("/api/fe-intensive/book")
      .set("Cookie", ownerCookie)
      .send({ startTime: slot });
    const bookingId = booked.body.booking.id as number;

    mockCancelAppointment.mockRejectedValue(new Error("GHL down"));
    const res = await request(app)
      .post("/api/fe-intensive/cancel")
      .set("Cookie", ownerCookie)
      .send({ bookingId });
    expect(res.status).toBe(502);

    const [row] = await db
      .select()
      .from(feIntensiveBookingsTable)
      .where(eq(feIntensiveBookingsTable.id, bookingId));
    expect(row.status).toBe("booked");
  });

  it("simultaneous cancels: exactly one wins, GHL is called once", async () => {
    const slot = futureSlotIso();
    mockGetFreeSlots.mockResolvedValue([{ startTime: slot }]);
    const booked = await request(app)
      .post("/api/fe-intensive/book")
      .set("Cookie", ownerCookie)
      .send({ startTime: slot });
    const bookingId = booked.body.booking.id as number;

    const [a, b] = await Promise.all([
      request(app).post("/api/fe-intensive/cancel").set("Cookie", ownerCookie).send({ bookingId }),
      request(app).post("/api/fe-intensive/cancel").set("Cookie", ownerCookie).send({ bookingId }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const winners = [a.body, b.body].filter((r) => r.alreadyCanceled === false);
    expect(winners).toHaveLength(1);
    expect(mockCancelAppointment).toHaveBeenCalledTimes(1);
  });

  it("cannot cancel another member's booking", async () => {
    const slot = futureSlotIso();
    mockGetFreeSlots.mockResolvedValue([{ startTime: slot }]);
    const booked = await request(app)
      .post("/api/fe-intensive/book")
      .set("Cookie", ownerCookie)
      .send({ startTime: slot });
    const bookingId = booked.body.booking.id as number;

    const res = await request(app)
      .post("/api/fe-intensive/cancel")
      .set("Cookie", adminCookie)
      .send({ bookingId });
    expect(res.status).toBe(404);
  });
});
