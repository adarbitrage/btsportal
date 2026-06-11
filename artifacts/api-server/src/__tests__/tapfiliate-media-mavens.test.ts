import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, mediaMavensProductsTable } from "@workspace/db";
import { inArray, eq, like } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminMediaMavensProductsRouter from "../routes/admin-media-mavens-products";
import mediaMavensLinksRouter from "../routes/media-mavens-links";

vi.mock("../lib/tapfiliate", () => ({
  TapfiliateConfigError: class TapfiliateConfigError extends Error {
    constructor() {
      super("TAPFILIATE_API_KEY is not configured.");
      this.name = "TapfiliateConfigError";
    }
  },
  TapfiliateApiError: class TapfiliateApiError extends Error {
    constructor(public status: number, message: string) {
      super(`Tapfiliate API error ${status}: ${message}`);
      this.name = "TapfiliateApiError";
    }
  },
  findAffiliateByEmail: vi.fn(),
  createAffiliate: vi.fn(),
  listPrograms: vi.fn(),
  enrollAffiliateInProgram: vi.fn(),
  getAffiliateReferralLinks: vi.fn(),
}));

vi.mock("../lib/tapfiliate-cache", () => ({
  getCachedReferralUrl: vi.fn(),
  setCachedReferralUrl: vi.fn(),
  invalidateCachedReferralUrlsByProgram: vi.fn(),
}));

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `tapfil-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let memberId: number;
let memberEmail: string;

async function seedUser(opts: { email: string; name: string; role?: string }): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: opts.email,
      name: opts.name,
      passwordHash,
      role: opts.role ?? "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function seedProduct(slug: string, tapfiliateProgramId: string | null = null): Promise<number> {
  const [row] = await db
    .insert(mediaMavensProductsTable)
    .values({
      slug,
      name: `Test Product ${slug}`,
      tagline: "Test tagline",
      category: "Health",
      description: "Test desc",
      costToConsumer: "$99",
      affiliateCommission: "$50 CPA",
      salesPageUrl: "https://example.com",
      logoDriveUrl: "https://drive.google.com/test",
      affiliateLink: `https://example.com?ref=youraffiliateid`,
      tapfiliateProgramId,
      tapfiliateProgramTitle: tapfiliateProgramId ? "Test Program" : null,
      displayOrder: 99,
      isActive: true,
    })
    .returning({ id: mediaMavensProductsTable.id });
  return row.id;
}

async function deleteTaggedProducts() {
  await db
    .delete(mediaMavensProductsTable)
    .where(like(mediaMavensProductsTable.slug, `${TEST_TAG}%`));
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminMediaMavensProductsRouter, mediaMavensLinksRouter]);

  const adminEmail = `${TEST_TAG}-admin@example.test`;
  const adminId = await seedUser({ email: adminEmail, name: "Admin", role: "admin" });
  const adminToken = jwt.sign({ userId: adminId, email: adminEmail }, JWT_SECRET, { expiresIn: "1h" });
  adminCookie = `access_token=${adminToken}`;

  memberEmail = `${TEST_TAG}-member@example.test`;
  memberId = await seedUser({ email: memberEmail, name: "Test Member", role: "member" });
  const memberToken = jwt.sign({ userId: memberId, email: memberEmail }, JWT_SECRET, { expiresIn: "1h" });
  memberCookie = `access_token=${memberToken}`;
});

afterAll(async () => {
  await deleteTaggedProducts();
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /admin/tapfiliate/programs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/api/admin/tapfiliate/programs");
    expect(res.status).toBe(401);
  });

  it("returns 403 for member", async () => {
    const res = await request(app)
      .get("/api/admin/tapfiliate/programs")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });

  it("returns programs list for admin", async () => {
    const { listPrograms } = await import("../lib/tapfiliate");
    vi.mocked(listPrograms).mockResolvedValueOnce([
      { id: "prog-1", title: "Program One" },
      { id: "prog-2", title: "Program Two" },
    ]);
    const res = await request(app)
      .get("/api/admin/tapfiliate/programs")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe("prog-1");
  });
});

describe("Admin product CRUD with tapfiliate fields", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await deleteTaggedProducts();
  });

  it("creates a product with tapfiliateProgramId", async () => {
    const slug = `${TEST_TAG}-with-prog`;
    const res = await request(app)
      .post("/api/admin/media-mavens-products")
      .set("Cookie", adminCookie)
      .send({
        slug,
        name: "Tapfiliate Product",
        tapfiliateProgramId: "prog-123",
        tapfiliateProgramTitle: "My Program",
        affiliateLink: "https://example.com?ref=youraffiliateid",
        salesPageUrl: "https://example.com",
        logoDriveUrl: "https://drive.google.com/test",
      });
    expect(res.status).toBe(201);
    expect(res.body.tapfiliateProgramId).toBe("prog-123");
    expect(res.body.tapfiliateProgramTitle).toBe("My Program");
  });

  it("updates tapfiliateProgramId on an existing product", async () => {
    const slug = `${TEST_TAG}-update-prog`;
    const id = await seedProduct(slug, null);
    const res = await request(app)
      .put(`/api/admin/media-mavens-products/${id}`)
      .set("Cookie", adminCookie)
      .send({ tapfiliateProgramId: "prog-456", tapfiliateProgramTitle: "Updated Program" });
    expect(res.status).toBe(200);
    expect(res.body.tapfiliateProgramId).toBe("prog-456");
  });

  it("clears tapfiliateProgramId by sending null", async () => {
    const slug = `${TEST_TAG}-clear-prog`;
    const id = await seedProduct(slug, "existing-prog");
    const res = await request(app)
      .put(`/api/admin/media-mavens-products/${id}`)
      .set("Cookie", adminCookie)
      .send({ tapfiliateProgramId: null, tapfiliateProgramTitle: null });
    expect(res.status).toBe(200);
    expect(res.body.tapfiliateProgramId).toBeNull();
  });
});

describe("GET /media-mavens-products/with-links", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await deleteTaggedProducts();
    await db
      .update(usersTable)
      .set({ tapfiliateAffiliateId: null })
      .where(eq(usersTable.id, memberId));

    const tapfiliate = await import("../lib/tapfiliate");
    const cache = await import("../lib/tapfiliate-cache");

    vi.mocked(cache.getCachedReferralUrl).mockResolvedValue(null);
    vi.mocked(cache.setCachedReferralUrl).mockResolvedValue(undefined);
    vi.mocked(cache.invalidateCachedReferralUrlsByProgram).mockResolvedValue(undefined);

    vi.mocked(tapfiliate.findAffiliateByEmail).mockResolvedValue(null);
    vi.mocked(tapfiliate.createAffiliate).mockImplementation(async (email: string, name: string) => ({
      id: "aff-created",
      email,
      firstname: name,
      lastname: "",
    }));
    vi.mocked(tapfiliate.enrollAffiliateInProgram).mockResolvedValue(undefined);
    vi.mocked(tapfiliate.getAffiliateReferralLinks).mockImplementation(
      async (affiliateId: string, programId: string) => [
        { link: `https://track.test/${affiliateId}/${programId}` },
      ],
    );
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/api/media-mavens-products/with-links");
    expect(res.status).toBe(401);
  });

  it("returns resolvedAffiliateLink = affiliateLink when no program assigned", async () => {
    const slug = `${TEST_TAG}-no-prog`;
    await seedProduct(slug, null);

    const res = await request(app)
      .get("/api/media-mavens-products/with-links")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const product = (res.body as Array<{ slug: string; resolvedAffiliateLink: string; affiliateLink: string }>)
      .find((p) => p.slug === slug);
    expect(product).toBeDefined();
    expect(product!.resolvedAffiliateLink).toBe(product!.affiliateLink);
  });

  it("returns resolved referral URL for a product with a program (affiliate found by email)", async () => {
    const slug = `${TEST_TAG}-with-link`;
    await seedProduct(slug, "prog-resolved");

    const { findAffiliateByEmail } = await import("../lib/tapfiliate");
    vi.mocked(findAffiliateByEmail).mockResolvedValue({
      id: "aff-abc",
      email: memberEmail,
      firstname: "Test",
      lastname: "Member",
    });

    const res = await request(app)
      .get("/api/media-mavens-products/with-links")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(200);

    const product = (res.body as Array<{ slug: string; resolvedAffiliateLink: string }>)
      .find((p) => p.slug === slug);
    expect(product).toBeDefined();
    expect(product!.resolvedAffiliateLink).toBe("https://track.test/aff-abc/prog-resolved");
  });

  it("creates an affiliate on demand when not found by email", async () => {
    const slug = `${TEST_TAG}-create-aff`;
    await seedProduct(slug, "prog-create");

    const { findAffiliateByEmail, createAffiliate } = await import("../lib/tapfiliate");
    vi.mocked(findAffiliateByEmail).mockResolvedValue(null);
    vi.mocked(createAffiliate).mockResolvedValue({
      id: "aff-new",
      email: memberEmail,
      firstname: "Test",
      lastname: "Member",
    });

    const res = await request(app)
      .get("/api/media-mavens-products/with-links")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(200);

    const product = (res.body as Array<{ slug: string; resolvedAffiliateLink: string }>)
      .find((p) => p.slug === slug);
    expect(product).toBeDefined();
    expect(product!.resolvedAffiliateLink).toBe("https://track.test/aff-new/prog-create");
    expect(createAffiliate).toHaveBeenCalled();
  });

  it("reuses the stored affiliate id without hitting the email lookup", async () => {
    const slug = `${TEST_TAG}-stored-aff`;
    await seedProduct(slug, "prog-stored");

    await db
      .update(usersTable)
      .set({ tapfiliateAffiliateId: "aff-stored" })
      .where(eq(usersTable.id, memberId));

    const { findAffiliateByEmail, createAffiliate } = await import("../lib/tapfiliate");

    const res = await request(app)
      .get("/api/media-mavens-products/with-links")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(200);

    const product = (res.body as Array<{ slug: string; resolvedAffiliateLink: string }>)
      .find((p) => p.slug === slug);
    expect(product).toBeDefined();
    expect(product!.resolvedAffiliateLink).toBe("https://track.test/aff-stored/prog-stored");
    expect(findAffiliateByEmail).not.toHaveBeenCalled();
    expect(createAffiliate).not.toHaveBeenCalled();
  });

  it("fails loudly (503) for an assigned-program product when Tapfiliate is not configured", async () => {
    const slug = `${TEST_TAG}-no-key`;
    await seedProduct(slug, "prog-no-key");

    const { TapfiliateConfigError: TCE, findAffiliateByEmail } = await import("../lib/tapfiliate");
    vi.mocked(findAffiliateByEmail).mockRejectedValue(new TCE());

    const res = await request(app)
      .get("/api/media-mavens-products/with-links")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(503);
    expect(typeof res.body.error).toBe("string");
  });

  it("fails loudly (502) for an assigned-program product when the Tapfiliate API errors", async () => {
    const slug = `${TEST_TAG}-api-err`;
    await seedProduct(slug, "prog-api-err");

    const { TapfiliateApiError: TAE, findAffiliateByEmail } = await import("../lib/tapfiliate");
    vi.mocked(findAffiliateByEmail).mockRejectedValue(new TAE(500, "boom"));

    const res = await request(app)
      .get("/api/media-mavens-products/with-links")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(502);
    expect(typeof res.body.error).toBe("string");
  });
});
