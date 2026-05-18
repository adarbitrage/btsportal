import { Router, type IRouter, type Request, type Response } from "express";
import { sendError, ErrorCodes } from "../lib/api-errors";
import {
  handleExternalGrantProduct,
  UnknownProductSlugsError,
} from "../lib/external-grant-product";

const router: IRouter = Router();

const GRANT_PRODUCT_SCOPE = "integrations:grant_products";

function requireGrantProductScope(req: Request, res: Response): boolean {
  if (!req.isApiKeyAuth) {
    sendError(
      res,
      401,
      ErrorCodes.AUTHENTICATION_REQUIRED,
      "This endpoint requires API key authentication"
    );
    return false;
  }

  const permissions = req.apiKeyContext?.permissions ?? [];
  if (!permissions.includes(GRANT_PRODUCT_SCOPE)) {
    sendError(
      res,
      403,
      ErrorCodes.FORBIDDEN,
      `API key missing required scope: ${GRANT_PRODUCT_SCOPE}`
    );
    return false;
  }

  if (req.apiKeyContext?.type !== "secret") {
    sendError(
      res,
      403,
      ErrorCodes.FORBIDDEN,
      "This endpoint requires a secret-type API key"
    );
    return false;
  }

  return true;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateBody(body: unknown): { data: ReturnType<typeof extractPayload>; error?: never } | { data?: never; error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  if (!b.externalOrderId || typeof b.externalOrderId !== "string" || b.externalOrderId.trim() === "") {
    return { error: "externalOrderId is required and must be a non-empty string" };
  }
  if (!b.externalSource || typeof b.externalSource !== "string" || b.externalSource.trim() === "") {
    return { error: "externalSource is required and must be a non-empty string" };
  }
  if (!b.customer || typeof b.customer !== "object") {
    return { error: "customer is required and must be an object" };
  }
  const customer = b.customer as Record<string, unknown>;
  if (!customer.email || typeof customer.email !== "string" || !isValidEmail(customer.email)) {
    return { error: "customer.email is required and must be a valid email address" };
  }
  if (customer.firstName !== undefined && typeof customer.firstName !== "string") {
    return { error: "customer.firstName must be a string when provided" };
  }
  if (customer.lastName !== undefined && typeof customer.lastName !== "string") {
    return { error: "customer.lastName must be a string when provided" };
  }
  if (customer.phone !== undefined && typeof customer.phone !== "string") {
    return { error: "customer.phone must be a string when provided" };
  }
  if (!Array.isArray(b.productSlugs) || b.productSlugs.length === 0) {
    return { error: "productSlugs is required and must be a non-empty array" };
  }
  for (const slug of b.productSlugs) {
    if (typeof slug !== "string" || slug.trim() === "") {
      return { error: "Each element of productSlugs must be a non-empty string" };
    }
  }
  if (!b.purchasedAt || typeof b.purchasedAt !== "string" || b.purchasedAt.trim() === "") {
    return { error: "purchasedAt is required and must be a non-empty string" };
  }
  if (b.metadata !== undefined && (typeof b.metadata !== "object" || Array.isArray(b.metadata))) {
    return { error: "metadata must be a plain object when provided" };
  }

  return { data: extractPayload(b) };
}

function extractPayload(b: Record<string, unknown>) {
  const customer = b.customer as Record<string, unknown>;
  return {
    externalOrderId: (b.externalOrderId as string).trim(),
    externalSource: (b.externalSource as string).trim(),
    customer: {
      email: (customer.email as string).trim(),
      firstName: customer.firstName as string | undefined,
      lastName: customer.lastName as string | undefined,
      phone: customer.phone as string | undefined,
    },
    productSlugs: (b.productSlugs as string[]).map((s) => s.trim()),
    purchasedAt: b.purchasedAt as string,
    metadata: b.metadata as Record<string, unknown> | undefined,
  };
}

router.post(
  "/integrations/grant-product",
  async (req: Request, res: Response) => {
    if (!requireGrantProductScope(req, res)) return;

    const validation = validateBody(req.body);
    if (validation.error) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, validation.error);
      return;
    }

    const payload = validation.data!;

    try {
      const result = await handleExternalGrantProduct(payload);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof UnknownProductSlugsError) {
        sendError(
          res,
          404,
          ErrorCodes.NOT_FOUND,
          err.message,
          { unknownSlugs: err.unknownSlugs }
        );
        return;
      }
      console.error("[IntegrationsGrantProduct] Error:", err);
      sendError(
        res,
        500,
        ErrorCodes.INTERNAL_ERROR,
        "Internal error processing grant request"
      );
    }
  }
);

export default router;
