import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "http";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, auditLogTable, usersTable } from "@workspace/db";
import { eq, gt, inArray, and, desc } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `audit-export-cancel-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let server: http.Server;
let port = 0;
let adminId = 0;
let cookie = "";
let baselineAuditId = 0;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedAuditRows(actionType: string, count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    actorId: adminId,
    actorEmail: `${TEST_TAG}@example.test`,
    actionType,
    entityType: TEST_TAG,
    entityId: String(i),
    description: `seeded row ${i}`,
  }));
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await db.insert(auditLogTable).values(rows.slice(i, i + chunkSize));
  }
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Listen failed");
  port = address.port;

  const [maxRow] = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.id))
    .limit(1);
  baselineAuditId = maxRow?.id ?? 0;

  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}@example.test`,
      name: "Audit Export Cancel Admin",
      passwordHash: await bcrypt.hash("irrelevant", 4),
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  adminId = admin.id;
  cookie = signCookie(admin.id, `${TEST_TAG}@example.test`);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db
    .delete(auditLogTable)
    .where(and(gt(auditLogTable.id, baselineAuditId), eq(auditLogTable.entityType, TEST_TAG)));
  if (adminId) {
    await db.delete(usersTable).where(inArray(usersTable.id, [adminId]));
  }
});

describe("GET /admin/audit-log/export — client cancellation", () => {
  it("shuts the response down cleanly when the client disconnects mid-stream", async () => {
    const actionType = `${TEST_TAG}-cancel`;
    // Seed enough rows that the export needs multiple internal batches —
    // the streaming loop must observe the `aborted` flag at the right
    // moment to stop walking the keyset.
    await seedAuditRows(actionType, 3000);

    // Capture console.error so we can assert that a clean abort does NOT
    // log an export failure (which would surface as a 500-flavoured noise
    // line in production).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port,
            path: `/api/admin/audit-log/export?actionType=${encodeURIComponent(
              actionType,
            )}&entityType=${encodeURIComponent(TEST_TAG)}&format=csv`,
            method: "GET",
            headers: { Cookie: cookie },
          },
          (res) => {
            let bytes = 0;
            res.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              // Tear down the request as soon as we've confirmed the
              // server is actually streaming. This mirrors what the
              // browser fetch does when the AbortController is fired.
              if (bytes > 0) {
                req.destroy();
                // Give the server a moment to observe `res.on('close')`
                // and unwind the streaming loop before we resolve.
                setTimeout(() => resolve(), 250);
              }
            });
            res.on("error", () => {
              // Expected — the destroy() above tears down the stream.
            });
          },
        );
        req.on("error", (err: NodeJS.ErrnoException) => {
          // ECONNRESET / aborted errors are the expected outcome of
          // destroying our own request mid-stream.
          if (err.code === "ECONNRESET" || err.message?.includes("aborted")) {
            return;
          }
          reject(err);
        });
        req.end();
      });

      // The server's catch block returns early when `aborted` is true,
      // so a clean cancellation must not log "[Admin] Audit log export
      // error:" — that line is reserved for genuine 500s.
      const exportErrors = errorSpy.mock.calls.filter((args) =>
        args.some(
          (a) => typeof a === "string" && a.includes("Audit log export error"),
        ),
      );
      expect(exportErrors).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }

    // After the cancellation, a follow-up export against the same data
    // must still succeed — proves the route handler hasn't been left in
    // a broken state by the prior abort.
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/api/admin/audit-log/export?actionType=${encodeURIComponent(
            actionType,
          )}&entityType=${encodeURIComponent(TEST_TAG)}&format=csv`,
          method: "GET",
          headers: { Cookie: cookie },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            try {
              expect(res.statusCode).toBe(200);
              const body = Buffer.concat(chunks).toString("utf8");
              const lines = body.split("\n");
              // Header line + 3000 data rows.
              expect(lines).toHaveLength(3001);
              // Trailers expose the authoritative count.
              expect(res.trailers["x-audit-log-returned-count"]).toBe("3000");
              expect(res.trailers["x-audit-log-truncated"]).toBeUndefined();
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  }, 30_000);
});
