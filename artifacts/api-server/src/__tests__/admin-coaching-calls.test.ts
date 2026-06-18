import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  coachesTable,
  coachingCallsTable,
  coachingCallTemplatesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminCoachingCallsRouter from "../routes/admin-coaching-calls";

// Exercises the admin CRUD that lets staff manage the weekly group-call
// schedule + Meet links from the admin panel (replaces the old hardcoded
// frontend schedule). RBAC is covered in admin-rbac.test.ts; this suite proves
// the create / list / update / delete behavior and input validation.

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `admin-calls-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
let seededAdminId = 0;
let coachId = 0;
let otherCoachId = 0;
const createdCallIds: number[] = [];
const createdTemplateIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminCoachingCallsRouter]);

  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-admin@example.test`,
      name: "Calls Admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededAdminId = admin.id;
  adminCookie = signCookie(admin.id, admin.email);

  const [coach] = await db
    .insert(coachesTable)
    .values({ name: `${TAG} Coach`, bio: "b", specialties: "s", callTypes: ["weekly_qa"] })
    .returning({ id: coachesTable.id });
  coachId = coach.id;

  const [other] = await db
    .insert(coachesTable)
    .values({ name: `${TAG} Other`, bio: "b", specialties: "s", callTypes: ["weekly_qa"] })
    .returning({ id: coachesTable.id });
  otherCoachId = other.id;
});

afterAll(async () => {
  // Generated calls reference templates via template_id (ON DELETE SET NULL),
  // so remove the generated rows before the templates they came from.
  if (createdTemplateIds.length > 0) {
    await db
      .delete(coachingCallsTable)
      .where(inArray(coachingCallsTable.templateId, createdTemplateIds));
    await db
      .delete(coachingCallTemplatesTable)
      .where(inArray(coachingCallTemplatesTable.id, createdTemplateIds));
  }
  if (createdCallIds.length > 0) {
    await db.delete(coachingCallsTable).where(inArray(coachingCallsTable.id, createdCallIds));
  }
  if (coachId || otherCoachId) {
    await db
      .delete(coachesTable)
      .where(inArray(coachesTable.id, [coachId, otherCoachId].filter(Boolean)));
  }
  if (seededAdminId) {
    await db.delete(usersTable).where(eq(usersTable.id, seededAdminId));
  }
});

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

describe("admin coaching calls CRUD", () => {
  it("creates a call and returns it from the list", async () => {
    const createRes = await request(app)
      .post("/api/admin/coaching/calls")
      .set("Cookie", adminCookie)
      .send({
        title: `${TAG} Monday Q&A`,
        description: "Weekly live Q&A",
        callType: "weekly_qa",
        coachId,
        scheduledAt: FUTURE,
        durationMinutes: 60,
        meetLink: "https://meet.google.com/abc-defg-hij",
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.id).toBeTypeOf("number");
    expect(createRes.body.meetLink).toBe("https://meet.google.com/abc-defg-hij");
    expect(createRes.body.requiredEntitlement).toBe("coaching:group");
    createdCallIds.push(createRes.body.id);

    const listRes = await request(app)
      .get("/api/admin/coaching/calls")
      .set("Cookie", adminCookie);
    expect(listRes.status).toBe(200);
    const row = listRes.body.calls.find((c: { id: number }) => c.id === createRes.body.id);
    expect(row).toBeTruthy();
    expect(row.coachName).toBe(`${TAG} Coach`);
  });

  it("rejects creation without a title (400)", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/calls")
      .set("Cookie", adminCookie)
      .send({ coachId, scheduledAt: FUTURE });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown call type (400)", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/calls")
      .set("Cookie", adminCookie)
      .send({ title: "x", callType: "not_real", coachId, scheduledAt: FUTURE });
    expect(res.status).toBe(400);
  });

  it("rejects a non-existent coach (400)", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/calls")
      .set("Cookie", adminCookie)
      .send({ title: "x", callType: "weekly_qa", coachId: 9999999, scheduledAt: FUTURE });
    expect(res.status).toBe(400);
  });

  it("updates the meet link, coach, and time of an existing call", async () => {
    const [created] = await db
      .insert(coachingCallsTable)
      .values({
        title: `${TAG} editable`,
        description: "",
        callType: "weekly_qa",
        coachId,
        meetLink: "https://meet.google.com/old-link",
        scheduledAt: new Date(FUTURE),
        durationMinutes: 60,
        requiredEntitlement: "coaching:group",
      })
      .returning({ id: coachingCallsTable.id });
    createdCallIds.push(created.id);

    const res = await request(app)
      .patch(`/api/admin/coaching/calls/${created.id}`)
      .set("Cookie", adminCookie)
      .send({ meetLink: "https://meet.google.com/new-link", coachId: otherCoachId });
    expect(res.status).toBe(200);
    expect(res.body.meetLink).toBe("https://meet.google.com/new-link");
    expect(res.body.coachId).toBe(otherCoachId);
  });

  it("clears the meet link when sent an empty string", async () => {
    const [created] = await db
      .insert(coachingCallsTable)
      .values({
        title: `${TAG} clearable`,
        description: "",
        callType: "weekly_qa",
        coachId,
        meetLink: "https://meet.google.com/has-link",
        scheduledAt: new Date(FUTURE),
        durationMinutes: 60,
        requiredEntitlement: "coaching:group",
      })
      .returning({ id: coachingCallsTable.id });
    createdCallIds.push(created.id);

    const res = await request(app)
      .patch(`/api/admin/coaching/calls/${created.id}`)
      .set("Cookie", adminCookie)
      .send({ meetLink: "" });
    expect(res.status).toBe(200);
    expect(res.body.meetLink).toBeNull();
  });

  it("returns 404 when updating a non-existent call", async () => {
    const res = await request(app)
      .patch("/api/admin/coaching/calls/9999999")
      .set("Cookie", adminCookie)
      .send({ meetLink: "https://meet.google.com/x" });
    expect(res.status).toBe(404);
  });

  it("deletes a call", async () => {
    const [created] = await db
      .insert(coachingCallsTable)
      .values({
        title: `${TAG} deletable`,
        description: "",
        callType: "weekly_qa",
        coachId,
        scheduledAt: new Date(FUTURE),
        durationMinutes: 60,
        requiredEntitlement: "coaching:group",
      })
      .returning({ id: coachingCallsTable.id });

    const res = await request(app)
      .delete(`/api/admin/coaching/calls/${created.id}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const [gone] = await db
      .select({ id: coachingCallsTable.id })
      .from(coachingCallsTable)
      .where(eq(coachingCallsTable.id, created.id));
    expect(gone).toBeUndefined();
  });

  it("returns 404 when deleting a non-existent call", async () => {
    const res = await request(app)
      .delete("/api/admin/coaching/calls/9999999")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
  });

  it("lists coaches for the schedule editor dropdown", async () => {
    const res = await request(app)
      .get("/api/admin/coaching/calls/coaches")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const names = res.body.coaches.map((c: { name: string }) => c.name);
    expect(names).toContain(`${TAG} Coach`);
  });
});

const DAY = 24 * 60 * 60 * 1000;

type ListedCall = {
  id: number;
  title: string;
  meetLink: string | null;
  scheduledAt: string;
  templateId: number | null;
};

async function listCalls(): Promise<ListedCall[]> {
  const res = await request(app)
    .get("/api/admin/coaching/calls")
    .set("Cookie", adminCookie);
  expect(res.status).toBe(200);
  return res.body.calls as ListedCall[];
}

function seriesFor(calls: ListedCall[], templateId: number): ListedCall[] {
  return calls
    .filter((c) => c.templateId === templateId)
    .sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );
}

describe("admin recurring call templates", () => {
  let seriesTemplateId = 0;

  it("creates a template and generates the first batch of weekly calls", async () => {
    const anchor = new Date(Date.now() + 30 * DAY).toISOString();
    const res = await request(app)
      .post("/api/admin/coaching/calls/templates")
      .set("Cookie", adminCookie)
      .send({
        title: `${TAG} Weekly Series`,
        description: "Recurring Q&A",
        callType: "weekly_qa",
        coachId,
        anchorAt: anchor,
        durationMinutes: 60,
        occurrencesPerBatch: 3,
        meetLink: "https://meet.google.com/series-link",
      });
    expect(res.status).toBe(201);
    expect(res.body.generated).toBe(3);
    expect(res.body.template.id).toBeTypeOf("number");
    expect(res.body.template.intervalDays).toBe(7);
    seriesTemplateId = res.body.template.id;
    createdTemplateIds.push(seriesTemplateId);

    const series = seriesFor(await listCalls(), seriesTemplateId);
    expect(series).toHaveLength(3);
    // Spaced exactly one week apart.
    for (let i = 1; i < series.length; i++) {
      const gap =
        new Date(series[i].scheduledAt).getTime() -
        new Date(series[i - 1].scheduledAt).getTime();
      expect(gap).toBe(7 * DAY);
    }
    // Generated rows inherit the template's content.
    expect(series[0].title).toBe(`${TAG} Weekly Series`);
    expect(series[0].meetLink).toBe("https://meet.google.com/series-link");
  });

  it("editing one occurrence leaves the rest of the series untouched", async () => {
    const series = seriesFor(await listCalls(), seriesTemplateId);
    const target = series[0];
    const patchRes = await request(app)
      .patch(`/api/admin/coaching/calls/${target.id}`)
      .set("Cookie", adminCookie)
      .send({ title: `${TAG} One-off override`, meetLink: "https://meet.google.com/override" });
    expect(patchRes.status).toBe(200);

    const after = seriesFor(await listCalls(), seriesTemplateId);
    const overridden = after.find((c) => c.id === target.id);
    expect(overridden?.title).toBe(`${TAG} One-off override`);
    // Siblings keep the original template content.
    for (const sibling of after.filter((c) => c.id !== target.id)) {
      expect(sibling.title).toBe(`${TAG} Weekly Series`);
      expect(sibling.meetLink).toBe("https://meet.google.com/series-link");
    }
  });

  it("generates the next batch without recreating a cancelled occurrence", async () => {
    const series = seriesFor(await listCalls(), seriesTemplateId);
    const victim = series[1];
    const victimTime = victim.scheduledAt;

    const delRes = await request(app)
      .delete(`/api/admin/coaching/calls/${victim.id}`)
      .set("Cookie", adminCookie);
    expect(delRes.status).toBe(200);

    const genRes = await request(app)
      .post(`/api/admin/coaching/calls/templates/${seriesTemplateId}/generate`)
      .set("Cookie", adminCookie);
    expect(genRes.status).toBe(200);
    expect(genRes.body.generated).toBe(3);

    const after = seriesFor(await listCalls(), seriesTemplateId);
    // The cancelled slot is never resurrected by a later generate pass.
    expect(after.some((c) => c.scheduledAt === victimTime)).toBe(false);
    // 3 original - 1 cancelled + 3 new = 5 (the cancelled slot leaves a hole).
    expect(after).toHaveLength(5);
    // The newly generated batch continues weekly past the prior watermark.
    const newest = after.slice(-3);
    for (let i = 1; i < newest.length; i++) {
      const gap =
        new Date(newest[i].scheduledAt).getTime() -
        new Date(newest[i - 1].scheduledAt).getTime();
      expect(gap).toBe(7 * DAY);
    }
  });

  it("deleting a template keeps its generated calls (template_id set null)", async () => {
    const anchor = new Date(Date.now() + 120 * DAY).toISOString();
    const createRes = await request(app)
      .post("/api/admin/coaching/calls/templates")
      .set("Cookie", adminCookie)
      .send({
        title: `${TAG} Disposable`,
        callType: "weekly_qa",
        coachId,
        anchorAt: anchor,
        occurrencesPerBatch: 2,
      });
    expect(createRes.status).toBe(201);
    const tid = createRes.body.template.id as number;

    const generated = seriesFor(await listCalls(), tid);
    expect(generated).toHaveLength(2);
    // These rows must survive template deletion, so clean them up separately.
    generated.forEach((c) => createdCallIds.push(c.id));

    const delRes = await request(app)
      .delete(`/api/admin/coaching/calls/templates/${tid}`)
      .set("Cookie", adminCookie);
    expect(delRes.status).toBe(200);

    const templatesRes = await request(app)
      .get("/api/admin/coaching/calls/templates")
      .set("Cookie", adminCookie);
    expect(
      templatesRes.body.templates.some((t: { id: number }) => t.id === tid),
    ).toBe(false);

    const survivors = (await listCalls()).filter((c) =>
      generated.some((g) => g.id === c.id),
    );
    expect(survivors).toHaveLength(2);
    survivors.forEach((c) => expect(c.templateId).toBeNull());
  });

  it("returns 404 when generating for a non-existent template", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/calls/templates/9999999/generate")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
  });

  it("rejects a template without a first occurrence (400)", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/calls/templates")
      .set("Cookie", adminCookie)
      .send({ title: "x", callType: "weekly_qa", coachId });
    expect(res.status).toBe(400);
  });

  it("rejects a template with a non-existent coach (400)", async () => {
    const res = await request(app)
      .post("/api/admin/coaching/calls/templates")
      .set("Cookie", adminCookie)
      .send({
        title: "x",
        callType: "weekly_qa",
        coachId: 9999999,
        anchorAt: new Date(Date.now() + 30 * DAY).toISOString(),
      });
    expect(res.status).toBe(400);
  });
});
