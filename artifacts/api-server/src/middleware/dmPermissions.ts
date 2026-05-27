import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable, dmThreadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendError, ErrorCodes } from "../lib/api-errors";
import { isAdminRole } from "./rbac";

export function canDM(senderRole: string, recipientRole: string): boolean {
  if (senderRole === "coach" || recipientRole === "coach") return false;
  if (senderRole === "member" && isAdminRole(recipientRole)) return true;
  if (isAdminRole(senderRole) && recipientRole === "member") return true;
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

    if (sender.role === "coach") {
      sendError(res, 403, ErrorCodes.FORBIDDEN, "DMs not permitted between these users");
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

  if (user.role === "coach") {
    sendError(res, 403, ErrorCodes.FORBIDDEN, "DMs not permitted between these users");
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

  if (thread.memberId !== req.userId && thread.adminId !== req.userId) {
    sendError(res, 403, ErrorCodes.FORBIDDEN, "Not a participant in this thread");
    return;
  }

  (req as any).dmThread = thread;
  next();
}
