import { Router, type Request, type Response } from "express";
import { db, emailUnsubscribesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { verifyUnsubscribeToken } from "../lib/communication-service";

const router = Router();

router.get("/email/unsubscribe", async (req: Request, res: Response) => {
  const email = (req.query.email as string || "").toLowerCase();
  const token = req.query.token as string || "";

  if (!email || !token) {
    res.status(400).send(unsubscribePage("Invalid unsubscribe link.", false));
    return;
  }

  if (!verifyUnsubscribeToken(email, token)) {
    res.status(400).send(unsubscribePage("Invalid or expired unsubscribe link.", false));
    return;
  }

  const [existing] = await db
    .select({ id: emailUnsubscribesTable.id })
    .from(emailUnsubscribesTable)
    .where(and(eq(emailUnsubscribesTable.email, email), eq(emailUnsubscribesTable.active, true)))
    .limit(1);

  if (existing) {
    res.send(unsubscribePage("You are already unsubscribed from marketing emails.", true));
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  await db.insert(emailUnsubscribesTable).values({
    email,
    userId: user?.id,
    reason: "one_click_unsubscribe",
  });

  if (user) {
    await db.update(usersTable)
      .set({ marketingOptIn: false })
      .where(eq(usersTable.id, user.id));
  }

  res.send(unsubscribePage("You have been successfully unsubscribed from marketing emails. You will still receive important account-related emails.", true));
});

router.post("/email/resubscribe", async (req: Request, res: Response) => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { email } = req.body;

  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  const normalizedEmail = email.toLowerCase();

  const [owner] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, req.userId), eq(usersTable.email, normalizedEmail)))
    .limit(1);

  if (!owner) {
    res.status(403).json({ error: "You can only resubscribe your own email" });
    return;
  }

  await db.update(emailUnsubscribesTable)
    .set({ active: false, resubscribedAt: new Date() })
    .where(and(eq(emailUnsubscribesTable.email, normalizedEmail), eq(emailUnsubscribesTable.active, true)));

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);

  if (user) {
    await db.update(usersTable)
      .set({ marketingOptIn: true })
      .where(eq(usersTable.id, user.id));
  }

  res.json({ message: "Successfully resubscribed to marketing emails." });
});

function unsubscribePage(message: string, success: boolean): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Email Preferences - Build Test Scale</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 500px; text-align: center; }
    h1 { color: ${success ? "#16a34a" : "#dc2626"}; font-size: 24px; }
    p { color: #555; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${success ? "Unsubscribed" : "Error"}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export default router;
