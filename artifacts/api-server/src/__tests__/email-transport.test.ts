/**
 * Unit tests for the email/SMS transport gate (lib/email-transport.ts).
 *
 * Coverage:
 *   - Dev suppression (no allowlist → suppress)
 *   - Production pass-through (NODE_ENV=production)
 *   - "*" wildcard allowlist
 *   - Specific-address allowlist (match + no-match)
 *   - Case-insensitive allowlist matching
 *   - Console log on suppression
 *   - SMS parity (gatedSendSms)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import sgMail from "@sendgrid/mail";

vi.mock("@sendgrid/mail", () => ({
  default: {
    send: vi.fn(),
    setApiKey: vi.fn(),
  },
}));

const mockSend = vi.mocked(sgMail.send);

const FAKE_RESPONSE: [import("@sendgrid/mail").ClientResponse, object] = [
  { statusCode: 202, headers: {}, body: {} } as import("@sendgrid/mail").ClientResponse,
  {},
];

async function importTransport() {
  return await import("../lib/email-transport");
}

describe("email transport gate", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    savedEnv.DEV_EMAIL_ALLOWLIST = process.env.DEV_EMAIL_ALLOWLIST;
    savedEnv.DEV_SMS_ALLOWLIST = process.env.DEV_SMS_ALLOWLIST;

    process.env.NODE_ENV = "test";
    delete process.env.DEV_EMAIL_ALLOWLIST;
    delete process.env.DEV_SMS_ALLOWLIST;
    vi.clearAllMocks();

    const { __resetSgApiKeyForTests } = await importTransport();
    __resetSgApiKeyForTests();
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.DEV_EMAIL_ALLOWLIST !== undefined) {
      process.env.DEV_EMAIL_ALLOWLIST = savedEnv.DEV_EMAIL_ALLOWLIST;
    } else {
      delete process.env.DEV_EMAIL_ALLOWLIST;
    }
    if (savedEnv.DEV_SMS_ALLOWLIST !== undefined) {
      process.env.DEV_SMS_ALLOWLIST = savedEnv.DEV_SMS_ALLOWLIST;
    } else {
      delete process.env.DEV_SMS_ALLOWLIST;
    }
  });

  describe("gatedSendEmail — suppression", () => {
    it("suppresses email in non-production when no allowlist configured", async () => {
      const { gatedSendEmail } = await importTransport();
      const result = await gatedSendEmail({
        to: "user@example.com",
        from: "from@example.com",
        subject: "Test",
        text: "hi",
      });
      expect("devSuppressed" in result).toBe(true);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("passes through email in production regardless of allowlist", async () => {
      process.env.NODE_ENV = "production";
      process.env.SENDGRID_API_KEY = "SG.test";
      mockSend.mockResolvedValueOnce(FAKE_RESPONSE);
      const { gatedSendEmail } = await importTransport();
      await gatedSendEmail({
        to: "user@example.com",
        from: "from@example.com",
        subject: "Test",
        text: "hi",
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
      delete process.env.SENDGRID_API_KEY;
    });

    it("passes through email when allowlist is *", async () => {
      process.env.DEV_EMAIL_ALLOWLIST = "*";
      process.env.SENDGRID_API_KEY = "SG.test";
      mockSend.mockResolvedValueOnce(FAKE_RESPONSE);
      const { gatedSendEmail } = await importTransport();
      const result = await gatedSendEmail({
        to: "user@example.com",
        from: "from@example.com",
        subject: "Test",
        text: "hi",
      });
      expect("devSuppressed" in result).toBe(false);
      expect(mockSend).toHaveBeenCalledTimes(1);
      delete process.env.SENDGRID_API_KEY;
    });

    it("passes through email when recipient is in allowlist", async () => {
      process.env.DEV_EMAIL_ALLOWLIST = "user@example.com,admin@example.com";
      process.env.SENDGRID_API_KEY = "SG.test";
      mockSend.mockResolvedValueOnce(FAKE_RESPONSE);
      const { gatedSendEmail } = await importTransport();
      await gatedSendEmail({
        to: "user@example.com",
        from: "from@example.com",
        subject: "Test",
        text: "hi",
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
      delete process.env.SENDGRID_API_KEY;
    });

    it("suppresses email when recipient is NOT in allowlist", async () => {
      process.env.DEV_EMAIL_ALLOWLIST = "admin@example.com";
      const { gatedSendEmail } = await importTransport();
      const result = await gatedSendEmail({
        to: "user@example.com",
        from: "from@example.com",
        subject: "Test",
        text: "hi",
      });
      expect("devSuppressed" in result).toBe(true);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("allowlist matching is case-insensitive", async () => {
      process.env.DEV_EMAIL_ALLOWLIST = "USER@EXAMPLE.COM";
      process.env.SENDGRID_API_KEY = "SG.test";
      mockSend.mockResolvedValueOnce(FAKE_RESPONSE);
      const { gatedSendEmail } = await importTransport();
      await gatedSendEmail({
        to: "user@example.com",
        from: "from@example.com",
        subject: "Test",
        text: "hi",
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
      delete process.env.SENDGRID_API_KEY;
    });

    it("returns devSuppressed=true with the to address in the result", async () => {
      const { gatedSendEmail, isDevSuppressedResult } = await importTransport();
      const result = await gatedSendEmail({
        to: "target@example.com",
        from: "from@example.com",
        subject: "X",
        text: "body",
      });
      expect(isDevSuppressedResult(result)).toBe(true);
      if ("devSuppressed" in result) {
        expect(result.to).toBe("target@example.com");
      }
    });

    it("logs suppressed email to console", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const { gatedSendEmail } = await importTransport();
        await gatedSendEmail({
          to: "user@example.com",
          from: "from@example.com",
          subject: "My Subject",
          text: "hi",
        });
        const calls = consoleSpy.mock.calls.map((args) => args.join(" "));
        const match = calls.find((c) => c.includes("[DEV-SUPPRESSED]"));
        expect(match).toBeDefined();
        expect(match).toContain("My Subject");
        expect(match).toContain("user@example.com");
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  describe("isDevSuppressedResult type-guard", () => {
    it("returns true for DevSuppressedResult", async () => {
      const { isDevSuppressedResult } = await importTransport();
      expect(isDevSuppressedResult({ devSuppressed: true, to: "a@b.com" })).toBe(true);
    });

    it("returns false for a [ClientResponse, object] tuple", async () => {
      const { isDevSuppressedResult } = await importTransport();
      expect(isDevSuppressedResult(FAKE_RESPONSE)).toBe(false);
    });

    it("returns false for a {sid} object", async () => {
      const { isDevSuppressedResult } = await importTransport();
      expect(isDevSuppressedResult({ sid: "SM123" })).toBe(false);
    });
  });

  describe("gatedSendSms — suppression", () => {
    const mockCreate = vi.fn();
    const mockClient = { messages: { create: mockCreate } };

    beforeEach(() => {
      mockCreate.mockReset();
    });

    it("suppresses SMS in non-production when no allowlist configured", async () => {
      const { gatedSendSms } = await importTransport();
      const result = await gatedSendSms(mockClient, {
        to: "+11234567890",
        from: "+10987654321",
        body: "test",
      });
      expect("devSuppressed" in result).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("passes through SMS when allowlist is *", async () => {
      process.env.DEV_SMS_ALLOWLIST = "*";
      mockCreate.mockResolvedValueOnce({ sid: "SM123" });
      const { gatedSendSms } = await importTransport();
      const result = await gatedSendSms(mockClient, {
        to: "+11234567890",
        from: "+10987654321",
        body: "test",
      });
      expect("devSuppressed" in result).toBe(false);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("passes through SMS when recipient is in allowlist", async () => {
      process.env.DEV_SMS_ALLOWLIST = "+11234567890,+19998887776";
      mockCreate.mockResolvedValueOnce({ sid: "SM456" });
      const { gatedSendSms } = await importTransport();
      await gatedSendSms(mockClient, {
        to: "+11234567890",
        from: "+10987654321",
        body: "test",
      });
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("suppresses SMS when recipient is NOT in allowlist", async () => {
      process.env.DEV_SMS_ALLOWLIST = "+19998887776";
      const { gatedSendSms } = await importTransport();
      const result = await gatedSendSms(mockClient, {
        to: "+11234567890",
        from: "+10987654321",
        body: "test",
      });
      expect("devSuppressed" in result).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("passes through SMS in production regardless of allowlist", async () => {
      process.env.NODE_ENV = "production";
      mockCreate.mockResolvedValueOnce({ sid: "SM789" });
      const { gatedSendSms } = await importTransport();
      await gatedSendSms(mockClient, {
        to: "+11234567890",
        from: "+10987654321",
        body: "test",
      });
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("passes the full params to twilioClient.messages.create", async () => {
      process.env.DEV_SMS_ALLOWLIST = "*";
      mockCreate.mockResolvedValueOnce({ sid: "SM_FULL" });
      const { gatedSendSms } = await importTransport();
      await gatedSendSms(mockClient, {
        to: "+11234567890",
        from: "+10987654321",
        body: "Hello world",
        statusCallback: "https://example.com/callback",
      });
      expect(mockCreate).toHaveBeenCalledWith({
        to: "+11234567890",
        from: "+10987654321",
        body: "Hello world",
        statusCallback: "https://example.com/callback",
      });
    });

    it("logs suppressed SMS to console", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const { gatedSendSms } = await importTransport();
        await gatedSendSms(mockClient, {
          to: "+11234567890",
          from: "+10987654321",
          body: "hi",
        });
        const calls = consoleSpy.mock.calls.map((args) => args.join(" "));
        const match = calls.find((c) => c.includes("[DEV-SUPPRESSED]"));
        expect(match).toBeDefined();
        expect(match).toContain("+11234567890");
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  describe("isDevEmailSuppressed / isDevSmsSuppressed helpers", () => {
    it("isDevEmailSuppressed returns true in test env without allowlist", async () => {
      const { isDevEmailSuppressed } = await importTransport();
      expect(isDevEmailSuppressed("any@example.com")).toBe(true);
    });

    it("isDevEmailSuppressed returns false in production", async () => {
      process.env.NODE_ENV = "production";
      const { isDevEmailSuppressed } = await importTransport();
      expect(isDevEmailSuppressed("any@example.com")).toBe(false);
    });

    it("isDevSmsSuppressed returns true in test env without allowlist", async () => {
      const { isDevSmsSuppressed } = await importTransport();
      expect(isDevSmsSuppressed("+11234567890")).toBe(true);
    });

    it("isDevSmsSuppressed returns false when allowlist is *", async () => {
      process.env.DEV_SMS_ALLOWLIST = "*";
      const { isDevSmsSuppressed } = await importTransport();
      expect(isDevSmsSuppressed("+11234567890")).toBe(false);
    });
  });
});
