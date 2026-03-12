import { Router, type Request, type Response } from "express";
import { db, communicationLogTable, emailBouncesTable, emailUnsubscribesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.post("/webhooks/sendgrid", async (req: Request, res: Response) => {
  res.status(200).json({ received: true });

  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
      const eventType = event.event;
      const email = event.email?.toLowerCase();
      const logId = event.log_id ? parseInt(event.log_id, 10) : null;
      const messageId = event.sg_message_id?.split(".")[0] || "";

      if (!eventType) continue;

      let logEntry = null;
      if (logId) {
        const [entry] = await db
          .select()
          .from(communicationLogTable)
          .where(eq(communicationLogTable.id, logId))
          .limit(1);
        logEntry = entry;
      }
      if (!logEntry && messageId) {
        const [entry] = await db
          .select()
          .from(communicationLogTable)
          .where(eq(communicationLogTable.sendgridMessageId, messageId))
          .limit(1);
        logEntry = entry;
      }

      const updates: Record<string, unknown> = {};

      switch (eventType) {
        case "delivered":
          updates.status = "delivered";
          updates.deliveredAt = new Date();
          break;
        case "open":
          updates.openedAt = new Date();
          break;
        case "click":
          updates.clickedAt = new Date();
          break;
        case "bounce": {
          const bounceType = event.type === "bounce" ? "hard" : "soft";
          updates.status = "bounced";
          updates.bouncedAt = new Date();
          updates.bounceType = bounceType;
          updates.errorMessage = event.reason || event.response || "";

          if (email) {
            await db.insert(emailBouncesTable).values({
              email,
              bounceType,
              reason: event.reason || event.response || "",
              suppressed: bounceType === "hard",
            });
          }
          break;
        }
        case "dropped":
          updates.status = "dropped";
          updates.errorMessage = event.reason || "";
          break;
        case "unsubscribe":
        case "group_unsubscribe":
          if (email) {
            const [existing] = await db
              .select({ id: emailUnsubscribesTable.id })
              .from(emailUnsubscribesTable)
              .where(and(eq(emailUnsubscribesTable.email, email), eq(emailUnsubscribesTable.active, true)))
              .limit(1);

            if (!existing) {
              const [user] = await db
                .select({ id: usersTable.id })
                .from(usersTable)
                .where(eq(usersTable.email, email))
                .limit(1);

              await db.insert(emailUnsubscribesTable).values({
                email,
                userId: user?.id,
                reason: "sendgrid_event",
              });
            }
          }
          break;
        case "spamreport":
          if (email) {
            const [existing] = await db
              .select({ id: emailUnsubscribesTable.id })
              .from(emailUnsubscribesTable)
              .where(and(eq(emailUnsubscribesTable.email, email), eq(emailUnsubscribesTable.active, true)))
              .limit(1);

            if (!existing) {
              const [user] = await db
                .select({ id: usersTable.id })
                .from(usersTable)
                .where(eq(usersTable.email, email))
                .limit(1);

              await db.insert(emailUnsubscribesTable).values({
                email,
                userId: user?.id,
                reason: "spam_report",
              });
            }
          }
          break;
      }

      if (logEntry && Object.keys(updates).length > 0) {
        await db.update(communicationLogTable)
          .set(updates)
          .where(eq(communicationLogTable.id, logEntry.id));
      }
    }
  } catch (error) {
    console.error("[Webhook:SendGrid] Error processing events:", error);
  }
});

router.post("/webhooks/twilio", async (req: Request, res: Response) => {
  res.status(200).send("<Response></Response>");

  try {
    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;

    if (!MessageSid || !MessageStatus) return;

    const updates: Record<string, unknown> = {};

    switch (MessageStatus) {
      case "delivered":
        updates.status = "delivered";
        updates.deliveredAt = new Date();
        break;
      case "sent":
        updates.status = "sent";
        break;
      case "failed":
      case "undelivered":
        updates.status = "failed";
        updates.errorMessage = ErrorMessage || `Error code: ${ErrorCode || "unknown"}`;
        break;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(communicationLogTable)
        .set(updates)
        .where(eq(communicationLogTable.twilioMessageSid, MessageSid));
    }
  } catch (error) {
    console.error("[Webhook:Twilio] Error processing status:", error);
  }
});

export default router;
