import { type Request, type Response, type NextFunction } from "express";
import { db, apiRequestLogTable } from "@workspace/db";

export function apiRequestLogger(req: Request, res: Response, next: NextFunction): void {
  if (!req.apiKeyContext) {
    next();
    return;
  }

  const startTime = Date.now();

  res.on("finish", () => {
    const responseTimeMs = Date.now() - startTime;

    db.insert(apiRequestLogTable)
      .values({
        requestId: req.requestId || "unknown",
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        responseTimeMs,
        apiKeyId: req.apiKeyContext?.id,
        apiKeyPrefix: req.apiKeyContext?.prefix,
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
      })
      .catch((err) => {
        console.error("[ApiRequestLogger] Failed to log request:", err);
      });
  });

  next();
}
