import { Router, type IRouter, type Request, type Response } from "express";
import { sendError, ErrorCodes } from "../lib/api-errors";
import {
  getCachedGrantResponse,
  handleExternalGrantProduct,
} from "../lib/external-grant-product";

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
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Integrations] grant-product error:", message, err);
      sendError(
        res,
        500,
        ErrorCodes.INTERNAL_ERROR,
        "An internal error occurred while processing the grant",
      );
    }
  },
);

export default router;
