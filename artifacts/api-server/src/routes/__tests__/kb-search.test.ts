import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, knowledgebaseDocsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "../../__tests__/test-app";
import kbSearchRouter from "../kb-search";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `kbsearch-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededDocIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberCookie: string;

async function seedUser(): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-${randomUUID().slice(0, 6)}@example.test`,
      name: "KB Searcher",
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

async function seedDoc(opts: {
  title: string;
  content: string;
  category?: string;
  audience?: string;
  sourcePath?: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(knowledgebaseDocsTable)
    .values({
      title: opts.title,
      content: opts.content,
      category: opts.category ?? "faq",
      audience: opts.audience ?? "member",
      sourcePath: opts.sourcePath === undefined ? "/blitz" : opts.sourcePath,
      sourceLabel: "Test Source",
    })
    .returning({ id: knowledgebaseDocsTable.id });
  seededDocIds.push(row.id);
  return row.id;
}

function search(q: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ q, ...params }).toString();
  return request(app).get(`/api/kb/search?${qs}`).set("Cookie", memberCookie);
}

beforeAll(async () => {
  app = buildTestAppWithRouters([kbSearchRouter]);

  const userId = await seedUser();
  const token = jwt.sign(
    { userId, email: `${TAG}@example.test` },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
  memberCookie = `access_token=${token}`;
});

afterAll(async () => {
  if (seededDocIds.length > 0) {
    await db
      .delete(knowledgebaseDocsTable)
      .where(inArray(knowledgebaseDocsTable.id, seededDocIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /kb/search — improved search behaviour", () => {
  it("OR matching: a multi-word query surfaces docs that contain only some of the words", async () => {
    // A doc whose body matches only ONE of the two query words. Old
    // plainto_tsquery (implicit AND) would require both → empty result.
    const id = await seedDoc({
      title: `${TAG} affiliate marketing primer`,
      content: `${TAG} this lesson explains affiliate funnels in depth`,
    });

    // "affiliate" appears; "quantumzzz" (a word that exists nowhere) does not.
    const res = await search(`${TAG} affiliate quantumzzz`);

    expect(res.status).toBe(200);
    const ids = res.body.results.map((r: any) => r.id);
    expect(ids).toContain(id);
  });

  it("Title weighting: a title match ranks above a body-only match", async () => {
    const word = `${TAG}weighttoken`;
    const titleMatch = await seedDoc({
      title: `${word} headline lesson`,
      content: `${TAG} generic body content with no special term`,
    });
    const bodyMatch = await seedDoc({
      title: `${TAG} unrelated heading about funnels`,
      content: `${TAG} the ${word} appears only deep inside the body text`,
    });

    const res = await search(word);
    expect(res.status).toBe(200);
    const ids = res.body.results.map((r: any) => r.id);
    const titleIdx = ids.indexOf(titleMatch);
    const bodyIdx = ids.indexOf(bodyMatch);
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(bodyIdx).toBeGreaterThanOrEqual(0);
    expect(titleIdx).toBeLessThan(bodyIdx);
  });

  it("Trigram fallback: a misspelled query still surfaces the correct top result", async () => {
    // A distinctive, made-up term so trigram similarity isolates this doc and
    // the shared TAG token does not dilute the ranking against sibling docs.
    const id = await seedDoc({
      title: `${TAG} Zephyrium Growth Strategies`,
      content: `${TAG} how to grow an audience and engagement on social media`,
    });

    // "Zephyrum" is a deliberate misspelling of "Zephyrium" — no full-text
    // lexeme match, so the route must fall back to trigram similarity. We omit
    // the shared TAG from the query so the misspelled term drives the ranking.
    const res = await search(`Zephyrum`);

    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0].id).toBe(id);
  });

  it("Category filter: restricts results under full-text matching", async () => {
    const word = `${TAG}cattoken`;
    const inCat = await seedDoc({
      title: `${word} alpha doc`,
      content: `${TAG} body alpha`,
      category: `${TAG}-cat-a`,
    });
    const outCat = await seedDoc({
      title: `${word} beta doc`,
      content: `${TAG} body beta`,
      category: `${TAG}-cat-b`,
    });

    const res = await search(word, { category: `${TAG}-cat-a` });
    expect(res.status).toBe(200);
    const ids = res.body.results.map((r: any) => r.id);
    expect(ids).toContain(inCat);
    expect(ids).not.toContain(outCat);
  });

  it("Category filter: restricts results under the trigram fallback", async () => {
    const inCat = await seedDoc({
      title: `${TAG} Pinterest Tactics`,
      content: `${TAG} visual content marketing`,
      category: `${TAG}-trg-a`,
    });
    await seedDoc({
      title: `${TAG} Pinterest Tactics Mirror`,
      content: `${TAG} visual content marketing`,
      category: `${TAG}-trg-b`,
    });

    // Misspelled → trigram fallback, scoped to one category only.
    const res = await search(`${TAG} Pintrest`, { category: `${TAG}-trg-a` });
    expect(res.status).toBe(200);
    const ids = res.body.results.map((r: any) => r.id);
    expect(ids).toContain(inCat);
    for (const r of res.body.results) {
      expect(r.category).toBe(`${TAG}-trg-a`);
    }
  });

  it("Exact-phrase regression: a clean full-text query returns the expected top result", async () => {
    const phrase = `${TAG}exactphrasetoken`;
    const id = await seedDoc({
      title: `${phrase} definitive guide`,
      content: `${TAG} the ${phrase} is the canonical reference document`,
    });
    // A noise doc that shares only the common tag, not the phrase token.
    await seedDoc({
      title: `${TAG} unrelated noise doc`,
      content: `${TAG} nothing of interest here`,
    });

    const res = await search(phrase);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0].id).toBe(id);
  });

  it("excludes admin-audience docs and docs without a source path", async () => {
    const word = `${TAG}visibilitytoken`;
    const adminDoc = await seedDoc({
      title: `${word} admin only`,
      content: `${TAG} internal`,
      audience: "admin",
    });
    const noPathDoc = await seedDoc({
      title: `${word} no destination`,
      content: `${TAG} orphan`,
      sourcePath: null,
    });
    const visibleDoc = await seedDoc({
      title: `${word} member visible`,
      content: `${TAG} public`,
    });

    const res = await search(word);
    expect(res.status).toBe(200);
    const ids = res.body.results.map((r: any) => r.id);
    expect(ids).toContain(visibleDoc);
    expect(ids).not.toContain(adminDoc);
    expect(ids).not.toContain(noPathDoc);
  });

  it("requires authentication", async () => {
    const res = await request(app).get(`/api/kb/search?q=${TAG}`);
    expect(res.status).toBe(401);
  });
});
