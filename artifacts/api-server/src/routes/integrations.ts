import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { sendError, ErrorCodes } from "../lib/api-errors";
import {
  getCachedGrantResponse,
  handleExternalGrantProduct,
  handleExternalRevokeProduct,
  redactPii,
} from "../lib/external-grant-product";

if (!process.env.MACHINE_PORTAL_SHARED_SECRET) {
  console.error(
    "[MachinePurchase] CRITICAL: MACHINE_PORTAL_SHARED_SECRET is not set. " +
      "All requests to POST /api/integrations/machine-purchase will return 503 until it is configured.",
  );
}

function verifyMachineSecret(provided: string): boolean {
  const secret = process.env.MACHINE_PORTAL_SHARED_SECRET ?? "";
  if (!secret) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  const maxLen = Math.max(a.length, b.length);
  const paddedA = Buffer.concat([a, Buffer.alloc(maxLen - a.length)]);
  const paddedB = Buffer.concat([b, Buffer.alloc(maxLen - b.length)]);
  return crypto.timingSafeEqual(paddedA, paddedB) && a.length === b.length;
}

const router: IRouter = Router();

function requireApiKeyScope(scope: string) {
  return (req: Request, res: Response, next: () => void): void => {
    if (!req.isApiKeyAuth || !req.apiKeyContext) {
      sendError(
        res,
        401,
        ErrorCodes.AUTHENTICATION_REQUIRED,
        "This endpoint requires API key authentication",
      );
      return;
    }
    if (!req.apiKeyContext.permissions.includes(scope)) {
      sendError(
        res,
        403,
        ErrorCodes.FORBIDDEN,
        `API key does not have the required scope: ${scope}`,
      );
      return;
    }
    next();
  };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateGrantProductBody(body: unknown): {
  ok: true;
  data: {
    externalOrderId: string;
    externalSource: string;
    customer: {
      email: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
    };
    productSlugs: string[];
    purchasedAt: string;
    metadata?: Record<string, unknown>;
  };
} | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  if (!b.externalOrderId || typeof b.externalOrderId !== "string" || b.externalOrderId.trim() === "") {
    return { ok: false, message: "externalOrderId is required and must be a non-empty string" };
  }
  if (!b.externalSource || typeof b.externalSource !== "string" || b.externalSource.trim() === "") {
    return { ok: false, message: "externalSource is required and must be a non-empty string" };
  }

  if (!b.customer || typeof b.customer !== "object") {
    return { ok: false, message: "customer is required and must be an object" };
  }
  const customer = b.customer as Record<string, unknown>;

  if (!customer.email || typeof customer.email !== "string" || !isValidEmail(customer.email)) {
    return { ok: false, message: "customer.email must be a valid email address" };
  }
  if (customer.firstName !== undefined && typeof customer.firstName !== "string") {
    return { ok: false, message: "customer.firstName must be a string" };
  }
  if (customer.lastName !== undefined && typeof customer.lastName !== "string") {
    return { ok: false, message: "customer.lastName must be a string" };
  }
  if (customer.phone !== undefined && typeof customer.phone !== "string") {
    return { ok: false, message: "customer.phone must be a string" };
  }

  if (!Array.isArray(b.productSlugs) || b.productSlugs.length === 0) {
    return { ok: false, message: "productSlugs must be a non-empty array of strings" };
  }
  for (const slug of b.productSlugs) {
    if (typeof slug !== "string" || slug.trim() === "") {
      return { ok: false, message: "Each productSlug must be a non-empty string" };
    }
  }

  if (!b.purchasedAt || typeof b.purchasedAt !== "string" || isNaN(Date.parse(b.purchasedAt))) {
    return { ok: false, message: "purchasedAt must be a valid ISO datetime string" };
  }

  if (b.metadata !== undefined && (typeof b.metadata !== "object" || Array.isArray(b.metadata))) {
    return { ok: false, message: "metadata must be a plain object if provided" };
  }

  return {
    ok: true,
    data: {
      externalOrderId: b.externalOrderId.trim(),
      externalSource: b.externalSource.trim(),
      customer: {
        email: customer.email,
        firstName: customer.firstName as string | undefined,
        lastName: customer.lastName as string | undefined,
        phone: customer.phone as string | undefined,
      },
      productSlugs: b.productSlugs as string[],
      purchasedAt: b.purchasedAt,
      metadata: b.metadata as Record<string, unknown> | undefined,
    },
  };
}

router.post(
  "/integrations/grant-product",
  requireApiKeyScope("integrations:grant_products"),
  async (req: Request, res: Response): Promise<void> => {
    const validation = validateGrantProductBody(req.body);
    if (!validation.ok) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, validation.message);
      return;
    }

    const body = validation.data;

    try {
      const cached = await getCachedGrantResponse(
        body.externalSource,
        body.externalOrderId,
      );
      if (cached) {
        res.json(cached);
        return;
      }

      const result = await handleExternalGrantProduct(body);

      if ("code" in result && result.code === "UNKNOWN_SLUGS") {
        sendError(
          res,
          404,
          ErrorCodes.NOT_FOUND,
          `Unknown product slug(s): ${result.unknownSlugs.join(", ")}`,
          { unknownSlugs: result.unknownSlugs },
        );
        return;
      }

      res.json(result);
    } catch (err: unknown) {
      // Redact PII (emails) before logging — request bodies and error
      // messages may contain customer email addresses that should not be
      // written to production log aggregators in plaintext.
      const safeMessage = redactPii(err);
      const stack =
        err instanceof Error && err.stack ? redactPii(err.stack) : undefined;
      console.error(
        "[Integrations] grant-product error:",
        safeMessage,
        stack ?? "",
      );
      sendError(
        res,
        500,
        ErrorCodes.INTERNAL_ERROR,
        "An internal error occurred while processing the grant",
      );
    }
  },
);

function validateRevokeProductBody(body: unknown):
  | {
      ok: true;
      data: { externalOrderId: string; externalSource: string; reason?: string };
    }
  | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  if (
    !b.externalOrderId ||
    typeof b.externalOrderId !== "string" ||
    b.externalOrderId.trim() === ""
  ) {
    return {
      ok: false,
      message: "externalOrderId is required and must be a non-empty string",
    };
  }
  if (
    !b.externalSource ||
    typeof b.externalSource !== "string" ||
    b.externalSource.trim() === ""
  ) {
    return {
      ok: false,
      message: "externalSource is required and must be a non-empty string",
    };
  }
  if (b.reason !== undefined && typeof b.reason !== "string") {
    return { ok: false, message: "reason must be a string when provided" };
  }

  return {
    ok: true,
    data: {
      externalOrderId: b.externalOrderId.trim(),
      externalSource: b.externalSource.trim(),
      reason:
        typeof b.reason === "string" && b.reason.trim() !== ""
          ? b.reason.trim()
          : undefined,
    },
  };
}

router.post(
  "/integrations/revoke-product",
  requireApiKeyScope("integrations:grant_products"),
  async (req: Request, res: Response): Promise<void> => {
    const validation = validateRevokeProductBody(req.body);
    if (!validation.ok) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, validation.message);
      return;
    }

    try {
      const result = await handleExternalRevokeProduct(validation.data);
      res.json(result);
    } catch (err: unknown) {
      const safeMessage = redactPii(err);
      const stack =
        err instanceof Error && err.stack ? redactPii(err.stack) : undefined;
      console.error(
        "[Integrations] revoke-product error:",
        safeMessage,
        stack ?? "",
      );
      sendError(
        res,
        500,
        ErrorCodes.INTERNAL_ERROR,
        "An internal error occurred while processing the revocation",
      );
    }
  },
);

const MACHINE_FUNNEL_SLUGS = ["yse-workshop", "yse-ebook", "your-second-engine"] as const;
type MachineFunnelSlug = (typeof MACHINE_FUNNEL_SLUGS)[number];

function validateMachinePurchaseBody(body: unknown):
  | {
      ok: true;
      data: {
        order_number: string;
        email: string;
        first_name?: string;
        last_name?: string;
        phone?: string;
        funnel_slug: MachineFunnelSlug;
        product_ids?: string[];
        total_cents?: number;
        occurred_at: string;
        tm_click_id?: string;
        tap_ref?: string;
      };
    }
  | { ok: false; message: string; details?: Record<string, string> } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  if (!b.order_number || typeof b.order_number !== "string" || b.order_number.trim() === "") {
    return { ok: false, message: "order_number is required and must be a non-empty string", details: { order_number: "required" } };
  }
  if (!b.email || typeof b.email !== "string" || !isValidEmail(b.email as string)) {
    return { ok: false, message: "email must be a valid email address", details: { email: "required, valid email" } };
  }
  if (!b.funnel_slug || typeof b.funnel_slug !== "string" || !MACHINE_FUNNEL_SLUGS.includes(b.funnel_slug as MachineFunnelSlug)) {
    return {
      ok: false,
      message: `funnel_slug is required and must be one of: ${MACHINE_FUNNEL_SLUGS.join(", ")}`,
      details: { funnel_slug: `must be one of: ${MACHINE_FUNNEL_SLUGS.join(", ")}` },
    };
  }
  if (!b.occurred_at || typeof b.occurred_at !== "string" || isNaN(Date.parse(b.occurred_at as string))) {
    return { ok: false, message: "occurred_at is required and must be a valid ISO 8601 datetime string", details: { occurred_at: "required, ISO 8601" } };
  }
  if (b.first_name !== undefined && typeof b.first_name !== "string") {
    return { ok: false, message: "first_name must be a string when provided" };
  }
  if (b.last_name !== undefined && typeof b.last_name !== "string") {
    return { ok: false, message: "last_name must be a string when provided" };
  }
  if (b.phone !== undefined && typeof b.phone !== "string") {
    return { ok: false, message: "phone must be a string when provided" };
  }
  if (b.product_ids !== undefined && (!Array.isArray(b.product_ids) || b.product_ids.some((id) => typeof id !== "string"))) {
    return { ok: false, message: "product_ids must be an array of strings when provided" };
  }
  if (b.total_cents !== undefined && (typeof b.total_cents !== "number" || !Number.isInteger(b.total_cents))) {
    return { ok: false, message: "total_cents must be an integer when provided" };
  }

  return {
    ok: true,
    data: {
      order_number: (b.order_number as string).trim(),
      email: (b.email as string).toLowerCase().trim(),
      first_name: b.first_name as string | undefined,
      last_name: b.last_name as string | undefined,
      phone: b.phone as string | undefined,
      funnel_slug: b.funnel_slug as MachineFunnelSlug,
      product_ids: b.product_ids as string[] | undefined,
      total_cents: b.total_cents as number | undefined,
      occurred_at: b.occurred_at as string,
      tm_click_id: b.tm_click_id as string | undefined,
      tap_ref: b.tap_ref as string | undefined,
    },
  };
}

router.post(
  "/integrations/machine-purchase",
  async (req: Request, res: Response): Promise<void> => {
    if (!process.env.MACHINE_PORTAL_SHARED_SECRET) {
      res.status(503).json({ error: { code: "SERVICE_UNAVAILABLE" } });
      return;
    }

    const provided = req.headers["x-machine-webhook-secret"];
    if (!provided || typeof provided !== "string" || !verifyMachineSecret(provided)) {
      res.status(401).json({ error: { code: "INVALID_SECRET" } });
      return;
    }

    const validation = validateMachinePurchaseBody(req.body);
    if (!validation.ok) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: validation.message,
          details: validation.details ?? {},
        },
      });
      return;
    }

    const { data } = validation;

    const metadata: Record<string, unknown> = {};
    if (data.tap_ref !== undefined) metadata.bts_ref = data.tap_ref;
    metadata.funnel_slug = data.funnel_slug;
    if (data.product_ids !== undefined) metadata.product_ids = data.product_ids;
    if (data.total_cents !== undefined) metadata.total_cents = data.total_cents;
    if (data.tm_click_id !== undefined) metadata.tm_click_id = data.tm_click_id;

    try {
      const cached = await getCachedGrantResponse("machine", data.order_number);
      if (cached) {
        res.status(200).json({
          received: true,
          deduped: true,
          userId: cached.userId,
        });
        return;
      }

      const result = await handleExternalGrantProduct({
        externalSource: "machine",
        externalOrderId: data.order_number,
        customer: {
          email: data.email,
          firstName: data.first_name,
          lastName: data.last_name,
          phone: data.phone,
        },
        productSlugs: ["yse_front_end"],
        purchasedAt: data.occurred_at,
        metadata,
      });

      if ("code" in result) {
        console.error(
          "[MachinePurchase] external grant failed:",
          result.code,
          "message" in result ? result.message : "",
        );
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "An internal error occurred while processing the grant",
          },
        });
        return;
      }

      if (result.userCreated) {
        res.status(201).json({
          received: true,
          userId: result.userId,
          userCreated: true,
          welcomeEmailQueued: true,
        });
      } else {
        res.status(200).json({
          received: true,
          merged: true,
          userId: result.userId,
          userCreated: false,
          welcomeEmailQueued: false,
        });
      }
    } catch (err: unknown) {
      const safeMessage = redactPii(err);
      const stack = err instanceof Error && err.stack ? redactPii(err.stack) : undefined;
      console.error("[MachinePurchase] machine-purchase error:", safeMessage, stack ?? "");
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "An internal error occurred while processing the grant",
        },
      });
    }
  },
);

export default router;
