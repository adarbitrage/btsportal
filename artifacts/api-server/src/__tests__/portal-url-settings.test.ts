import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  PORTAL_URL_SETTING_KEY,
  __invalidatePortalUrlCacheForTests,
  getPortalUrl,
  getPortalUrlStatus,
  isPortalUrlSettingKey,
  normalizePortalUrl,
  setPortalUrl,
} from "../lib/portal-url-settings";

async function clearRow() {
  await db
    .delete(systemSettingsTable)
    .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
  __invalidatePortalUrlCacheForTests();
}

const ORIGINAL_PORTAL_URL = process.env.PORTAL_URL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(async () => {
  await clearRow();
  // Tests own the env: each test sets/clears explicitly so we don't pick
  // up whatever the run-level config left in place.
  delete process.env.PORTAL_URL;
  process.env.NODE_ENV = "test";
});

afterAll(async () => {
  await clearRow();
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
});

describe("normalizePortalUrl", () => {
  it("accepts an absolute https URL and trims trailing slashes", () => {
    expect(normalizePortalUrl("https://portal.acme.example///")).toEqual({
      ok: true,
      url: "https://portal.acme.example",
    });
  });

  it("accepts http for local-dev URLs", () => {
    expect(normalizePortalUrl("http://localhost:5000")).toEqual({
      ok: true,
      url: "http://localhost:5000",
    });
  });

  it("preserves a sub-path so tenants on /portal/ work", () => {
    expect(normalizePortalUrl("https://acme.example/portal")).toEqual({
      ok: true,
      url: "https://acme.example/portal",
    });
  });

  it("rejects javascript: and data: URLs", () => {
    expect(normalizePortalUrl("javascript:alert(1)")).toEqual({
      ok: false,
      error: expect.stringMatching(/http or https/i),
    });
    expect(normalizePortalUrl("data:text/html,<h1>x</h1>")).toEqual({
      ok: false,
      error: expect.stringMatching(/http or https/i),
    });
  });

  it("rejects relative paths", () => {
    expect(normalizePortalUrl("/account")).toEqual({
      ok: false,
      error: expect.stringMatching(/absolute/i),
    });
  });

  it("rejects empty / non-string input", () => {
    expect(normalizePortalUrl("")).toEqual({
      ok: false,
      error: expect.stringMatching(/empty/i),
    });
    expect(normalizePortalUrl("   ")).toEqual({
      ok: false,
      error: expect.stringMatching(/empty/i),
    });
    expect(normalizePortalUrl(null)).toEqual({
      ok: false,
      error: expect.stringMatching(/string/i),
    });
    expect(normalizePortalUrl(42)).toEqual({
      ok: false,
      error: expect.stringMatching(/string/i),
    });
  });
});

describe("isPortalUrlSettingKey", () => {
  it("matches only the exact key", () => {
    expect(isPortalUrlSettingKey(PORTAL_URL_SETTING_KEY)).toBe(true);
    expect(isPortalUrlSettingKey("branding.something_else")).toBe(false);
    expect(isPortalUrlSettingKey("oncall.pagerduty_integration_key")).toBe(false);
  });
});

describe("getPortalUrl resolution order", () => {
  it("prefers the DB row over the env var when both are set", async () => {
    process.env.PORTAL_URL = "https://from-env.example";
    await setPortalUrl("https://from-db.example", "test");
    const status = await getPortalUrlStatus();
    expect(status).toEqual({
      portalUrl: "https://from-db.example",
      source: "db",
    });
  });

  it("falls back to the env var when no DB row exists", async () => {
    process.env.PORTAL_URL = "https://from-env.example";
    const status = await getPortalUrlStatus();
    expect(status).toEqual({
      portalUrl: "https://from-env.example",
      source: "env",
    });
  });

  it("falls back to the dev default when nothing is set and NODE_ENV != production", async () => {
    process.env.NODE_ENV = "development";
    const status = await getPortalUrlStatus();
    expect(status.source).toBe("dev_default");
    expect(status.portalUrl).toMatch(/^http/);
  });

  it("returns null in production when nothing is configured", async () => {
    process.env.NODE_ENV = "production";
    const status = await getPortalUrlStatus();
    expect(status).toEqual({ portalUrl: null, source: null });
    expect(await getPortalUrl()).toBeNull();
  });

  it("ignores a malformed env var rather than shipping a bad URL", async () => {
    process.env.PORTAL_URL = "not a url";
    process.env.NODE_ENV = "production";
    const status = await getPortalUrlStatus();
    expect(status).toEqual({ portalUrl: null, source: null });
  });

  it("ignores a malformed DB row and falls through to env", async () => {
    // Insert a corrupt row directly so we exercise the read-path validation.
    await db.insert(systemSettingsTable).values({
      key: PORTAL_URL_SETTING_KEY,
      value: "javascript:alert(1)",
      category: "branding",
    });
    __invalidatePortalUrlCacheForTests();
    process.env.PORTAL_URL = "https://from-env.example";
    const status = await getPortalUrlStatus();
    expect(status).toEqual({
      portalUrl: "https://from-env.example",
      source: "env",
    });
  });

  it("trims trailing slashes on stored values", async () => {
    const result = await setPortalUrl("https://portal.acme.example///", "test");
    expect(result).toEqual({
      ok: true,
      portalUrl: "https://portal.acme.example",
    });
    const status = await getPortalUrlStatus();
    expect(status.portalUrl).toBe("https://portal.acme.example");
  });
});

describe("setPortalUrl", () => {
  it("rejects invalid URLs without writing to the DB", async () => {
    const result = await setPortalUrl("javascript:alert(1)", "test");
    expect(result.ok).toBe(false);
    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
    expect(row).toBeUndefined();
  });

  it("clearing with null deletes the row so the read path falls back", async () => {
    await setPortalUrl("https://portal.acme.example", "test");
    process.env.PORTAL_URL = "https://from-env.example";
    const cleared = await setPortalUrl(null, "test");
    expect(cleared).toEqual({ ok: true, portalUrl: null });
    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
    expect(row).toBeUndefined();
    const status = await getPortalUrlStatus();
    expect(status).toEqual({
      portalUrl: "https://from-env.example",
      source: "env",
    });
  });

  it("upserts cleanly when called twice", async () => {
    await setPortalUrl("https://first.example", "test");
    await setPortalUrl("https://second.example", "test");
    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("https://second.example");
  });
});
