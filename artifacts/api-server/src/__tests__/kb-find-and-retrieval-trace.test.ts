import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, aiLiveDocumentsTable, chatSessionsTable, chatMessagesTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import kbFindRouter from "../routes/admin/kb-find";
import { splitAnswerIntoClaims, findSnippetInLiveCorpus } from "../routes/admin/kb-find";
import chatRouter, { buildRetrievalTrace } from "../routes/chat";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `kbfind-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededDocIds: number[] = [];
const seededSessionIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let memberId: number;

const UNIQUE_SENTENCE = `The ${TAG} caterpillar method requires exactly three approval steps before launch.`;

async function seedUser(role: string) {
  const email = `${TAG}-${role}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `${TAG} ${role}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  return { id: row.id, cookie: `access_token=${token}` };
}

const sampleTrace = {
  version: 1 as const,
  confident: true,
  usedInContext: true,
  topScore: 0.42,
  topSemanticScore: 0,
  lexicalFloor: 0.05,
  semanticFloor: 0.5,
  docs: [
    {
      id: 999999,
      title: "Doc",
      homeRoot: null,
      node: null,
      docClass: "curated",
      rank: 0.42,
      semanticScore: 0,
      grounded: false,
      clearedFloor: true,
    },
  ],
};

beforeAll(async () => {
  app = buildTestAppWithRouters([kbFindRouter, chatRouter]);

  const admin = await seedUser("admin");
  adminCookie = admin.cookie;
  const member = await seedUser("member");
  memberCookie = member.cookie;
  memberId = member.id;

  const [doc] = await db
    .insert(aiLiveDocumentsTable)
    .values({
      title: `${TAG} Caterpillar Method Overview`,
      content: `Intro paragraph. ${UNIQUE_SENTENCE} Closing thoughts about launches.`,
      category: "strategy",
      audience: "member",
      docClass: "curated",
    })
    .returning({ id: aiLiveDocumentsTable.id });
  seededDocIds.push(doc.id);

  // Seed a soft-deleted doc that must never surface.
  const [deletedDoc] = await db
    .insert(aiLiveDocumentsTable)
    .values({
      title: `${TAG} Deleted Doc`,
      content: `${UNIQUE_SENTENCE} but from a deleted document.`,
      category: "strategy",
      audience: "member",
      docClass: "curated",
      deletedAt: new Date(),
    })
    .returning({ id: aiLiveDocumentsTable.id });
  seededDocIds.push(deletedDoc.id);

  // Member chat session with an assistant message carrying a trace.
  const [session] = await db
    .insert(chatSessionsTable)
    .values({ userId: memberId, title: `${TAG} session` })
    .returning({ id: chatSessionsTable.id });
  seededSessionIds.push(session.id);
  await db.insert(chatMessagesTable).values([
    { sessionId: session.id, role: "user", content: "How does the caterpillar method work?" },
    { sessionId: session.id, role: "assistant", content: "It has three steps.", retrievalTrace: sampleTrace },
  ]);
});

afterAll(async () => {
  for (const id of seededSessionIds) {
    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.sessionId, id));
    await db.delete(chatSessionsTable).where(eq(chatSessionsTable.id, id));
  }
  if (seededDocIds.length > 0) {
    await db.delete(aiLiveDocumentsTable).where(inArray(aiLiveDocumentsTable.id, seededDocIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("buildRetrievalTrace", () => {
  const retrieval = {
    confident: false,
    topScore: 0.02,
    topSemanticScore: 0.1,
    docs: [
      { id: 1, title: "A", homeRoot: null, node: null, docClass: "curated", rank: 0.005, semanticScore: 0.1, grounded: false },
      { id: 2, title: "B", homeRoot: "r", node: "n", docClass: "overview", rank: 0.5, semanticScore: 0, grounded: false },
      { id: 3, title: "C", homeRoot: null, node: null, docClass: null, rank: 0, semanticScore: 0, grounded: true },
    ],
  } as any;

  it("marks usedInContext false when retrieval is not confident", () => {
    const trace = buildRetrievalTrace(retrieval);
    expect(trace.version).toBe(1);
    expect(trace.confident).toBe(false);
    expect(trace.usedInContext).toBe(false);
  });

  it("computes clearedFloor per doc from grounded/lexical/semantic", () => {
    const trace = buildRetrievalTrace(retrieval);
    const byId = Object.fromEntries(trace.docs.map((d) => [d.id, d]));
    expect(byId[1].clearedFloor).toBe(false);
    expect(byId[2].clearedFloor).toBe(true); // high lexical rank
    expect(byId[3].clearedFloor).toBe(true); // grounded
  });

  it("never stores document content", () => {
    const trace = buildRetrievalTrace(retrieval) as any;
    for (const d of trace.docs) {
      expect(d.content).toBeUndefined();
    }
  });
});

describe("member trace gating — GET /chat/sessions/:sessionId", () => {
  it("strips retrievalTrace for members (their own session)", async () => {
    const res = await request(app)
      .get(`/api/chat/sessions/${seededSessionIds[0]}`)
      .set("Cookie", memberCookie);
    expect(res.status).toBe(200);
    const assistant = res.body.messages.find((m: any) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.retrievalTrace).toBeUndefined();
    expect("retrievalTrace" in assistant).toBe(false);
  });
});

describe("splitAnswerIntoClaims", () => {
  it("splits prose into sentence-level claims and strips markdown", () => {
    const claims = splitAnswerIntoClaims(
      "**The caterpillar method has three steps.** You should always verify your tracking links first.\n\n- Bullet claim about affiliate commission payouts here.\n- ok",
    );
    expect(claims).toContain("The caterpillar method has three steps.");
    expect(claims).toContain("You should always verify your tracking links first.");
    expect(claims).toContain("Bullet claim about affiliate commission payouts here.");
    // "ok" is too short to be a claim
    expect(claims.some((c) => c === "ok")).toBe(false);
  });

  it("returns empty array for empty input", () => {
    expect(splitAnswerIntoClaims("")).toEqual([]);
  });
});

describe("findSnippetInLiveCorpus", () => {
  it("finds an exact snippet and highlights it", async () => {
    const results = await findSnippetInLiveCorpus(UNIQUE_SENTENCE);
    const hit = results.find((r) => r.docId === seededDocIds[0]);
    expect(hit).toBeTruthy();
    expect(hit!.matchType).toBe("exact");
    expect(hit!.excerpt).toContain("<mark>");
    expect(hit!.matchedPassage).toBe(UNIQUE_SENTENCE);
  });

  it("never returns soft-deleted documents", async () => {
    const results = await findSnippetInLiveCorpus(UNIQUE_SENTENCE, 20);
    expect(results.map((r) => r.docId)).not.toContain(seededDocIds[1]);
  });

  it("falls back to fuzzy matching when no exact match exists", async () => {
    const results = await findSnippetInLiveCorpus(
      `${TAG} caterpillar approval steps required before launching`,
      20,
    );
    const hit = results.find((r) => r.docId === seededDocIds[0]);
    expect(hit).toBeTruthy();
    expect(hit!.matchType).toBe("fuzzy");
    expect(hit!.score).toBeGreaterThan(0);
  });

  it("escapes HTML in fuzzy excerpts (stored-XSS guard) while keeping <mark>", async () => {
    const [xssDoc] = await db
      .insert(aiLiveDocumentsTable)
      .values({
        title: `${TAG} XSS Doc`,
        content: `<script>alert("pwn")</script> The ${TAG} zebra migration timeline spans four distinct quarters overall.`,
        category: "strategy",
        audience: "member",
        docClass: "curated",
      })
      .returning({ id: aiLiveDocumentsTable.id });
    seededDocIds.push(xssDoc.id);

    const results = await findSnippetInLiveCorpus(`${TAG} zebra migration timeline quarters`, 20);
    const hit = results.find((r) => r.docId === xssDoc.id);
    expect(hit).toBeTruthy();
    expect(hit!.matchType).toBe("fuzzy");
    expect(hit!.excerpt).not.toContain("<script>");
    expect(hit!.excerpt).toContain("<mark>");
  });
});

describe("POST /admin/kb-find endpoints", () => {
  it("rejects members", async () => {
    const res = await request(app)
      .post("/api/admin/kb-find/search")
      .set("Cookie", memberCookie)
      .send({ query: "anything" });
    expect([401, 403]).toContain(res.status);
  });

  it("search returns exact result for admins", async () => {
    const res = await request(app)
      .post("/api/admin/kb-find/search")
      .set("Cookie", adminCookie)
      .send({ query: UNIQUE_SENTENCE });
    expect(res.status).toBe(200);
    expect(res.body.results.some((r: any) => r.docId === seededDocIds[0] && r.matchType === "exact")).toBe(true);
  });

  it("search 400s on empty query", async () => {
    const res = await request(app)
      .post("/api/admin/kb-find/search")
      .set("Cookie", adminCookie)
      .send({ query: "   " });
    expect(res.status).toBe(400);
  });

  it("extract-claims splits an answer without searching", async () => {
    const res = await request(app)
      .post("/api/admin/kb-find/extract-claims")
      .set("Cookie", adminCookie)
      .send({ answer: `${UNIQUE_SENTENCE}\n\nThis totally unrelated zzqx sentence has no support anywhere at all.` });
    expect(res.status).toBe(200);
    expect(res.body.claims).toHaveLength(2);
    expect(res.body.claims).toContain(UNIQUE_SENTENCE);
  });

  it("check-answer checks only the SELECTED claims array", async () => {
    const res = await request(app)
      .post("/api/admin/kb-find/check-answer")
      .set("Cookie", adminCookie)
      .send({ claims: [UNIQUE_SENTENCE] });
    expect(res.status).toBe(200);
    expect(res.body.claimCount).toBe(1);
    const supported = res.body.claims[0];
    expect(supported.claim).toBe(UNIQUE_SENTENCE);
    expect(supported.supported).toBe(true);
    expect(supported.results.some((r: any) => r.docId === seededDocIds[0])).toBe(true);
  });

  it("check-answer still accepts a raw answer (auto-split fallback)", async () => {
    const res = await request(app)
      .post("/api/admin/kb-find/check-answer")
      .set("Cookie", adminCookie)
      .send({ answer: `${UNIQUE_SENTENCE}\n\nThis totally unrelated zzqx sentence has no support anywhere at all.` });
    expect(res.status).toBe(200);
    expect(res.body.claimCount).toBe(2);
    const supported = res.body.claims.find((c: any) => c.claim === UNIQUE_SENTENCE);
    expect(supported.supported).toBe(true);
  });

  it("check-answer 400s on an empty claims array", async () => {
    const res = await request(app)
      .post("/api/admin/kb-find/check-answer")
      .set("Cookie", adminCookie)
      .send({ claims: ["   "] });
    expect(res.status).toBe(400);
  });

  it("doc-status reports deleted and missing docs", async () => {
    const res = await request(app)
      .post("/api/admin/kb-find/doc-status")
      .set("Cookie", adminCookie)
      .send({ ids: [seededDocIds[0], seededDocIds[1], 99999999] });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.docs.map((d: any) => [d.id, d]));
    expect(byId[seededDocIds[0]]).toMatchObject({ exists: true, deleted: false });
    expect(byId[seededDocIds[1]]).toMatchObject({ exists: true, deleted: true });
    expect(byId[99999999]).toMatchObject({ exists: false });
  });
});
