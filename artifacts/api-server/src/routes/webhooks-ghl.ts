import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { db, usersTable, userProductsTable, productsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { queueGHLSync } from "../lib/ghl-queue";

const router = Router();

const GHL_WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET || "";

function verifyGHLSignature(rawBody: string, signature: string): boolean {
  if (!GHL_WEBHOOK_SECRET) return true;
  if (!signature) return false;

  try {
    const expected = crypto
      .createHmac("sha256", GHL_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

interface GHLWebhookPayload {
  type?: string;
  contactId?: string;
  contact?: {
    id?: string;
    email?: string;
    tags?: string[];
  };
  tags?: string[];
  pipelineId?: string;
  pipelineStageId?: string;
  [key: string]: unknown;
}

async function handleTagTrigger(
  tag: string,
  contactEmail: string,
  contactId: string
): Promise<{ action: string; result: string }> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, contactEmail))
    .limit(1);

  if (!user) {
    return { action: "skipped", result: `No portal user found for email ${contactEmail}` };
  }

  if (tag === "vip_override") {
    await db
      .update(usersTable)
      .set({ role: "vip" })
      .where(eq(usersTable.id, user.id));

    await queueGHLSync({
      action: "add_note",
      userId: user.id,
      contactId,
      noteBody: "VIP override applied from GHL tag trigger",
    });

    return { action: "vip_override", result: `User ${user.email} upgraded to VIP` };
  }

  if (tag === "force_expire") {
    await db
      .update(userProductsTable)
      .set({ status: "expired" })
      .where(
        and(
          eq(userProductsTable.userId, user.id),
          eq(userProductsTable.status, "active")
        )
      );

    await queueGHLSync({
      action: "add_note",
      userId: user.id,
      contactId,
      noteBody: "All active products force-expired from GHL tag trigger",
    });

    return { action: "force_expire", result: `All active products expired for ${user.email}` };
  }

  const upgradeMatch = tag.match(/^manual_upgrade_(.+)$/);
  if (upgradeMatch) {
    const productSlug = upgradeMatch[1];
    const [product] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.slug, productSlug))
      .limit(1);

    if (!product) {
      return { action: "skipped", result: `No product found with slug: ${productSlug}` };
    }

    const existing = await db
      .select({ id: userProductsTable.id })
      .from(userProductsTable)
      .where(
        and(
          eq(userProductsTable.userId, user.id),
          eq(userProductsTable.productId, product.id),
          eq(userProductsTable.status, "active")
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return { action: "skipped", result: `User already has active ${productSlug}` };
    }

    let expiresAt: Date | null = null;
    if (product.durationDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + product.durationDays);
    }

    await db.insert(userProductsTable).values({
      userId: user.id,
      productId: product.id,
      status: "active",
      expiresAt,
    });

    await queueGHLSync({
      action: "add_tags",
      userId: user.id,
      contactId,
      tags: [`product_${productSlug}`, "manual_upgrade"],
    });

    return {
      action: "manual_upgrade",
      result: `Granted ${product.name} to ${user.email} via GHL tag`,
    };
  }

  return { action: "ignored", result: `Unrecognized trigger tag: ${tag}` };
}

router.post("/webhooks/ghl", async (req: Request, res: Response) => {
  const signature = (req.headers["x-ghl-signature"] as string) || "";
  const rawBody = req.rawBody || "";

  if (!GHL_WEBHOOK_SECRET && process.env.NODE_ENV === "production") {
    console.error("[GHL Webhook] GHL_WEBHOOK_SECRET not configured — rejecting in production");
    res.status(503).json({ error: "GHL webhook not configured" });
    return;
  }

  if (GHL_WEBHOOK_SECRET && !verifyGHLSignature(rawBody, signature)) {
    console.error("[GHL Webhook] Invalid signature — rejecting");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  res.status(200).json({ received: true });

  try {
    const payload = req.body as GHLWebhookPayload;
    const contactId = payload.contactId || payload.contact?.id || "";
    const contactEmail = payload.contact?.email || "";
    const tags = payload.tags || payload.contact?.tags || [];

    console.log(`[GHL Webhook] Received event type=${payload.type} contactId=${contactId}`);

    const triggerTags = ["vip_override", "force_expire"];
    const results: Array<{ tag: string; action: string; result: string }> = [];

    for (const tag of tags) {
      const isKnownTrigger =
        triggerTags.includes(tag) || tag.startsWith("manual_upgrade_");
      if (isKnownTrigger && contactEmail) {
        const result = await handleTagTrigger(tag, contactEmail, contactId);
        results.push({ tag, ...result });
      }
    }

    if (payload.pipelineStageId && contactEmail) {
      console.log(
        `[GHL Webhook] Pipeline stage change: ${payload.pipelineId} -> ${payload.pipelineStageId} for ${contactEmail}`
      );
    }

    if (results.length > 0) {
      console.log("[GHL Webhook] Trigger results:", JSON.stringify(results));
    }
  } catch (error) {
    console.error("[GHL Webhook] Processing error:", error);
  }
});

export default router;
