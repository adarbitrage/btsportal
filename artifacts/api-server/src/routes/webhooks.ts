import { Router, type Request, type Response } from "express";
import { verifySignature, processWebhookEvent } from "../lib/webhook-handler";

const router = Router();

const WEBHOOK_SECRET_PATH = process.env.THRIVECART_WEBHOOK_SECRET_PATH || "";

router.post("/webhooks/thrivecart", async (req: Request, res: Response) => {
  res.status(200).json({ received: true });

  const signature = req.headers["x-thrivecart-signature"] as string || "";
  const hasSecret = !!process.env.THRIVECART_WEBHOOK_SECRET;

  if (hasSecret) {
    const rawBody = req.rawBody || "";
    if (!verifySignature(rawBody, signature)) {
      console.error("[Webhook] Invalid signature — rejecting event processing");
      return;
    }
  }

  try {
    const result = await processWebhookEvent(req.body);
    console.log("[Webhook] Processing result:", result);
  } catch (error) {
    console.error("[Webhook] Async processing error:", error);
  }
});

if (WEBHOOK_SECRET_PATH) {
  router.post(`/webhooks/thrivecart/${WEBHOOK_SECRET_PATH}`, async (req: Request, res: Response) => {
    res.status(200).json({ received: true });

    try {
      const result = await processWebhookEvent(req.body);
      console.log("[Webhook] Processing result (secret path):", result);
    } catch (error) {
      console.error("[Webhook] Async processing error (secret path):", error);
    }
  });
}

export default router;
