import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, campaignChecklistProgressTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { CAMPAIGN_ROADMAP } from "@workspace/campaign-roadmap";

import { buildTestAppWithRouters } from "../../__tests__/test-app";
import campaignChecklistRouter from "../campaign-checklist";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `campchk-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let cookieA: string;
let cookieB: string;

async function seedUser(): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-${randomUUID().slice(0, 6)}@example.test`,
      name: "Checklist Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

function cookieFor(userId: number): string {
  const token = jwt.sign({ userId, email: `${TAG}@example.test` }, JWT_SECRET, {
    expiresIn: "1h",
  });
  return `access_token=${token}`;
}

// Convenient real keys from the shared skeleton.
const NO_SUBSTEP_STEP = CAMPAIGN_ROADMAP.find(
  (s) => s.substeps.length === 0 && s.id !== "choose-network",
)!;
const SHARED_SUBSTEP = CAMPAIGN_ROADMAP.flatMap((s) => s.substeps).find(
  (ss) => ss.network === undefined,
)!;
const MM_SUBSTEP = CAMPAIGN_ROADMAP.flatMap((s) => s.substeps).find(
  (ss) => ss.network === "media-mavens",
)!;
const CB_SUBSTEP = CAMPAIGN_ROADMAP.flatMap((s) => s.substeps).find(
  (ss) => ss.network === "clickbank",
)!;

beforeAll(async () => {
  app = buildTestAppWithRouters([campaignChecklistRouter]);
  cookieA = cookieFor(await seedUser());
  cookieB = cookieFor(await seedUser());
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db
      .delete(campaignChecklistProgressTable)
      .where(inArray(campaignChecklistProgressTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("campaign checklist progress API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/campaign-checklist");
    expect(res.status).toBe(401);
  });

  it("returns empty default state before any save", async () => {
    const res = await request(app).get("/api/campaign-checklist").set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ network: null, checkedIds: [] });
  });

  it("saves and reads back network + checked ids (skeleton-validated)", async () => {
    const put = await request(app)
      .put("/api/campaign-checklist")
      .set("Cookie", cookieA)
      .send({
        network: "media-mavens",
        checkedIds: [NO_SUBSTEP_STEP.id, SHARED_SUBSTEP.substepId, MM_SUBSTEP.substepId],
      });
    expect(put.status).toBe(200);
    expect(put.body.network).toBe("media-mavens");
    expect(new Set(put.body.checkedIds)).toEqual(
      new Set([NO_SUBSTEP_STEP.id, SHARED_SUBSTEP.substepId, MM_SUBSTEP.substepId]),
    );

    const get = await request(app).get("/api/campaign-checklist").set("Cookie", cookieA);
    expect(get.body.network).toBe("media-mavens");
    expect(new Set(get.body.checkedIds)).toEqual(new Set(put.body.checkedIds));
  });

  it("rejects ids not present in the shared skeleton", async () => {
    const res = await request(app)
      .put("/api/campaign-checklist")
      .set("Cookie", cookieA)
      .send({ network: "media-mavens", checkedIds: ["totally-made-up-id"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("totally-made-up-id");
  });

  it("rejects an unknown network value and non-string ids", async () => {
    const bad1 = await request(app)
      .put("/api/campaign-checklist")
      .set("Cookie", cookieA)
      .send({ network: "maxweb", checkedIds: [] });
    expect(bad1.status).toBe(400);

    const bad2 = await request(app)
      .put("/api/campaign-checklist")
      .set("Cookie", cookieA)
      .send({ network: "clickbank", checkedIds: [42] });
    expect(bad2.status).toBe(400);
  });

  it("drops other-network branch substeps on save (shared progress persists)", async () => {
    const res = await request(app)
      .put("/api/campaign-checklist")
      .set("Cookie", cookieA)
      .send({
        network: "clickbank",
        checkedIds: [SHARED_SUBSTEP.substepId, MM_SUBSTEP.substepId, CB_SUBSTEP.substepId],
      });
    expect(res.status).toBe(200);
    expect(res.body.checkedIds).toContain(SHARED_SUBSTEP.substepId);
    expect(res.body.checkedIds).toContain(CB_SUBSTEP.substepId);
    expect(res.body.checkedIds).not.toContain(MM_SUBSTEP.substepId);
  });

  it("drops ALL branch substeps when no network is chosen", async () => {
    const res = await request(app)
      .put("/api/campaign-checklist")
      .set("Cookie", cookieA)
      .send({
        network: null,
        checkedIds: [SHARED_SUBSTEP.substepId, MM_SUBSTEP.substepId, CB_SUBSTEP.substepId],
      });
    expect(res.status).toBe(200);
    expect(res.body.network).toBeNull();
    expect(res.body.checkedIds).toEqual([SHARED_SUBSTEP.substepId]);
  });

  it("scopes state per member — another member sees their own empty state", async () => {
    await request(app)
      .put("/api/campaign-checklist")
      .set("Cookie", cookieA)
      .send({ network: "clickbank", checkedIds: [SHARED_SUBSTEP.substepId] });

    const other = await request(app).get("/api/campaign-checklist").set("Cookie", cookieB);
    expect(other.status).toBe(200);
    expect(other.body).toEqual({ network: null, checkedIds: [] });
  });
});
