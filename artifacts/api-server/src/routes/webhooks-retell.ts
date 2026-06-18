import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { db, voiceCallsTable, voiceDailyUsageTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

const RETELL_API_KEY = process.env.RETELL_API_KEY ?? "";

function verifyRetellSignature(rawBody: string, signature: string): boolean {
  if (!RETELL_API_KEY) return true;
  if (!signature) return false;

  try {
    const expected = crypto
      .createHmac("sha256", RETELL_API_KEY)
      .update(rawBody)
      .digest("hex");

    const expectedBuf = Buffer.from(expected, "hex");
    let sigBuf: Buffer;
    try {
      sigBuf = Buffer.from(signature, "hex");
    } catch {
      return false;
    }
    if (expectedBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, sigBuf);
  } catch {
    return false;
  }
}

router.post("/webhooks/retell", async (req: Request, res: Response): Promise<void> => {
  const signature = (req.headers["x-retell-signature"] as string) ?? "";
  const rawBody = req.rawBody ?? "";

  if (!RETELL_API_KEY && process.env.NODE_ENV === "production") {
    console.error("[Retell Webhook] RETELL_API_KEY not configured — rejecting in production");
    res.status(503).json({ error: "Retell webhook not configured" });
    return;
  }

  if (RETELL_API_KEY && !verifyRetellSignature(rawBody, signature)) {
    console.error("[Retell Webhook] Invalid signature — rejecting");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = req.body as {
    event: string;
    call?: {
      call_id?: string;
      call_status?: string;
      start_timestamp?: number;
      end_timestamp?: number;
      duration_ms?: number;
      disconnection_reason?: string;
      transcript?: string;
      call_analysis?: { call_summary?: string; [key: string]: unknown };
    };
    [key: string]: unknown;
  };

  const event = payload.event;

  if (!event) {
    res.status(200).json({ received: true });
    return;
  }

  const call = payload.call;
  const callId = call?.call_id;

  if (!callId) {
    console.warn(`[Retell Webhook] No call_id in event=${event}`);
    res.status(200).json({ received: true });
    return;
  }

  console.log(`[Retell Webhook] event=${event} call_id=${callId}`);

  try {
    if (event === "call_started") {
      await db
        .update(voiceCallsTable)
        .set({ status: "ongoing" })
        .where(eq(voiceCallsTable.retellCallId, callId));
    } else if (event === "call_ended") {
      const endedAt = call?.end_timestamp ? new Date(call.end_timestamp) : new Date();
      const durationSeconds = call?.duration_ms != null
        ? Math.round(call.duration_ms / 1000)
        : null;

      await db
        .update(voiceCallsTable)
        .set({
          status: call?.call_status ?? "ended",
          endedAt,
          durationSeconds,
          disconnectReason: call?.disconnection_reason ?? null,
        })
        .where(eq(voiceCallsTable.retellCallId, callId));

      if (durationSeconds && durationSeconds > 0) {
        const [vcRow] = await db
          .select({ userId: voiceCallsTable.userId })
          .from(voiceCallsTable)
          .where(eq(voiceCallsTable.retellCallId, callId))
          .limit(1);

        if (vcRow) {
          const today = new Date().toISOString().split("T")[0];
          await db.execute(
            sql`INSERT INTO voice_daily_usage (user_id, usage_date, seconds_used)
                VALUES (${vcRow.userId}, ${today}, ${durationSeconds})
                ON CONFLICT (user_id, usage_date)
                DO UPDATE SET seconds_used = voice_daily_usage.seconds_used + ${durationSeconds}`
          );
        }
      }
    } else if (event === "call_analyzed") {
      const analysis = call?.call_analysis;
      await db
        .update(voiceCallsTable)
        .set({
          summary: analysis?.call_summary ?? null,
          transcript: call?.transcript ?? null,
        })
        .where(eq(voiceCallsTable.retellCallId, callId));
    } else {
      console.log(`[Retell Webhook] Unhandled event type: ${event}`);
    }
  } catch (err) {
    console.error(`[Retell Webhook] Error processing event=${event}:`, err);
  }

  res.status(200).json({ received: true });
});

export default router;
