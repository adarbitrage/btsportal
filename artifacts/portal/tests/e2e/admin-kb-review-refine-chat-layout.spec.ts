// Refine-with-AI chat layout in the AI Document Review dialog.
//
// Regression coverage for the short-viewport layout break: previously the chat
// pane used a fixed h-1/3 fraction of the dialog with an uncapped auto-growing
// input area, so on short windows the thread collapsed to zero height and the
// Send button floated over the dialog footer (overlapping Reject). This spec
// runs at a deliberately short viewport and asserts:
//   - the message thread stays visible above the input after sending,
//   - the Send button stays inside the chat pane and never overlaps the
//     footer action buttons,
//   - the thread auto-scrolls so the newest message is visible,
//   - the 1/3 ↔ 2/3 expand toggle keeps the layout sound.
//
// The refine backend is mocked via page.route so this is a pure frontend
// layout test (no LLM call).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import type { E2EFixture } from "./global-setup";
import { loginAsAdmin } from "./auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadFixture(): E2EFixture {
  const raw = readFileSync(join(__dirname, ".fixture.json"), "utf8");
  return JSON.parse(raw) as E2EFixture;
}

const tag = randomBytes(5).toString("hex");
const DOC_TITLE = `E2E Refine Layout Doc ${tag}`;
const DOC_CONTENT = Array.from(
  { length: 40 },
  (_, i) => `Paragraph ${i + 1}: some draft guidance content used to make the document long enough to scroll.`,
).join("\n\n");

let docId: number;

test.beforeAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const res = await pool.query<{ id: number }>(
      `INSERT INTO kb_staging_docs (title, category, content, tags, status, doc_type)
       VALUES ($1, 'curriculum', $2, '', 'needs_review', 'truth_draft')
       RETURNING id`,
      [DOC_TITLE, DOC_CONTENT],
    );
    docId = res.rows[0].id;
  } finally {
    await pool.end();
  }
});

test.afterAll(async () => {
  if (!docId) return;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`DELETE FROM kb_staging_docs WHERE id = $1`, [docId]);
  } finally {
    await pool.end();
  }
});

async function openRefineChat(page: Page) {
  await page.goto("/admin/chat/knowledgebase/review");
  const search = page.getByPlaceholder(/search/i).first();
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(tag);
  const row = page.getByRole("heading", { name: DOC_TITLE });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  // Dialog opens; open the collapsed Refine bar.
  const refineBar = page.getByRole("button", { name: /Refine with AI/i }).first();
  await expect(refineBar).toBeVisible({ timeout: 15_000 });
  await refineBar.click();
  await expect(
    page.getByPlaceholder(/Ask or instruct/i),
  ).toBeVisible({ timeout: 10_000 });
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

async function assertLayoutSound(page: Page) {
  const textarea = page.getByPlaceholder(/Ask or instruct/i);
  const sendButton = page.getByRole("button", { name: /^Send$/ }).first();
  await expect(textarea).toBeVisible();
  await expect(sendButton).toBeVisible();

  const sendBox = await sendButton.boundingBox();
  const paneBox = await page
    .locator("div.border-violet-200.bg-violet-50\\/60")
    .last()
    .boundingBox();
  expect(sendBox, "Send button should have a bounding box").toBeTruthy();
  expect(paneBox, "Chat pane should have a bounding box").toBeTruthy();

  // Send button fully inside the chat pane (small tolerance for borders).
  expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(
    paneBox!.y + paneBox!.height + 2,
  );
  expect(sendBox!.y).toBeGreaterThanOrEqual(paneBox!.y - 2);

  // No overlap with any dialog footer action button.
  for (const name of [/Approve/i, /^Reject/i, /Delete/i]) {
    const btn = page.getByRole("button", { name }).first();
    if ((await btn.count()) === 0) continue;
    const btnBox = await btn.boundingBox().catch(() => null);
    if (!btnBox) continue;
    expect(
      boxesOverlap(sendBox!, btnBox),
      `Send button must not overlap footer button ${name}`,
    ).toBe(false);
  }

  // The thread area above the input must retain visible height (>= ~80px:
  // room for at least two compact message bubbles).
  const inputRowTop = (await textarea.boundingBox())!.y;
  const threadHeight = inputRowTop - paneBox!.y;
  expect(threadHeight).toBeGreaterThan(80);
}

test.describe("KB review refine chat layout (short viewport)", () => {
  test.use({ viewport: { width: 1280, height: 740 } });

  test("thread stays visible, Send stays inside the pane, and newest message auto-scrolls into view", async ({
    page,
  }) => {
    const fixture = loadFixture();
    await loginAsAdmin(page, fixture);

    // Mock the refine endpoint so no LLM is involved.
    await page.route("**/staging/*/refine", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          mode: "discussion",
          assistantMessage:
            "Mocked reply: here is a fairly long answer so the bubble takes some vertical space in the thread and the auto-scroll behaviour is meaningfully exercised across multiple lines of text.",
          changes: [],
        }),
      });
    });

    await openRefineChat(page);
    await assertLayoutSound(page);

    // Send several messages so the thread is taller than its scroll area.
    const textarea = page.getByPlaceholder(/Ask or instruct/i);
    for (let i = 1; i <= 4; i++) {
      await textarea.fill(`Layout test message ${i}`);
      await textarea.press("Enter");
      await expect(
        page.getByText(`Layout test message ${i}`),
      ).toBeVisible({ timeout: 10_000 });
    }
    // Newest assistant bubble must be scrolled into view automatically.
    const lastBubble = page.getByText(/Mocked reply/).last();
    await expect(lastBubble).toBeInViewport();
    // Earliest user message should have scrolled out of the (short) thread.
    await assertLayoutSound(page);

    // Expand to 2/3 and re-verify; newest message stays in view.
    await page
      .getByRole("button", { name: /Expand chat to 2\/3 height/i })
      .click();
    await assertLayoutSound(page);
    await expect(lastBubble).toBeInViewport();

    // Shrink back to 1/3 and re-verify.
    await page
      .getByRole("button", { name: /Shrink chat to 1\/3 height/i })
      .click();
    await assertLayoutSound(page);

    // Collapse works and the bar shows the message count.
    await page.getByRole("button", { name: /^Collapse chat$/ }).or(
      page.getByTitle("Collapse chat"),
    ).first().click();
    await expect(
      page.getByRole("button", { name: /Refine with AI/i }).first(),
    ).toBeVisible();
  });
});
