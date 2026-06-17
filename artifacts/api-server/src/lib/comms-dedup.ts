import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// Outcome of trying to claim a send slot in the dedup store. The three states
// MUST stay distinct: a caller has to be able to tell "already sent, skip
// quietly" apart from "the dedup store is broken" — conflating them is exactly
// how a database problem silently suppresses every scheduled email.
//   - "recorded":  this is the first send for the key — proceed and send.
//   - "duplicate": the key was already recorded — skip (already sent).
//   - "error":     the dedup store itself failed — we can't tell; surface loudly.
export type SendRecordOutcome = "recorded" | "duplicate" | "error";

let tableInitialized = false;

async function ensureTable(): Promise<void> {
  if (tableInitialized) return;
  // Intentionally let failures propagate to the caller so they are logged
  // instead of swallowed. We only flip the cache flag once the table actually
  // exists, so a transient failure here is retried on the next call rather than
  // poisoning every subsequent send.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS comms_send_log (
      id SERIAL PRIMARY KEY,
      send_key TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  tableInitialized = true;
}

export async function checkAndRecordSend(
  sendKey: string,
  channel: string
): Promise<SendRecordOutcome> {
  try {
    await ensureTable();
    const result = await db.execute(
      sql`INSERT INTO comms_send_log (send_key, channel) VALUES (${sendKey}, ${channel}) ON CONFLICT (send_key) DO NOTHING RETURNING id`
    );
    return (result as any).rows?.length > 0 ? "recorded" : "duplicate";
  } catch (err) {
    // The dedup store is unreachable/broken. Do NOT pretend the message was
    // already sent — that would silently suppress the email. Report the failure
    // so the caller can react and so it is observable in the logs.
    console.error(
      `[comms-dedup] Dedup store failure while recording send for key "${sendKey}" (channel ${channel}); cannot determine send state:`,
      err
    );
    return "error";
  }
}

export async function wasSent(sendKey: string): Promise<boolean> {
  try {
    await ensureTable();
    const result = await db.execute(
      sql`SELECT 1 FROM comms_send_log WHERE send_key = ${sendKey} LIMIT 1`
    );
    return (result as any).rows?.length > 0;
  } catch (err) {
    console.error(
      `[comms-dedup] Dedup store failure while checking send state for key "${sendKey}":`,
      err
    );
    return false;
  }
}
