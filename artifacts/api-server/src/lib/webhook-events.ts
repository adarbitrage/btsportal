import crypto from "crypto";
import { db, webhookSubscriptionsTable, webhookDeliveriesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { queueDelivery } from "./outgoing-webhook-queue";

export const WEBHOOK_EVENT_TYPES = [
  "member.created",
  "member.verified",
  "training.lesson_completed",
  "training.module_completed",
  "commission.earned",
  "commission.paid",
  "ticket.created",
  "ticket.resolved",
  "ticket.closed",
  "community.post_created",
  "community.comment_created",
  "test.ping",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export async function emitWebhookEvent(
  eventType: WebhookEventType,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const subscriptions = await db.select()
      .from(webhookSubscriptionsTable)
      .where(eq(webhookSubscriptionsTable.active, true));

    const matchingSubs = subscriptions.filter((sub) => {
      const types = sub.eventTypes as string[];
      return types.includes(eventType) || types.includes("*");
    });

    if (matchingSubs.length === 0) return;

    const eventId = `evt_${crypto.randomUUID().replace(/-/g, "")}`;
    const eventPayload = {
      id: eventId,
      type: eventType,
      created_at: new Date().toISOString(),
      data: payload,
    };

    for (const sub of matchingSubs) {
      try {
        const [delivery] = await db.insert(webhookDeliveriesTable).values({
          subscriptionId: sub.id,
          eventType,
          eventId,
          payload: eventPayload,
          status: "pending",
          attemptCount: 0,
          maxAttempts: 5,
        }).returning();

        await queueDelivery({
          deliveryId: delivery.id,
          subscriptionId: sub.id,
          targetUrl: sub.targetUrl,
          secret: sub.secret,
          eventType,
          eventId,
          payload: eventPayload,
        });
      } catch (err) {
        console.error(`[Webhook Events] Failed to queue delivery for subscription ${sub.id}:`, err);
      }
    }

    console.log(`[Webhook Events] Emitted ${eventType} to ${matchingSubs.length} subscription(s)`);
  } catch (error) {
    console.error(`[Webhook Events] Failed to emit ${eventType}:`, error);
  }
}

export async function sendTestEvent(subscriptionId: number): Promise<{ deliveryId: number; eventId: string } | null> {
  try {
    const [sub] = await db.select()
      .from(webhookSubscriptionsTable)
      .where(eq(webhookSubscriptionsTable.id, subscriptionId))
      .limit(1);

    if (!sub) return null;

    const eventId = `evt_test_${crypto.randomUUID().replace(/-/g, "")}`;
    const eventPayload = {
      id: eventId,
      type: "test.ping" as const,
      created_at: new Date().toISOString(),
      data: {
        message: "This is a test webhook event from BTS",
        subscription_id: sub.id,
        subscription_name: sub.name,
      },
    };

    const [delivery] = await db.insert(webhookDeliveriesTable).values({
      subscriptionId: sub.id,
      eventType: "test.ping",
      eventId,
      payload: eventPayload,
      status: "pending",
      attemptCount: 0,
      maxAttempts: 1,
    }).returning();

    await queueDelivery({
      deliveryId: delivery.id,
      subscriptionId: sub.id,
      targetUrl: sub.targetUrl,
      secret: sub.secret,
      eventType: "test.ping",
      eventId,
      payload: eventPayload,
    });

    return { deliveryId: delivery.id, eventId };
  } catch (error) {
    console.error("[Webhook Events] Failed to send test event:", error);
    return null;
  }
}
