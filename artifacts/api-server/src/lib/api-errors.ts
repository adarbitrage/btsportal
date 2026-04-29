import { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const ErrorCodes = {
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  INVALID_API_KEY: "INVALID_API_KEY",
  API_KEY_REVOKED: "API_KEY_REVOKED",
  API_KEY_EXPIRED: "API_KEY_EXPIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  BAD_REQUEST: "BAD_REQUEST",
  FORBIDDEN: "FORBIDDEN",
  CAPTCHA_REQUIRED: "CAPTCHA_REQUIRED",
  CAPTCHA_INVALID: "CAPTCHA_INVALID",
} as const;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

export function sendError(res: Response, statusCode: number, code: string, message: string, details?: unknown): void {
  const requestId = (res.req as Request).requestId || randomUUID();
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      requestId,
    },
  };
  if (details !== undefined) {
    body.error.details = details;
  }
  res.status(statusCode).json(body);
}

export function apiErrorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId || randomUUID();

  if (err instanceof ApiError) {
    const body: ApiErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        requestId,
      },
    };
    if (err.details !== undefined) {
      body.error.details = err.details;
    }
    res.status(err.statusCode).json(body);
    return;
  }

  console.error(`[${requestId}] Unhandled error:`, err);
  res.status(500).json({
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message: "An unexpected error occurred",
      requestId,
    },
  });
}
