/**
 * Regression guard: ensures every sgMail.send() and twilioClient.messages.create()
 * call is routed through lib/email-transport.ts — the single seam that owns
 * the dev suppression gate.
 *
 * If you hit a failure here, replace your direct call with gatedSendEmail() or
 * gatedSendSms() from lib/email-transport.ts and remove the raw provider import
 * from your module.
 *
 * Exempt from this check:
 *   - lib/email-transport.ts itself (the seam implementation)
 *   - scripts/blast-all-emails.ts  (standalone blast script, runs in prod only)
 *   - scripts/blast-all-emails-v2.ts  (same)
 *   - this file itself
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const SRC_DIR = join(__dirname, "..");

const EXEMPT_PATHS = new Set([
  join(SRC_DIR, "lib/email-transport.ts"),
  join(SRC_DIR, "scripts/blast-all-emails.ts"),
  join(SRC_DIR, "scripts/blast-all-emails-v2.ts"),
  join(SRC_DIR, "__tests__/transport-seam-guard.test.ts"),
]);

function gatherTsFiles(dir: string): string[] {
  const result: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      let stat: ReturnType<typeof statSync> | null = null;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        result.push(...gatherTsFiles(full));
      } else if (
        full.endsWith(".ts") &&
        !full.endsWith(".d.ts") &&
        !full.endsWith(".test.ts") &&
        !EXEMPT_PATHS.has(full)
      ) {
        result.push(full);
      }
    }
  } catch {
  }
  return result;
}

const allFiles = gatherTsFiles(SRC_DIR);

describe("transport seam guard", () => {
  it("sgMail.send() must only be called from lib/email-transport.ts", () => {
    const violators: string[] = [];
    for (const f of allFiles) {
      let content: string;
      try {
        content = readFileSync(f, "utf-8");
      } catch {
        continue;
      }
      if (/\bsgMail\.send\s*\(/.test(content)) {
        violators.push(f.replace(SRC_DIR + "/", ""));
      }
    }
    expect(
      violators,
      `These files call sgMail.send() directly. Migrate to gatedSendEmail() from lib/email-transport.ts:\n${violators.map((v) => `  ${v}`).join("\n")}`,
    ).toEqual([]);
  });

  it("twilioClient.messages.create() must only be called from lib/email-transport.ts", () => {
    const violators: string[] = [];
    for (const f of allFiles) {
      let content: string;
      try {
        content = readFileSync(f, "utf-8");
      } catch {
        continue;
      }
      if (/\btwilioClient\.messages\.create\s*\(/.test(content)) {
        violators.push(f.replace(SRC_DIR + "/", ""));
      }
    }
    expect(
      violators,
      `These files call twilioClient.messages.create() directly. Migrate to gatedSendSms() from lib/email-transport.ts:\n${violators.map((v) => `  ${v}`).join("\n")}`,
    ).toEqual([]);
  });
});
