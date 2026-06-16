/**
 * Pack 1-on-1 coach notes + action items: normalization and GHL mirroring.
 *
 * Notes and action items are COACH/ADMIN-FACING ONLY — they are never returned
 * to members. This module owns:
 *  - normalizeActionItems(): validate/shape untrusted client input.
 *  - buildCoachingGHLNote(): render a note body for the member's GHL card.
 *  - syncBookingCoachingToGHL(): mirror notes/action items to the member's GHL
 *    contact card via the existing GHL sync queue.
 *
 * GHL contact routing: a booking's `ghlContactId` is the COACHING sub-account
 * contact (a different GHL location than the main ghl-client/ghl-queue operate
 * on). To land the note on the member's real, main-location contact card we go
 * through queueGHLSync keyed by the member's userId — resolveContactId() maps
 * that to usersTable.ghlContactId (the member's main contact). Passing the
 * booking's sub-account contact id straight to the main-location client would
 * fail, so we deliberately do NOT use booking.ghlContactId here.
 */

import { randomUUID } from "crypto";
import type { SessionPackActionItem } from "@workspace/db";
import { queueGHLSync } from "./ghl-queue";

/**
 * Coerce untrusted client input into a clean SessionPackActionItem[]. Drops
 * entries without text, trims text, (re)generates ids/timestamps as needed and
 * keeps completedAt consistent with completed.
 */
export function normalizeActionItems(input: unknown): SessionPackActionItem[] {
  if (!Array.isArray(input)) return [];
  const nowIso = new Date().toISOString();
  const out: SessionPackActionItem[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) continue;
    const completed = item.completed === true;
    const id =
      typeof item.id === "string" && item.id.trim() ? item.id.trim() : randomUUID();
    const createdAt =
      typeof item.createdAt === "string" && item.createdAt.trim()
        ? item.createdAt
        : nowIso;
    const completedAt = completed
      ? typeof item.completedAt === "string" && item.completedAt.trim()
        ? item.completedAt
        : nowIso
      : null;
    out.push({ id, text, completed, completedAt, createdAt });
  }
  return out;
}

interface CoachingNoteContext {
  coachName?: string | null;
  scheduledAt?: Date | string | null;
  coachNotes?: string | null;
  actionItems?: SessionPackActionItem[] | null;
}

/** Render a human-readable GHL note body. Returns null when there's nothing to record. */
export function buildCoachingGHLNote(ctx: CoachingNoteContext): string | null {
  const notes = ctx.coachNotes?.trim() || "";
  const items = ctx.actionItems ?? [];
  if (!notes && items.length === 0) return null;

  const lines: string[] = [];
  const when = ctx.scheduledAt ? new Date(ctx.scheduledAt) : null;
  const whenStr =
    when && !Number.isNaN(when.getTime())
      ? when.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
      : null;
  const header = ["1-on-1 coaching session", ctx.coachName?.trim(), whenStr]
    .filter(Boolean)
    .join(" — ");
  lines.push(header);

  if (notes) {
    lines.push("", "Notes:", notes);
  }
  if (items.length > 0) {
    lines.push("", "Action items:");
    for (const it of items) {
      lines.push(`${it.completed ? "[x]" : "[ ]"} ${it.text}`);
    }
  }
  return lines.join("\n");
}

/**
 * Mirror a booking's notes/action items to the member's GHL contact card.
 * Fire-and-forget and best-effort: failures are swallowed so they never block
 * (or fail) the coach/admin save. Pass the member's userId so the main-location
 * contact is resolved (see module header on contact routing).
 */
export function syncBookingCoachingToGHL(args: {
  memberId: number;
  coachName?: string | null;
  scheduledAt?: Date | string | null;
  coachNotes?: string | null;
  actionItems?: SessionPackActionItem[] | null;
}): void {
  const body = buildCoachingGHLNote(args);
  if (!body) return;
  void queueGHLSync({
    action: "add_note",
    userId: args.memberId,
    noteBody: body,
    metadata: { source: "pack-coaching-notes" },
  }).catch((err) => {
    console.error("[coaching-notes] GHL note sync failed:", err);
  });
}
