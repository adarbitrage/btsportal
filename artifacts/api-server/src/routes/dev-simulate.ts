import { Router, type Request, type Response } from "express";
import { processWebhookEvent } from "../lib/webhook-handler";

const router = Router();

if (process.env.NODE_ENV !== "production") {
  router.post("/dev/simulate-purchase", async (req: Request, res: Response) => {
    const { email, name, thrivecartProductId } = req.body;

    if (!email || !thrivecartProductId) {
      res.status(400).json({ error: "email and thrivecartProductId are required" });
      return;
    }

    const fakePayload = {
      event: "order.success",
      order: {
        id: `SIM-${Date.now()}`,
        invoice_id: `INV-SIM-${Date.now()}`,
        customer: {
          email,
          name: name || "Simulated User",
        },
        item: {
          id: thrivecartProductId,
          name: "Simulated Product",
        },
        subscription: {
          id: `SUB-SIM-${Date.now()}`,
        },
      },
    };

    const result = await processWebhookEvent(fakePayload, true);
    res.json({ simulation: true, ...result });
  });

  router.post("/dev/simulate-refund", async (req: Request, res: Response) => {
    const { email, thrivecartProductId } = req.body;

    if (!email || !thrivecartProductId) {
      res.status(400).json({ error: "email and thrivecartProductId are required" });
      return;
    }

    const fakePayload = {
      event: "order.refund",
      order: {
        id: `SIM-REFUND-${Date.now()}`,
        customer: { email },
        item: { id: thrivecartProductId },
      },
    };

    const result = await processWebhookEvent(fakePayload, true);
    res.json({ simulation: true, ...result });
  });

  router.post("/dev/simulate-cancellation", async (req: Request, res: Response) => {
    const { email, thrivecartProductId } = req.body;

    if (!email || !thrivecartProductId) {
      res.status(400).json({ error: "email and thrivecartProductId are required" });
      return;
    }

    const fakePayload = {
      event: "order.subscription_cancelled",
      order: {
        id: `SIM-CANCEL-${Date.now()}`,
        customer: { email },
        item: { id: thrivecartProductId },
      },
    };

    const result = await processWebhookEvent(fakePayload, true);
    res.json({ simulation: true, ...result });
  });
}

export default router;
