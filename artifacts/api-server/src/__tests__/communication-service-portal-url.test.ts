import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { randomUUID } from "crypto";
import {
  db,
  communicationLogTable,
  emailTemplatesTable,
  systemSettingsTable,
} from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import {
  PORTAL_URL_SETTING_KEY,
  __invalidatePortalUrlCacheForTests,
} from "../lib/portal-url-settings";

// Hoist the SendGrid send spy so the vi.mock factory can register it before
// communication-service is evaluated. We assert the html/text passed into
// sgMail.send() to confirm the {{portal_url}} substitution honored the DB
// row at send-time rather than a hard-coded constant.
// SENDGRID_API_KEY is captured into a module-level const inside
// communication-service.ts at import time, so it must be set BEFORE the
// dynamic import below — vi.hoisted runs before any imports are evaluated.
vi.hoisted(() => {
  process.env.SENDGRID_API_KEY = "SG.test-key-not-real";
});

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(
    async (
      _msg: { html: string; text: string; [k: string]: unknown },
    ): Promise<[{ headers: Record<string, string> }, unknown]> => [
      { headers: { "x-message-id": "stub-msg-id" } },
      {},
    ],
  ),
}));

vi.mock("@sendgrid/mail", () => ({
  default: {
    setApiKey: vi.fn(),
    send: sendMock,
  },
}));

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: async () => false,
}));

import { CommunicationService } from "../lib/communication-service";

const TEST_TAG = `comms-portal-${randomUUID().slice(0, 8)}`;
const TEMPLATE_SLUG = `${TEST_TAG}-welcome`;

const ORIGINAL_PORTAL_URL = process.env.PORTAL_URL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_SENDGRID_KEY = process.env.SENDGRID_API_KEY;

async function clearPortalRow() {
  await db
    .delete(systemSettingsTable)
    .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
  __invalidatePortalUrlCacheForTests();
}

async function setPortalRow(url: string) {
  await clearPortalRow();
  await db.insert(systemSettingsTable).values({
    key: PORTAL_URL_SETTING_KEY,
    value: url,
    category: "branding",
  });
  __invalidatePortalUrlCacheForTests();
}

beforeAll(async () => {
  // SendGrid key must look set so sendEmailDirect calls sgMail.send instead
  // of short-circuiting to "skipped:provider_not_configured" before the
  // {{portal_url}} substitution we care about can be observed.
  process.env.SENDGRID_API_KEY = "SG.test-key-not-real";

  await db.insert(emailTemplatesTable).values({
    slug: TEMPLATE_SLUG,
    name: "Test welcome for portal URL resolution",
    subject: "Welcome to {{company_name}}",
    htmlBody:
      '<a href="{{portal_url}}/dashboard">Open dashboard</a>',
    textBody: "Open: {{portal_url}}/dashboard",
    category: "transactional",
    active: true,
  });
});

afterAll(async () => {
  await db
    .delete(emailTemplatesTable)
    .where(inArray(emailTemplatesTable.slug, [TEMPLATE_SLUG]));
  await clearPortalRow();

  if (ORIGINAL_PORTAL_URL === undefined) {
    delete process.env.PORTAL_URL;
  } else {
    process.env.PORTAL_URL = ORIGINAL_PORTAL_URL;
  }
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
  if (ORIGINAL_SENDGRID_KEY === undefined) {
    delete process.env.SENDGRID_API_KEY;
  } else {
    process.env.SENDGRID_API_KEY = ORIGINAL_SENDGRID_KEY;
  }
});

beforeEach(async () => {
  sendMock.mockClear();
  await clearPortalRow();
  delete process.env.PORTAL_URL;
  process.env.NODE_ENV = "test";
});

// Regression test for the per-tenant portal URL rollout. Before this work,
// every branded email substituted {{portal_url}} from a module-level constant
// that captured process.env.PORTAL_URL exactly once at import time, so
// tenants who saved a per-tenant URL via the admin Settings UI still received
// emails pointing at the wrong domain. Now the substitution is driven by
// the per-tenant resolver, so updating the system_settings row should be
// reflected on the very next send.
describe("CommunicationService renders {{portal_url}} from the per-tenant resolver", () => {
  it("uses the DB row's value, and switches when the row changes", async () => {
    await setPortalRow("https://portal.acme.example");

    const first = await CommunicationService.sendEmailNow({
      templateSlug: TEMPLATE_SLUG,
      to: "first@example.test",
    });
    expect(first.status).toBe("sent");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const firstMsg = sendMock.mock.calls[0]![0] as unknown as {
      html: string;
      text: string;
    };
    expect(firstMsg.html).toContain(
      'href="https://portal.acme.example/dashboard"',
    );
    expect(firstMsg.text).toContain("https://portal.acme.example/dashboard");
    expect(firstMsg.html).not.toContain("portal.buildtestscale.com");

    // Change the DB row mid-flight. The resolver caches for ~10s but the
    // setter (and our test helper) invalidates the cache synchronously, so
    // the next send must observe the new value.
    await setPortalRow("https://members.foo.example");

    const second = await CommunicationService.sendEmailNow({
      templateSlug: TEMPLATE_SLUG,
      to: "second@example.test",
    });
    expect(second.status).toBe("sent");
    expect(sendMock).toHaveBeenCalledTimes(2);
    const secondMsg = sendMock.mock.calls[1]![0] as unknown as {
      html: string;
      text: string;
    };
    expect(secondMsg.html).toContain(
      'href="https://members.foo.example/dashboard"',
    );
    expect(secondMsg.html).not.toContain("portal.acme.example");
  });

  it("falls back to the PORTAL_URL env var when no DB row exists", async () => {
    process.env.PORTAL_URL = "https://from-env.example";
    __invalidatePortalUrlCacheForTests();

    const result = await CommunicationService.sendEmailNow({
      templateSlug: TEMPLATE_SLUG,
      to: "env@example.test",
    });
    expect(result.status).toBe("sent");
    const lastCall = sendMock.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const msg = lastCall![0] as unknown as { html: string };
    expect(msg.html).toContain('href="https://from-env.example/dashboard"');
  });

  it("skips the send in production and records the reason in communication_log when no portal URL is configured", async () => {
    process.env.NODE_ENV = "production";
    // No DB row, no env var. Previously this path rendered {{portal_url}} as
    // an empty string and went out with a broken `/reset-password?token=...`
    // href; now we refuse to ship the broken link and record a skipped
    // communication_log row so on-call can see why the send didn't happen.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await CommunicationService.sendEmailNow({
      templateSlug: TEMPLATE_SLUG,
      to: "missing@example.test",
    });
    expect(result.status).toBe("skipped");
    expect(result.status === "skipped" && result.reason).toBe(
      "portal_url_unconfigured",
    );
    // SendGrid should NOT have been called for this send.
    expect(sendMock).not.toHaveBeenCalled();

    expect(
      errorSpy.mock.calls.some(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("no portal URL configured"),
      ),
    ).toBe(true);

    // The skip is breadcrumbed in communication_log with status=skipped,
    // a stable reason in errorMessage, and a metadata.reason that the
    // Communications Log dialog can surface.
    const [logRow] = await db
      .select()
      .from(communicationLogTable)
      .where(eq(communicationLogTable.recipientEmail, "missing@example.test"))
      .orderBy(desc(communicationLogTable.id))
      .limit(1);
    expect(logRow).toBeDefined();
    expect(logRow!.status).toBe("skipped");
    expect(logRow!.templateSlug).toBe(TEMPLATE_SLUG);
    expect(logRow!.errorMessage).toBe("portal_url_unconfigured");
    expect((logRow!.metadata as { reason?: string } | null)?.reason).toBe(
      "portal_url_unconfigured",
    );

    errorSpy.mockRestore();
  });

  it("still sends in production when no portal URL is configured but the template does NOT reference {{portal_url}}", async () => {
    process.env.NODE_ENV = "production";
    // Templates without `{{portal_url}}` (e.g. plain-text broadcasts) are
    // unaffected — only sends that would actually ship a broken link are
    // skipped.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const plainSlug = `${TEST_TAG}-plain`;
    await db.insert(emailTemplatesTable).values({
      slug: plainSlug,
      name: "Plain template with no portal link",
      subject: "Hello {{company_name}}",
      htmlBody: "<p>Welcome.</p>",
      textBody: "Welcome.",
      category: "transactional",
      active: true,
    });

    try {
      const result = await CommunicationService.sendEmailNow({
        templateSlug: plainSlug,
        to: "plain@example.test",
      });
      expect(result.status).toBe("sent");
      expect(sendMock).toHaveBeenCalledTimes(1);
    } finally {
      await db
        .delete(emailTemplatesTable)
        .where(eq(emailTemplatesTable.slug, plainSlug));
      errorSpy.mockRestore();
    }
  });
});
