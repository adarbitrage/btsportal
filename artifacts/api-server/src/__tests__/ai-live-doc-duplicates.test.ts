import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, aiLiveDocumentsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import aiLiveDocumentsRouter from "../routes/admin/ai-live-documents";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `live-dup-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededLiveIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;

async function seedAdmin(): Promise<void> {
  const email = `${TEST_TAG}-admin@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Live Dup Admin",
      passwordHash,
      role: "admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  adminCookie = `access_token=${token}`;
}

async function seedLiveDoc(opts: { title: string; content: string; deletedAt?: Date }): Promise<number> {
  const [row] = await db
    .insert(aiLiveDocumentsTable)
    .values({
      title: opts.title,
      content: opts.content,
      deletedAt: opts.deletedAt,
    })
    .returning({ id: aiLiveDocumentsTable.id });
  seededLiveIds.push(row.id);
  return row.id;
}

// Cluster-unique concept so shared-dev-DB rows never join our cluster.
const CONCEPT = `Vk${TEST_TAG.replace(/-/g, "")} Signal Router`;
const BODY = `${TEST_TAG} the vk signal router forwards each inbound event through the priority lanes and rebalances the queue depth whenever the lane pressure crosses the configured watermark so no consumer ever starves during bursts. `.repeat(4);

beforeAll(async () => {
  app = buildTestAppWithRouters([aiLiveDocumentsRouter]);
  await seedAdmin();
});

afterAll(async () => {
  if (seededLiveIds.length > 0) {
    await db.delete(aiLiveDocumentsTable).where(inArray(aiLiveDocumentsTable.id, seededLiveIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /admin/ai-live-documents/duplicates", () => {
  it("clusters similar live docs (title variants + content similarity), skipping deleted and unrelated ones", async () => {
    const idA = await seedLiveDoc({ title: `What is ${CONCEPT}?`, content: BODY });
    const idB = await seedLiveDoc({ title: CONCEPT, content: `${BODY} Extra trailing sentence for variety.` });
    // Different title, near-identical content — joins via content similarity.
    const idC = await seedLiveDoc({ title: `${TEST_TAG} totally different heading`, content: BODY });
    // Deleted doc with the same title must be ignored.
    const idDeleted = await seedLiveDoc({ title: `What's ${CONCEPT}?`, content: BODY, deletedAt: new Date() });
    // Unrelated singleton must not appear anywhere.
    const idLoner = await seedLiveDoc({
      title: `${TEST_TAG} unrelated lone topic`,
      content: `${TEST_TAG} nothing about routers here, just a standalone body about something else entirely.`,
    });

    const res = await request(app).get("/api/admin/ai-live-documents/duplicates").set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const clusters = res.body.clusters as Array<{
      key: string;
      docs: Array<{ id: number; title: string; category: string; contentPreview: string }>;
    }>;
    const cluster = clusters.find((c) => c.docs.some((d) => d.id === idA));
    expect(cluster).toBeDefined();

    const ids = cluster!.docs.map((d) => d.id).sort((a, b) => a - b);
    expect(ids).toEqual([idA, idB, idC].sort((a, b) => a - b));
    expect(ids).not.toContain(idDeleted);
    expect(ids).not.toContain(idLoner);

    // Loner never appears in ANY cluster (singletons are dropped).
    const allClusteredIds = clusters.flatMap((c) => c.docs.map((d) => d.id));
    expect(allClusteredIds).not.toContain(idLoner);
    expect(allClusteredIds).not.toContain(idDeleted);

    // Docs carry display metadata, and the preview is capped (informational).
    const docA = cluster!.docs.find((d) => d.id === idA)!;
    expect(docA.title).toBe(`What is ${CONCEPT}?`);
    expect(docA.contentPreview.length).toBeLessThanOrEqual(200);

    expect(typeof res.body.scannedDocCount).toBe("number");
    expect(res.body.clusteredDocCount).toBeGreaterThanOrEqual(3);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/admin/ai-live-documents/duplicates");
    expect(res.status).toBe(401);
  });
});
