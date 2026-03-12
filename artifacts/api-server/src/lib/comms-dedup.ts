import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

let tableInitialized = false;

async function ensureTable(): Promise<void> {
  if (tableInitialized) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS comms_send_log (
        id SERIAL PRIMARY KEY,
        send_key TEXT NOT NULL UNIQUE,
        channel TEXT NOT NULL,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    tableInitialized = true;
  } catch {
    tableInitialized = true;
  }
}

export async function checkAndRecordSend(sendKey: string, channel: string): Promise<boolean> {
  await ensureTable();
  try {
    const result = await db.execute(
      sql`INSERT INTO comms_send_log (send_key, channel) VALUES (${sendKey}, ${channel}) ON CONFLICT (send_key) DO NOTHING RETURNING id`
    );
    return (result as any).rows?.length > 0;
  } catch {
    return false;
  }
}

export async function wasSent(sendKey: string): Promise<boolean> {
  await ensureTable();
  try {
    const result = await db.execute(
      sql`SELECT 1 FROM comms_send_log WHERE send_key = ${sendKey} LIMIT 1`
    );
    return (result as any).rows?.length > 0;
  } catch {
    return false;
  }
}
