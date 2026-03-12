import { type Request } from "express";
import { db, auditLogTable } from "@workspace/db";

export interface AuditLogEntry {
  actorId?: number;
  actorEmail?: string;
  actionType: string;
  entityType: string;
  entityId?: string;
  description: string;
  changeDiff?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  req?: Request;
}

export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      actorId: entry.actorId,
      actorEmail: entry.actorEmail,
      actionType: entry.actionType,
      entityType: entry.entityType,
      entityId: entry.entityId,
      description: entry.description,
      changeDiff: entry.changeDiff,
      ipAddress: entry.req?.ip || entry.req?.headers["x-forwarded-for"] as string || null,
      userAgent: entry.req?.headers["user-agent"] || null,
      metadata: entry.metadata,
    });
  } catch (error) {
    console.error("[AuditLog] Failed to write audit log:", error);
  }
}

export function logAdminAction(req: Request, actionType: string, entityType: string, entityId: string | undefined, description: string, changeDiff?: Record<string, unknown>) {
  return logAuditEvent({
    actorId: req.userId,
    actorEmail: req.userEmail,
    actionType,
    entityType,
    entityId,
    description,
    changeDiff,
    req,
  });
}
