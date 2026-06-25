import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { db, voiceCallsTable, voiceDailyUsageTable, usersTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

const router = Router();

const RETELL_API_KEY = process.env.RETELL_API_KEY ?? "";

// ---------------------------------------------------------------------------
// Webhook configuration diagnosis (logged once at module load time so ops
// teams can see exactly why webhooks are or aren't being accepted).
//
// Root-cause checklist for missing call_ended/call_analyzed webhooks:
//   1. RETELL_API_KEY env var must be set in production. When absent, this
//      handler returns 503 for every webhook request (production guard).
//   2. The webhook URL configured in the Retell dashboard must point to this
//      server's public endpoint: https://<your-domain>/api/webhooks/retell
//      In development, Retell cannot reach localhost — use the backfill path
//      or a tunnelling tool (e.g. ngrok) for local end-to-end testing.
//   3. Retell signs webhooks using the API key as the HMAC-SHA256 secret
//      (x-retell-signature header). If the key here differs from the one in
//      the Retell dashboard, every webhook fails with 401.
//   4. express.raw() must pre-process the /webhooks path BEFORE express.json()
//      so req.rawBody is populated for signature verification. If rawBody is
//      empty (""), every signature check will fail regardless of the key.
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV === "production") {
  if (!RETELL_API_KEY) {
    console.error(
      "[Retell Webhook] RETELL_API_KEY is NOT configured. " +
      "All incoming webhook requests will be rejected with 503. " +
      "Set RETELL_API_KEY in your production environment and redeploy."
    );
  } else {
    console.log(
      "[Retell Webhook] RETELL_API_KEY is configured. " +
      "Webhook signature verification is ACTIVE. " +
      "Ensure the Retell dashboard webhook URL points to: /api/webhooks/retell"
    );
  }
}

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
      call_type?: string;
      call_status?: string;
      from_number?: string;
      to_number?: string;
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

  const isPhoneCall = call?.call_type === "phone_call";
  const fromNumber = call?.from_number ?? null;

  console.log(`[Retell Webhook] event=${event} call_id=${callId} call_type=${call?.call_type ?? "unknown"}`);

  try {
    if (event === "call_started") {
      // For web calls the row was pre-inserted by /voice/web-call. For phone
      // calls no pre-registration happens, so we upsert the row here.
      if (isPhoneCall) {
        // Try to match the caller to an existing member by phone number.
        let matchedUserId: number | null = null;
        if (fromNumber) {
          const [matched] = await db
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(eq(usersTable.phone, fromNumber))
            .limit(1);
          matchedUserId = matched?.id ?? null;
        }

        await db
          .insert(voiceCallsTable)
          .values({
            userId: matchedUserId,
            retellCallId: callId,
            callType: "phone_call",
            callerPhone: fromNumber,
            status: "ongoing",
            startedAt: call?.start_timestamp ? new Date(call.start_timestamp) : new Date(),
          })
          .onConflictDoUpdate({
            target: voiceCallsTable.retellCallId,
            set: { status: "ongoing" },
          });
      } else {
        await db
          .update(voiceCallsTable)
          .set({ status: "ongoing" })
          .where(eq(voiceCallsTable.retellCallId, callId));
      }
    } else if (event === "call_ended") {
      const endedAt = call?.end_timestamp ? new Date(call.end_timestamp) : new Date();
      const durationSeconds = call?.duration_ms != null
        ? Math.round(call.duration_ms / 1000)
        : null;

      // Retell delivers webhooks at-least-once, so a re-delivered call_ended
      // must not roll the same seconds into voice_daily_usage twice. We use the
      // call row's duration_seconds column as an atomic idempotency marker:
      // claim the accrual with a single conditional UPDATE that only matches
      // while duration_seconds IS NULL and returns the row it changed. Postgres
      // row-locks the matched row, so even two concurrent duplicate deliveries
      // can have at most one win the claim — the loser's WHERE re-evaluates to
      // false and returns no row. Only the winning delivery accrues usage.
      const claimed = await db
        .update(voiceCallsTable)
        .set({
          status: call?.call_status ?? "ended",
          endedAt,
          durationSeconds,
          disconnectReason: call?.disconnection_reason ?? null,
        })
        .where(
          and(
            eq(voiceCallsTable.retellCallId, callId),
            isNull(voiceCallsTable.durationSeconds),
          ),
        )
        .returning({ userId: voiceCallsTable.userId });

      const winner = claimed[0];

      // Only accrue daily usage when the call is linked to a member (phone calls
      // from unknown callers have no userId and therefore no usage bucket).
      if (winner && winner.userId != null && durationSeconds && durationSeconds > 0) {
        const today = new Date().toISOString().split("T")[0];
        await db.execute(
          sql`INSERT INTO voice_daily_usage (user_id, usage_date, seconds_used)
              VALUES (${winner.userId}, ${today}, ${durationSeconds})
              ON CONFLICT (user_id, usage_date)
              DO UPDATE SET seconds_used = voice_daily_usage.seconds_used + ${durationSeconds}`
        );
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
