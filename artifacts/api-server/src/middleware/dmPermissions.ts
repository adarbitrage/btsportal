import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable, dmThreadsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendError, ErrorCodes } from "../lib/api-errors";
import { isAdminRole } from "./rbac";

/**
 * Returns true if (senderRole, recipientRole) is a permitted DM pair.
 *
 * Permitted:
 *   member  ↔ admin/support_agent/content_manager/etc  (existing)
 *   member  ↔ coach                                     (new)
 *   admin   ↔ member                                    (existing)
 *   coach   ↔ member                                    (new)
 *
 * Forbidden:
 *   member  ↔ member   (non-negotiable guarantee)
 *   coach   ↔ coach
 *   coach   ↔ admin    (not intended)
 */
export function canDM(senderRole: string, recipientRole: string): boolean {
  if (senderRole === "member" && isAdminRole(recipientRole)) return true;
  if (isAdminRole(senderRole) && recipientRole === "member") return true;
  if (senderRole === "member" && recipientRole === "coach") return true;
  if (senderRole === "coach" && recipientRole === "member") return true;
  return false;
}

export function requireDmPermission(
  getRecipientId: (req: Request) => Promise<number | null>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.userId) {
      sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
      return;
    }

    const [sender] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId))
      .limit(1);

    if (!sender) {
      sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "User not found");
      return;
    }

    const recipientId = await getRecipientId(req);
    if (recipientId === null) {
      next();
      return;
    }

    const [recipient] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, recipientId))
      .limit(1);

    if (!recipient) {
      sendError(res, 404, ErrorCodes.NOT_FOUND, "Recipient not found");
      return;
    }

    if (!canDM(sender.role, recipient.role)) {
      sendError(res, 403, ErrorCodes.FORBIDDEN, "DMs not permitted between these users");
      return;
    }

    next();
  };
}

export async function requireDmThreadParticipant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId))
    .limit(1);

  if (!user) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "User not found");
    return;
  }

  const threadId = parseInt(req.params.id, 10);
  if (isNaN(threadId)) {
    sendError(res, 400, ErrorCodes.BAD_REQUEST, "Invalid thread id");
    return;
  }

  const [thread] = await db
    .select()
    .from(dmThreadsTable)
    .where(eq(dmThreadsTable.id, threadId))
    .limit(1);

  if (!thread) {
    sendError(res, 404, ErrorCodes.NOT_FOUND, "Thread not found");
    return;
  }

  // Direct participant: member or the staff user who owns the thread.
  const isDirectParticipant = thread.memberId === req.userId || thread.adminId === req.userId;

  // Coach coverage: any coach may access any member↔coach thread.
  // Check that the thread's staff side is a coach so admin↔member
  // threads remain private.
  let isCoachCoverage = false;
  if (!isDirectParticipant && user.role === "coach") {
    const [staffUser] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(and(eq(usersTable.id, thread.adminId), eq(usersTable.role, "coach")))
      .limit(1);
    isCoachCoverage = !!staffUser;
  }

  if (!isDirectParticipant && !isCoachCoverage) {
    sendError(res, 403, ErrorCodes.FORBIDDEN, "Not a participant in this thread");
    return;
  }

  (req as any).dmThread = thread;
  next();
}
