import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db, productsTable, usersTable } from "@workspace/db";
import { inArray, eq, sql } from "drizzle-orm";
import { sendError, ErrorCodes } from "../lib/api-errors";
import {
  getCachedGrantResponse,
  handleExternalGrantProduct,
  handleExternalRevokeProduct,
  redactPii,
} from "../lib/external-grant-product";
import {
  getMachineProductKeyMappings,
  recordUnknownMachineProductKeys,
  resolveMachineProductKeys,
} from "../lib/machine-product-key-mappings";

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
        portal_product_keys: string[];
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
  // Optional fields: accept undefined, null, or a value of the expected type.
  // Senders that emit JSON from a typed object frequently send `null` for
  // missing optional fields rather than omitting them — both shapes mean
  // "not provided" and are treated identically downstream.
  const optStr = (v: unknown) => v === undefined || v === null || typeof v === "string";
  if (!optStr(b.first_name)) {
    return { ok: false, message: "first_name must be a string or null when provided" };
  }
  if (!optStr(b.last_name)) {
    return { ok: false, message: "last_name must be a string or null when provided" };
  }
  if (!optStr(b.phone)) {
    return { ok: false, message: "phone must be a string or null when provided" };
  }
  if (!optStr(b.tm_click_id)) {
    return { ok: false, message: "tm_click_id must be a string or null when provided" };
  }
  if (!optStr(b.tap_ref)) {
    return { ok: false, message: "tap_ref must be a string or null when provided" };
  }
  if (b.product_ids !== undefined && b.product_ids !== null) {
    if (!Array.isArray(b.product_ids) || b.product_ids.some((id) => typeof id !== "string")) {
      return { ok: false, message: "product_ids must be an array of strings or null when provided" };
    }
  }
  if (b.total_cents !== undefined && b.total_cents !== null) {
    if (typeof b.total_cents !== "number" || !Number.isInteger(b.total_cents)) {
      return { ok: false, message: "total_cents must be an integer or null when provided" };
    }
  }

  // portal_product_keys: optional; missing/null → []; must be array of
  // snake_case-ish strings (lowercase letters, digits, underscores), each
  // 1–20 chars. Rejects obvious garbage so the contract can't drift.
  const SNAKE_CASE_ISH = /^[a-z0-9_]+$/;
  let portal_product_keys: string[] = [];
  if (b.portal_product_keys !== undefined && b.portal_product_keys !== null) {
    if (!Array.isArray(b.portal_product_keys)) {
      return {
        ok: false,
        message: "portal_product_keys must be an array of strings or null when provided",
        details: { portal_product_keys: "must be an array of strings" },
      };
    }
    for (const key of b.portal_product_keys) {
      if (
        typeof key !== "string" ||
        key.length < 1 ||
        key.length > 20 ||
        !SNAKE_CASE_ISH.test(key)
      ) {
        return {
          ok: false,
          message:
            "portal_product_keys entries must be snake_case-ish strings (lowercase letters, digits, underscores) of 1–20 characters",
          details: {
            portal_product_keys:
              "each entry must be a snake_case-ish string of 1–20 characters",
          },
        };
      }
    }
    portal_product_keys = b.portal_product_keys as string[];
  }

  // Coerce null → undefined on the way out so downstream code sees a single
  // "not provided" shape regardless of which sender style produced it.
  const orUndef = <T,>(v: unknown): T | undefined =>
    v === undefined || v === null ? undefined : (v as T);

  return {
    ok: true,
    data: {
      order_number: (b.order_number as string).trim(),
      email: (b.email as string).toLowerCase().trim(),
      first_name: orUndef<string>(b.first_name),
      last_name: orUndef<string>(b.last_name),
      phone: orUndef<string>(b.phone),
      funnel_slug: b.funnel_slug as MachineFunnelSlug,
      product_ids: orUndef<string[]>(b.product_ids),
      total_cents: orUndef<number>(b.total_cents),
      occurred_at: b.occurred_at as string,
      tm_click_id: orUndef<string>(b.tm_click_id),
      tap_ref: orUndef<string>(b.tap_ref),
      portal_product_keys,
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
    metadata.portal_product_keys = data.portal_product_keys;

    // Translate `portal_product_keys` → Portal product slugs via the
    // admin-editable mapping table. Unknown keys are captured into
    // `machine_unknown_product_keys` (surfaced to admins via the admin
    // panel) and also stamped onto the webhook_logs payload metadata
    // alongside the originals, so post-hoc reconciliation never has to
    // diff two separate sources of truth. If the mapping produces an
    // empty set (every key unknown, or none supplied), we fall back to
    // the legacy ["yse_front_end"] grant so the 201/200/200-dedupe wire
    // contract is unchanged for senders that haven't started emitting
    // the field yet — see task #493.
    let resolvedSlugs: string[];
    let unknownKeys: string[];
    let usedFallback: boolean;
    try {
      const mappings = await getMachineProductKeyMappings();
      const resolution = resolveMachineProductKeys(
        data.portal_product_keys,
        mappings,
      );
      resolvedSlugs = resolution.portalSlugs;
      unknownKeys = resolution.unknownKeys;
      usedFallback = resolution.usedFallback;
    } catch (err) {
      // The mapping read failed — preserve the previous behaviour
      // (front-end only) rather than 500ing on a non-grant code path.
      console.error(
        "[MachinePurchase] mapping lookup failed; falling back to yse_front_end:",
        redactPii(err),
      );
      resolvedSlugs = ["yse_front_end"];
      unknownKeys = [];
      usedFallback = true;
    }
    // Defensive: a mapping row may point at a portal slug whose `products`
    // row hasn't been seeded yet (e.g. a fresh test DB, or a mapping that
    // was added before the corresponding product). Filter those out so a
    // misconfigured mapping doesn't 500 the whole grant; the dropped
    // slugs are captured into metadata.unmapped_portal_slugs for admins.
    let unmappedSlugs: string[] = [];
    try {
      const existing = await db
        .select({ slug: productsTable.slug })
        .from(productsTable)
        .where(inArray(productsTable.slug, resolvedSlugs));
      const existingSet = new Set(existing.map((p) => p.slug));
      const filtered = resolvedSlugs.filter((s) => existingSet.has(s));
      unmappedSlugs = resolvedSlugs.filter((s) => !existingSet.has(s));
      if (filtered.length === 0) {
        // Every mapped slug is missing as a product — fall back to the
        // legacy front-end grant so the wire contract still holds.
        resolvedSlugs = ["yse_front_end"];
        usedFallback = true;
      } else {
        resolvedSlugs = filtered;
      }
    } catch (err) {
      console.error(
        "[MachinePurchase] product existence check failed; using resolved slugs as-is:",
        redactPii(err),
      );
    }

    metadata.resolved_portal_slugs = resolvedSlugs;
    metadata.unknown_portal_product_keys = unknownKeys;
    metadata.unmapped_portal_slugs = unmappedSlugs;
    metadata.portal_product_keys_fallback = usedFallback;

    if (unknownKeys.length > 0) {
      // Fire-and-forget: the helper swallows its own errors so a logging
      // failure can never block a successful grant.
      void recordUnknownMachineProductKeys(
        unknownKeys,
        "machine",
        data.order_number,
      );
    }

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
        productSlugs: resolvedSlugs,
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

// One-time, self-disabling super_admin bootstrap.
//
// Production starts with NO super_admin, and the in-app "assign role" endpoint
// is itself super_admin-only — a chicken-and-egg deadlock that nothing in the
// running app can break. This endpoint mints the FIRST super_admin so the
// normal in-app role-assignment flow can take over from there.
//
// Two hard guards keep it from being a standing backdoor:
//   1. It requires the machine shared secret (same secret + timing-safe compare
//      as the purchase webhook).
//   2. It self-disables: the instant ANY super_admin row exists it refuses every
//      request (409 ALREADY_BOOTSTRAPPED). It can therefore only ever create
//      that very first super_admin, never additional ones.
router.post(
  "/integrations/bootstrap-superadmin",
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

    const email =
      typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || !name || password.length < 8) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR" } });
      return;
    }

    try {
      const passwordHash = await bcrypt.hash(password, 12);

      // Serialize the whole check-then-write under a transaction-scoped
      // advisory lock so two concurrent valid requests can never both observe
      // "0 super_admins" and both create one (TOCTOU race). The lock auto-
      // releases at commit/rollback. The arbitrary key namespaces this lock.
      const outcome = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(4242042001)`);

        // Self-disabling guard: refuse the moment any super_admin already exists.
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(usersTable)
          .where(eq(usersTable.role, "super_admin"));
        if (n > 0) {
          return { kind: "already_bootstrapped" as const };
        }

        // Insert-only: never mutate an existing account. If the email is already
        // taken (e.g. a typo pointing at a real member), refuse rather than
        // silently reset their password/role and take over their account.
        const [existing] = await tx
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.email, email))
          .limit(1);
        if (existing) {
          return { kind: "email_exists" as const };
        }

        const [created] = await tx
          .insert(usersTable)
          .values({
            name,
            email,
            passwordHash,
            role: "super_admin",
            emailVerified: true,
            onboardingComplete: true,
          })
          .returning({ id: usersTable.id });
        return { kind: "created" as const, userId: created.id };
      });

      if (outcome.kind === "already_bootstrapped") {
        res.status(409).json({ error: { code: "ALREADY_BOOTSTRAPPED" } });
        return;
      }
      if (outcome.kind === "email_exists") {
        res.status(409).json({ error: { code: "EMAIL_EXISTS" } });
        return;
      }

      console.log(`[Bootstrap] First super_admin bootstrapped id=${outcome.userId}`);
      res.status(200).json({ success: true, id: outcome.userId });
    } catch (err: unknown) {
      console.error("[Bootstrap] super_admin bootstrap error:", redactPii(err));
      res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
    }
  },
);

export default router;
