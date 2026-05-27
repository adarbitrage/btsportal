import { Router, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendError, ErrorCodes } from "../lib/api-errors";
import { requireDmPermission, requireDmThreadParticipant } from "../middleware/dmPermissions";
import { isAdminRole } from "../middleware/rbac";
import { logAuditEvent } from "../lib/audit-log";
import {
  listThreadsForUser,
  findOrCreateThread,
  listMessages,
  insertMessage,
  markThreadRead,
  listRecipientsForUser,
  totalUnreadCount,
} from "../storage/dm";

const router = Router();

async function getSenderRole(userId: number): Promise<string | null> {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return user?.role ?? null;
}

router.get("/threads", async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const role = await getSenderRole(req.userId);
  if (!role) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "User not found");
    return;
  }

  if (role === "coach") {
    sendError(res, 403, ErrorCodes.FORBIDDEN, "DMs not permitted between these users");
    return;
  }

  const threads = await listThreadsForUser(req.userId, role);
  res.json({ threads });
});

router.post(
  "/threads",
  requireDmPermission(async (req) => {
    const { recipient_user_id } = req.body ?? {};
    return typeof recipient_user_id === "number" ? recipient_user_id : null;
  }),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.userId) {
      sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
      return;
    }

    const { recipient_user_id } = req.body ?? {};
    if (typeof recipient_user_id !== "number") {
      sendError(res, 400, ErrorCodes.BAD_REQUEST, "recipient_user_id is required");
      return;
    }

    const senderRole = await getSenderRole(req.userId);
    if (!senderRole) {
      sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "User not found");
      return;
    }

    const [recipient] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, recipient_user_id))
      .limit(1);

    if (!recipient) {
      sendError(res, 404, ErrorCodes.NOT_FOUND, "Recipient not found");
      return;
    }

    const memberId = senderRole === "member" ? req.userId : recipient_user_id;
    const adminId = isAdminRole(senderRole) ? req.userId : recipient_user_id;

    const { thread, created } = await findOrCreateThread(memberId, adminId);

    if (created) {
      logAuditEvent({
        actorId: req.userId,
        actionType: "dm_thread_created",
        entityType: "dm_thread",
        entityId: String(thread.id),
        description: `DM thread created between member ${memberId} and admin ${adminId}`,
        req,
      }).catch((err) => console.error("[DM] audit log error:", err));
    }

    res.status(200).json({ thread });
  }
);

router.get(
  "/threads/:id/messages",
  requireDmThreadParticipant,
  async (req: Request, res: Response): Promise<void> => {
    const thread = (req as any).dmThread;
    const cursor = req.query.cursor ? parseInt(req.query.cursor as string, 10) : null;
    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 100);

    if (cursor !== null && isNaN(cursor)) {
      sendError(res, 400, ErrorCodes.BAD_REQUEST, "Invalid cursor");
      return;
    }

    const messages = await listMessages(thread.id, cursor, limit);
    const nextCursor = messages.length === limit ? messages[messages.length - 1].id : null;
    res.json({ messages, nextCursor });
  }
);

router.post(
  "/threads/:id/messages",
  requireDmThreadParticipant,
  requireDmPermission(async (req) => {
    const thread = (req as any).dmThread;
    if (!req.userId || !thread) return null;
    const otherId = thread.memberId === req.userId ? thread.adminId : thread.memberId;
    return otherId;
  }),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.userId) {
      sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
      return;
    }

    const thread = (req as any).dmThread;
    const { body } = req.body ?? {};

    if (typeof body !== "string" || body.trim().length === 0) {
      sendError(res, 400, ErrorCodes.BAD_REQUEST, "body is required");
      return;
    }

    if (body.length > 5000) {
      sendError(res, 400, ErrorCodes.BAD_REQUEST, "body must be 5000 characters or fewer");
      return;
    }

    const message = await insertMessage(thread.id, req.userId, body.trim());

    logAuditEvent({
      actorId: req.userId,
      actionType: "dm_message_sent",
      entityType: "dm_message",
      entityId: String(message.id),
      description: `DM message sent in thread ${thread.id}`,
      req,
    }).catch((err) => console.error("[DM] audit log error:", err));

    res.status(201).json({ message });
  }
);

router.post(
  "/threads/:id/read",
  requireDmThreadParticipant,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.userId) {
      sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
      return;
    }

    const thread = (req as any).dmThread;
    await markThreadRead(thread.id, req.userId);
    res.json({ ok: true });
  }
);

router.get("/recipients", async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const role = await getSenderRole(req.userId);
  if (!role) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "User not found");
    return;
  }

  if (role === "coach") {
    sendError(res, 403, ErrorCodes.FORBIDDEN, "DMs not permitted between these users");
    return;
  }

  const recipients = await listRecipientsForUser(req.userId, role);
  res.json({ recipients });
});

router.get("/unread-count", async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const role = await getSenderRole(req.userId);
  if (role === "coach") {
    sendError(res, 403, ErrorCodes.FORBIDDEN, "DMs not permitted between these users");
    return;
  }

  const count = await totalUnreadCount(req.userId);
  res.json({ unreadCount: count });
});

export default router;
