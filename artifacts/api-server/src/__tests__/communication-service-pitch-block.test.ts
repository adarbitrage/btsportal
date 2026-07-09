import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import {
  db,
  emailTemplatesTable,
  systemSettingsTable,
  usersTable,
  productsTable,
  userProductsTable,
  communicationLogTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { PORTAL_URL_SETTING_KEY, __invalidatePortalUrlCacheForTests } from "../lib/portal-url-settings";
import { getPitchContentSettingKeys, __invalidatePitchContentCacheForTests } from "../lib/pitch-content-settings";

// Task #1715: verifies communication-service actually wires the pitch
// resolver into the {{pitch_block_html}} slot at send time — the DB row +
// resolveMemberRank / renderPitchStackHtml pieces are unit-tested separately
// (pitch-resolver.test.ts, pitch-content-settings.test.ts); this test proves
// the two are connected end-to-end through queueEmail / sendEmailNow.

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
  default: { setApiKey: vi.fn(), send: sendMock },
}));

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: async () => false,
}));

import { CommunicationService } from "../lib/communication-service";

const TEST_TAG = `comms-pitch-${randomUUID().slice(0, 8)}`;
const LIFECYCLE_TEMPLATE_SLUG = `${TEST_TAG}-lifecycle`;
const MARKETING_TEMPLATE_SLUG = `${TEST_TAG}-marketing`;
const seededUserIds: number[] = [];

async function seedMember(): Promise<number> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Comms Pitch Test",
      passwordHash,
      role: "member",
      sourceProduct: null,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function grantLaunchpad(userId: number): Promise<void> {
  const [product] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, "launchpad"));
  if (!product) throw new Error('Expected dev-seeded product "launchpad" to exist');
  await db.insert(userProductsTable).values({
    userId,
    productId: product.id,
    status: "active",
    purchasedAt: new Date(),
  });
}

async function setPortalRow(url: string) {
  await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
  await db.insert(systemSettingsTable).values({ key: PORTAL_URL_SETTING_KEY, value: url, category: "branding" });
  __invalidatePortalUrlCacheForTests();
}

beforeAll(async () => {
  process.env.SENDGRID_API_KEY = "SG.test-key-not-real";
  process.env.NODE_ENV = "test";
  await setPortalRow("https://portal.pitch-test.example");

  await db.insert(emailTemplatesTable).values([
    {
      slug: LIFECYCLE_TEMPLATE_SLUG,
      name: "Test lifecycle template with pitch slot",
      subject: "Hello",
      htmlBody: "<div>Body</div>{{pitch_block_html}}",
      textBody: "Body",
      category: "transactional",
      active: true,
    },
    {
      slug: MARKETING_TEMPLATE_SLUG,
      name: "Test marketing template with pitch slot",
      subject: "Announcement",
      htmlBody: "<div>Announcement body</div>{{pitch_block_html}}",
      textBody: "Announcement body",
      category: "marketing",
      active: true,
    },
  ]);
});

afterAll(async () => {
  await db.delete(emailTemplatesTable).where(inArray(emailTemplatesTable.slug, [LIFECYCLE_TEMPLATE_SLUG, MARKETING_TEMPLATE_SLUG]));
  await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
  await db.delete(systemSettingsTable).where(inArray(systemSettingsTable.key, getPitchContentSettingKeys()));
  for (const id of seededUserIds) {
    await db.delete(userProductsTable).where(eq(userProductsTable.userId, id));
    await db.delete(communicationLogTable).where(eq(communicationLogTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
  __invalidatePortalUrlCacheForTests();
  __invalidatePitchContentCacheForTests();
});

beforeEach(() => {
  sendMock.mockClear();
});

describe("CommunicationService populates {{pitch_block_html}} for lifecycle sends", () => {
  it("sendEmailNow renders the rank-0 stack (LaunchPad, Machine, VIP) for a member with no products", async () => {
    const userId = await seedMember();
    const result = await CommunicationService.sendEmailNow({
      templateSlug: LIFECYCLE_TEMPLATE_SLUG,
      to: "rank0@example.test",
      userId,
    });
    expect(result.status).toBe("sent");
    const html = (sendMock.mock.calls.at(-1)![0] as { html: string }).html;
    expect(html).toContain("LaunchPad");
    expect(html).toContain("VIP");
    expect(html).not.toContain("{{pitch_block_html}}");
  });

  it("sendEmailNow renders the rank-1 stack (Mentorship, Machine, VIP) for a LaunchPad member", async () => {
    const userId = await seedMember();
    await grantLaunchpad(userId);
    const result = await CommunicationService.sendEmailNow({
      templateSlug: LIFECYCLE_TEMPLATE_SLUG,
      to: "rank1@example.test",
      userId,
    });
    expect(result.status).toBe("sent");
    const html = (sendMock.mock.calls.at(-1)![0] as { html: string }).html;
    expect(html).toContain("Mentorship");
    expect(html).not.toContain("LaunchPad Pitch");
  });

  it("queueEmail (via the sync fallback path with Redis down) also populates the pitch slot", async () => {
    const userId = await seedMember();
    const result = await CommunicationService.queueEmail({
      templateSlug: LIFECYCLE_TEMPLATE_SLUG,
      to: "queued@example.test",
      userId,
    });
    // With Redis unavailable, queueEmail falls back to sending synchronously.
    expect(sendMock).toHaveBeenCalled();
    const html = (sendMock.mock.calls.at(-1)![0] as { html: string }).html;
    expect(html).toContain("LaunchPad");
    expect(result).toBeDefined();
  });

  it("does not populate the slot when there is no userId (renders empty)", async () => {
    const result = await CommunicationService.sendEmailNow({
      templateSlug: LIFECYCLE_TEMPLATE_SLUG,
      to: "nouser@example.test",
    });
    expect(result.status).toBe("sent");
    const html = (sendMock.mock.calls.at(-1)![0] as { html: string }).html;
    expect(html).not.toContain("LaunchPad");
    expect(html).not.toContain("{{pitch_block_html}}");
  });

  // Task #1819: a `category: "marketing"` DB template is no longer an
  // exclusion by itself — only the three security-slug exclusions block the
  // pitch slot now. This mirrors the real-world fix for formerly
  // marketing-gated templates like streak_milestone.
  it("DOES populate the slot for a marketing-category send with a userId (category is no longer a gate)", async () => {
    const userId = await seedMember();
    const result = await CommunicationService.sendEmailNow({
      templateSlug: MARKETING_TEMPLATE_SLUG,
      to: "marketing@example.test",
      userId,
    });
    expect(result.status).toBe("sent");
    const html = (sendMock.mock.calls.at(-1)![0] as { html: string }).html;
    expect(html).toContain("LaunchPad");
    expect(html).not.toContain("{{pitch_block_html}}");
  });

  // Task #1819: the seam is now authoritative — a caller-supplied
  // pitch_block_html no longer short-circuits resolution when a userId is
  // resolvable. This is what structurally prevents double-stacking.
  it("ignores a caller-supplied pitch_block_html when a userId is resolvable — the seam's resolved value wins", async () => {
    const userId = await seedMember();
    const result = await CommunicationService.sendEmailNow({
      templateSlug: LIFECYCLE_TEMPLATE_SLUG,
      to: "explicit@example.test",
      userId,
      variables: { pitch_block_html: "<p>Caller-supplied pitch</p>" },
    });
    expect(result.status).toBe("sent");
    const html = (sendMock.mock.calls.at(-1)![0] as { html: string }).html;
    expect(html).not.toContain("Caller-supplied pitch");
    expect(html).toContain("LaunchPad");
  });

  // Task #1819: preview/blast scripts with no userId still rely on a
  // caller-supplied pitch_block_html as a fallback — this is the one case
  // where it's still honored.
  it("still honors a caller-supplied pitch_block_html when there is no userId", async () => {
    const result = await CommunicationService.sendEmailNow({
      templateSlug: LIFECYCLE_TEMPLATE_SLUG,
      to: "explicit-nouser@example.test",
      variables: { pitch_block_html: "<p>Caller-supplied pitch</p>" },
    });
    expect(result.status).toBe("sent");
    const html = (sendMock.mock.calls.at(-1)![0] as { html: string }).html;
    expect(html).toContain("Caller-supplied pitch");
  });

  // Task #1819: the three security-sensitive slugs must never carry a pitch,
  // even for a fully-ranked member.
  describe("security-slug exclusion list", () => {
    const EXCLUDED_SLUGS = ["password_reset", "email_verification", "flexy_password_reset"];

    for (const slug of EXCLUDED_SLUGS) {
      it(`never populates the slot for "${slug}", even with a ranked member userId`, async () => {
        const userId = await seedMember();
        await grantLaunchpad(userId);
        const [template] = await db
          .select({ id: emailTemplatesTable.id })
          .from(emailTemplatesTable)
          .where(eq(emailTemplatesTable.slug, slug));
        if (!template) throw new Error(`Expected seeded template "${slug}" to exist`);
        const result = await CommunicationService.sendEmailNow({
          templateSlug: slug,
          to: `${slug}-excluded@example.test`,
          userId,
          variables: { member_name: "Test", reset_token: "tok", verify_token: "tok" },
        });
        expect(result.status).toBe("sent");
        const html = (sendMock.mock.calls.at(-1)![0] as { html: string }).html;
        expect(html).not.toContain("Mentorship");
        expect(html).not.toContain("LaunchPad Pitch");
        expect(html).not.toContain("{{pitch_block_html}}");
      });

      it(`does not let a caller-supplied pitch_block_html leak through on "${slug}" (seam forces it empty)`, async () => {
        const userId = await seedMember();
        await grantLaunchpad(userId);
        const result = await CommunicationService.sendEmailNow({
          templateSlug: slug,
          to: `${slug}-leak-attempt@example.test`,
          userId,
          variables: {
            member_name: "Test",
            reset_token: "tok",
            verify_token: "tok",
            pitch_block_html: "<p>Attempted caller-supplied pitch leak</p>",
          },
        });
        expect(result.status).toBe("sent");
        const html = (sendMock.mock.calls.at(-1)![0] as { html: string }).html;
        expect(html).not.toContain("Attempted caller-supplied pitch leak");
      });
    }
  });

  // Task #1819: broadcast blasts stay pitch-free even when a recipient has a
  // resolvable userId — the suppression lives inside queueBroadcastEmail
  // only, not via a general category check.
  it("queueBroadcastEmail never populates the pitch slot, even for a recipient with a userId", async () => {
    const userId = await seedMember();
    await grantLaunchpad(userId);
    const { queued } = await CommunicationService.queueBroadcastEmail({
      templateSlug: LIFECYCLE_TEMPLATE_SLUG,
      recipientList: [{ email: "broadcast@example.test", userId }],
    });
    expect(queued).toBe(1);
    const html = (sendMock.mock.calls.at(-1)![0] as { html: string }).html;
    expect(html).not.toContain("Mentorship");
    expect(html).not.toContain("LaunchPad Pitch");
    expect(html).not.toContain("{{pitch_block_html}}");
  });

  it("queueBroadcastEmail does not let a recipient-supplied pitch_block_html leak through (suppression forces it empty)", async () => {
    const userId = await seedMember();
    await grantLaunchpad(userId);
    const { queued } = await CommunicationService.queueBroadcastEmail({
      templateSlug: LIFECYCLE_TEMPLATE_SLUG,
      recipientList: [
        {
          email: "broadcast-leak-attempt@example.test",
          userId,
          variables: { pitch_block_html: "<p>Attempted recipient-supplied pitch leak</p>" },
        },
      ],
    });
    expect(queued).toBe(1);
    const html = (sendMock.mock.calls.at(-1)![0] as { html: string }).html;
    expect(html).not.toContain("Attempted recipient-supplied pitch leak");
  });

  // Task #1819 step 5(c): a caller passing its own pitch_block_html
  // alongside a resolvable userId (the exact double-stacking shape a
  // booking-confirmation send site could produce) must still end up with
  // exactly ONE occurrence of the resolved stack in the final HTML — never
  // two — because the seam now always wins over the caller-supplied value.
  it("a booking-confirmation-shaped send renders the pitch stack exactly once, never doubled", async () => {
    const userId = await seedMember();
    await grantLaunchpad(userId);
    const result = await CommunicationService.sendEmailNow({
      templateSlug: LIFECYCLE_TEMPLATE_SLUG,
      to: "booking-confirmation@example.test",
      userId,
      variables: { pitch_block_html: "<p>Caller-supplied duplicate stack</p><p>Caller-supplied duplicate stack</p>" },
    });
    expect(result.status).toBe("sent");
    const html = (sendMock.mock.calls.at(-1)![0] as { html: string }).html;
    // The caller-supplied value must be fully discarded (proves the seam,
    // not the caller, produced what's in the HTML)...
    expect(html).not.toContain("Caller-supplied duplicate stack");
    // ...and the resolver's own "Take the next step with Mentorship" heading
    // — present exactly once per stack entry — must appear exactly once,
    // not twice, proving there's no double-stacking of the seam's own output.
    const mentorshipHeadingOccurrences = (html.match(/Take the next step with Mentorship/g) ?? []).length;
    expect(mentorshipHeadingOccurrences).toBe(1);
  });
});
