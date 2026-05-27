import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function requireNotBanned(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: { code: "AUTHENTICATION_REQUIRED", message: "Authentication required" } });
    return;
  }

  const [user] = await db
    .select({ postingBannedAt: usersTable.postingBannedAt })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: { code: "AUTHENTICATION_REQUIRED", message: "Authentication required" } });
    return;
  }

  if (user.postingBannedAt) {
    res.status(403).json({
      error: {
        code: "POSTING_BANNED",
        message: "Your account has been banned from posting due to repeated community guideline violations.",
        bannedAt: user.postingBannedAt,
      },
    });
    return;
  }

  next();
}
