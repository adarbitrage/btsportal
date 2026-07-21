import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tag = Date.now().toString(36);
const email = `visual-check-${tag}@e2e.local`;
const password = `Check-${tag}-Aa1!`;

const SAMPLE = `## Your first week of campaign testing

Great question! The first week is all about gathering clean data, not making money yet. Most members who rush to scale in week one end up burning budget on unvalidated angles.

Here's the mindset shift: you're paying for **information**, not conversions.

---

### Day 1–2: Setup and baselines

Start with the fundamentals before spending anything:

- Set up your tracker under \`Campaigns → New\` and verify the postback fires
- Pick **one offer** and **three angles** — no more, or your data gets too thin

### Day 3–5: Controlled testing

| Phase | Daily budget | Goal |
|-------|-------------|------|
| Testing | $10–20 per angle | Find a working angle |
| Validation | $30–40 | Confirm \`ROAS > 1.2\` |

---

A quick sanity checklist:

1. Tracker postbacks verified on every campaign
2. Kill criteria applied without exceptions

Check the [Campaign Tracker guide](#) if you get stuck.`;

const hash = await bcrypt.hash(password, 10);
const u = await pool.query(
  `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
   VALUES ($1, $2, $3, 'member', true, true) RETURNING id`,
  [`Visual Check ${tag}`, email, hash],
);
const userId = u.rows[0].id;
const s = await pool.query(
  `INSERT INTO chat_sessions (user_id, title) VALUES ($1, 'Campaign testing plan') RETURNING id`,
  [userId],
);
const sessionId = s.rows[0].id;
await pool.query(
  `INSERT INTO chat_messages (session_id, role, content) VALUES
   ($1, 'user', 'How should I structure my first week of campaign testing?'),
   ($1, 'assistant', $2)`,
  [sessionId, SAMPLE],
);
console.log("Seeded user", userId, "session", sessionId);

const res = await fetch("http://127.0.0.1:8080/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!res.ok) throw new Error("login failed " + res.status + " " + (await res.text()));
const setCookies = res.headers.getSetCookie();
console.log("Login ok, cookies:", setCookies.length);

const exePath = execSync("which chromium").toString().trim();
const browser = await chromium.launch({ executablePath: exePath, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
await ctx.addCookies(
  setCookies.map((raw) => {
    const [pair] = raw.split(";");
    const [name, ...v] = pair.split("=");
    return { name: name.trim(), value: v.join("=").trim(), domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" };
  }),
);
const page = await ctx.newPage();
await page.goto("http://localhost:80/ai-assistant", { waitUntil: "networkidle", timeout: 60000 });
await page.click(`[data-testid="item-conversation-${sessionId}"]`, { timeout: 20000 });
await page.waitForSelector('[data-testid="chat-markdown-divider"]', { timeout: 20000 });
await page.waitForTimeout(1500);
execSync("mkdir -p screenshots");
await page.screenshot({ path: "screenshots/ai-assistant-live.jpeg", fullPage: false, type: "jpeg", quality: 80 });
// scroll chat container to see more of message
await page.evaluate(() => {
  document.querySelectorAll(".overflow-y-auto").forEach((el) => (el.scrollTop = el.scrollHeight));
});
await page.waitForTimeout(500);
await page.screenshot({ path: "screenshots/ai-assistant-live-bottom.jpeg", type: "jpeg", quality: 80 });
await browser.close();

// cleanup
await pool.query(`DELETE FROM chat_messages WHERE session_id = $1`, [sessionId]);
await pool.query(`DELETE FROM chat_sessions WHERE id = $1`, [sessionId]);
await pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [userId]).catch(() => {});
await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]).catch(() => {});
await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
await pool.end();
console.log("DONE");
