import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { db, usersTable, userProductsTable, productsTable, callBookingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { queueGHLSync } from "../lib/ghl-queue";
import { markPartnerCallDone } from "../lib/partner-call-completion";
import { insertUserProductGrant } from "../lib/external-grant-product";

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
  // Appointment status event fields (T7). GHL's calendar webhooks
  // (AppointmentCreate / AppointmentUpdate / AppointmentDelete) carry the
  // appointment id and its current status. We accept a couple of
  // reasonable field-name variants (`appointmentId`/`id`,
  // `appointmentStatus`/`status`) since GHL's own payload shape varies
  // slightly by trigger/version — see the completion report for the exact
  // subscription this route expects.
  appointmentId?: string;
  id?: string;
  appointment?: { id?: string };
  calendarId?: string;
  appointmentStatus?: string;
  status?: string;
  [key: string]: unknown;
}

// GHL appointment status -> local call_bookings status. Anything not listed
// here (confirmed, new, invalid, etc.) is an in-flight/no-op state for our
// purposes and is logged + ignored rather than applied.
const GHL_APPOINTMENT_STATUS_MAP: Record<string, "completed" | "no_show" | "canceled"> = {
  showed: "completed",
  completed: "completed",
  noshow: "no_show",
  no_show: "no_show",
  cancelled: "canceled",
  canceled: "canceled",
};

// GHL calendar webhook event types this branch handles. Other `type` values
// (contact tag changes, pipeline stage moves, etc.) fall through to the
// existing tag-trigger branch untouched.
const GHL_APPOINTMENT_EVENT_TYPES = new Set([
  "AppointmentCreate",
  "AppointmentUpdate",
  "AppointmentDelete",
]);

interface AppointmentEventResult {
  action: string;
  result: string;
}

/**
 * Sync a GHL appointment status change into `call_bookings` — the single
 * local source of truth for call state (see call-bookings.ts schema notes).
 *
 * Forward-only + idempotent: a booking only ever moves off "booked"; once it
 * has a terminal status (completed/no_show/canceled) any further/replayed
 * event for the same appointment is a no-op. This makes GHL webhook retries
 * and out-of-order delivery safe.
 *
 * `completed` is routed through the SAME `markPartnerCallDone` seam the
 * partner dashboard's manual mark-done action uses (Task #1592/#1629
 * invariant: webhook-driven completion must never duplicate that logic —
 * it alone owns first-partner-call onboarding completion + last-completed
 * tracking). Kickoff-type bookings have no such seam yet (out of scope for
 * T7), so they get a direct, equally forward-only status flip.
 */
async function handleAppointmentEvent(
  payload: GHLWebhookPayload,
): Promise<AppointmentEventResult> {
  const appointmentId = payload.appointmentId || payload.id || payload.appointment?.id;
  if (!appointmentId) {
    return { action: "skipped", result: "Appointment event missing an appointment id" };
  }

  const rawStatus = (payload.appointmentStatus || payload.status || "").toLowerCase();
  const newStatus = GHL_APPOINTMENT_STATUS_MAP[rawStatus];
  if (!newStatus) {
    return {
      action: "ignored",
      result: `Appointment ${appointmentId}: unhandled status "${rawStatus || "(none)"}"`,
    };
  }

  const [booking] = await db
    .select({
      id: callBookingsTable.id,
      status: callBookingsTable.status,
      type: callBookingsTable.type,
    })
    .from(callBookingsTable)
    .where(eq(callBookingsTable.ghlAppointmentId, appointmentId))
    .limit(1);

  if (!booking) {
    return {
      action: "skipped",
      result: `No call_bookings row for GHL appointment ${appointmentId} (may belong to another calendar in this location)`,
    };
  }

  if (booking.status !== "booked") {
    return {
      action: "no_op",
      result: `Booking ${booking.id} already "${booking.status}" — ignoring replayed/out-of-order "${rawStatus}" event`,
    };
  }

  if (newStatus === "completed" && booking.type === "partner") {
    const { updated, onboardingAdvanced } = await markPartnerCallDone(booking.id);
    return {
      action: updated ? "completed" : "no_op",
      result: `Booking ${booking.id} ${updated ? "marked completed" : "was not in a completable state"}${
        onboardingAdvanced ? " (onboarding advanced)" : ""
      }`,
    };
  }

  // Kickoff-type completion, or no_show/canceled for any call type: a plain
  // conditional flip guarded on the row still being "booked" so a race with
  // another writer (or a second replay slipping past the check above) can
  // never regress/double-apply.
  const updateFields: Record<string, unknown> = { status: newStatus };
  if (newStatus === "canceled") {
    updateFields.cancelledAt = new Date();
  }
  const updatedRows = await db
    .update(callBookingsTable)
    .set(updateFields)
    .where(and(eq(callBookingsTable.id, booking.id), eq(callBookingsTable.status, "booked")))
    .returning({ id: callBookingsTable.id });

  if (updatedRows.length === 0) {
    return {
      action: "no_op",
      result: `Booking ${booking.id} already advanced past "booked" — ignoring replay`,
    };
  }

  return { action: newStatus, result: `Booking ${booking.id} marked ${newStatus}` };
}

// Exported (only) for the grant-seam regression test (Task #1658) — lets the
// test assert on the manual_upgrade hook-firing behavior directly instead of
// racing the webhook route's fire-and-forget (post-200-response) processing.
export async function handleTagTrigger(
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

    // Routed through the shared grant seam (Task #1658) — fires the same
    // post-grant hooks (partner assignment + onboarding upgrade re-entry)
    // as every other purchase path. durationDays is passed straight through
    // rather than pre-computing expiresAt; the pre-check above already
    // guards against double-granting an existing active grant.
    await insertUserProductGrant({
      userId: user.id,
      productId: product.id,
      durationDays: product.durationDays ?? null,
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

    if (payload.type && GHL_APPOINTMENT_EVENT_TYPES.has(payload.type)) {
      const result = await handleAppointmentEvent(payload);
      console.log("[GHL Webhook] Appointment event result:", JSON.stringify(result));
      return;
    }

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
