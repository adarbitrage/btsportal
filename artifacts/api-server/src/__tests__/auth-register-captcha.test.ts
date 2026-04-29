import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

// Disable Redis-backed rate limiting for these tests so we can hit the
// register handler many times without bumping into the per-IP cap.
vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: vi.fn(async () => false),
}));

const {
  sendEmailNowMock,
  queueGHLSyncMock,
  emitWebhookEventMock,
} = vi.hoisted(() => ({
  sendEmailNowMock: vi.fn(async () => ({ success: true })),
  queueGHLSyncMock: vi.fn(async () => "job_test_id"),
  emitWebhookEventMock: vi.fn(async () => undefined),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: { sendEmailNow: sendEmailNowMock },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: queueGHLSyncMock,
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: emitWebhookEventMock,
  WEBHOOK_EVENT_TYPES: [],
}));

import { buildTestApp } from "./test-app";
import authRouter from "../routes/auth";
import { __resetCaptchaWarningForTests } from "../middleware/captcha";

let app: ReturnType<typeof buildTestApp>;
const realFetch = global.fetch;
const fetchMock = vi.fn();

beforeAll(() => {
  app = buildTestApp({ routers: [authRouter] });
});

beforeEach(() => {
  __resetCaptchaWarningForTests();
  delete process.env.TURNSTILE_SECRET_KEY;
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.TURNSTILE_SECRET_KEY;
});

describe("POST /api/auth/register Turnstile verification", () => {
  it("bypasses verification when TURNSTILE_SECRET_KEY is unset", async () => {
    // Use a malformed email so the handler 400s on email-format validation
    // before touching the database. If captcha rejected the request we'd see
    // a CAPTCHA_REQUIRED structured error instead of the legacy
    // `{ error: "Invalid email format" }` body.
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: "Brandnew1!", name: "X" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid email format" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects the request with 400 CAPTCHA_REQUIRED when the secret is set and no token is provided", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: "Brandnew1!", name: "X" });

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("CAPTCHA_REQUIRED");
    // Should not have made a verification call when no token is present.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects with 400 CAPTCHA_REQUIRED when the token is an empty/whitespace string", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: "not-an-email",
        password: "Brandnew1!",
        name: "X",
        captchaToken: "   ",
      });

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("CAPTCHA_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects with 400 CAPTCHA_INVALID when Turnstile says the token failed", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: "not-an-email",
        password: "Brandnew1!",
        name: "X",
        captchaToken: "bad-token",
      });

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("CAPTCHA_INVALID");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(init?.method).toBe("POST");
    const body = String(init?.body ?? "");
    expect(body).toContain("secret=test-secret");
    expect(body).toContain("response=bad-token");
  });

  it("rejects with 400 CAPTCHA_INVALID when the verification call throws", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: "not-an-email",
        password: "Brandnew1!",
        name: "X",
        captchaToken: "any-token",
      });

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("CAPTCHA_INVALID");
  });

  it("rejects with 400 CAPTCHA_INVALID when Turnstile responds with a non-2xx HTTP status", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    fetchMock.mockResolvedValueOnce(
      new Response("server error", { status: 502 }),
    );

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: "not-an-email",
        password: "Brandnew1!",
        name: "X",
        captchaToken: "any-token",
      });

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("CAPTCHA_INVALID");
  });

  it("forwards the request to the handler when the token verifies successfully", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Use a malformed email so the handler 400s on email format AFTER the
    // captcha verifies — proving the middleware called next() rather than
    // short-circuiting the response.
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: "not-an-email",
        password: "Brandnew1!",
        name: "X",
        captchaToken: "good-token",
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid email format" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("also accepts the standard cf-turnstile-response field name", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: "not-an-email",
        password: "Brandnew1!",
        name: "X",
        "cf-turnstile-response": "good-token",
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid email format" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
