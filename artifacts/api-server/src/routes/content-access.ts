import { Router, type Request, type Response } from "express";
import { db, contentAccessMapTable, productsTable } from "@workspace/db";
import { eq, asc, inArray } from "drizzle-orm";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import {
  GATEABLE_PAGES,
  GATEABLE_PAGE_KEYS,
  MAPPABLE_PRODUCTS,
  MAPPABLE_PRODUCT_SLUGS,
} from "@workspace/content-access-registry";
import { getAccessiblePageKeys } from "../lib/content-access-resolver";

const router = Router();

function getParam(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

// ── Member endpoint ───────────────────────────────────────────────────────────

/**
 * GET /api/content-access/me
 * Returns the set of page keys the current authenticated member may access.
 */
router.get(
  "/content-access/me",
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const accessiblePageKeys = await getAccessiblePageKeys(userId);
      res.json({ accessiblePageKeys });
    } catch (error) {
      console.error("[ContentAccess] /me error:", error);
      res.status(500).json({ error: "Failed to resolve content access" });
    }
  },
);

// ── Admin endpoints ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/content-access/catalog
 * Returns the full page registry, the 11 mappable products (slug + name from
 * the products table), and the current mappings.
 */
router.get(
  "/admin/content-access/catalog",
  requirePermission("members:view"),
  async (_req: Request, res: Response) => {
    try {
      const [mapRows, productRows] = await Promise.all([
        db
          .select({
            id: contentAccessMapTable.id,
            pageKey: contentAccessMapTable.pageKey,
            productSlugs: contentAccessMapTable.productSlugs,
            updatedBy: contentAccessMapTable.updatedBy,
            createdAt: contentAccessMapTable.createdAt,
            updatedAt: contentAccessMapTable.updatedAt,
          })
          .from(contentAccessMapTable)
          .orderBy(asc(contentAccessMapTable.pageKey)),
        db
          .select({ slug: productsTable.slug, name: productsTable.name })
          .from(productsTable)
          .where(inArray(productsTable.slug, [...MAPPABLE_PRODUCT_SLUGS]))
          .orderBy(asc(productsTable.name)),
      ]);

      const productsBySlug = new Map(productRows.map((p) => [p.slug, p.name]));

      const products = MAPPABLE_PRODUCTS.map((mp) => ({
        slug: mp.slug,
        group: mp.group,
        ladderOrder: mp.ladderOrder ?? null,
        name: productsBySlug.get(mp.slug) ?? mp.slug,
      }));

      const mappings = mapRows;

      res.json({
        pages: GATEABLE_PAGES,
        products,
        mappings,
      });
    } catch (error) {
      console.error("[ContentAccess] catalog error:", error);
      res.status(500).json({ error: "Failed to load content access catalog" });
    }
  },
);

/**
 * POST /api/admin/content-access
 * Create or upsert a page mapping. If productSlugs is empty, deletes the row.
 */
router.post(
  "/admin/content-access",
  requirePermission("members:edit"),
  async (req: Request, res: Response) => {
    const result = parseUpsertBody(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.message });
      return;
    }
    const { pageKey, productSlugs } = result.data;

    if (productSlugs.length === 0) {
      try {
        await db
          .delete(contentAccessMapTable)
          .where(eq(contentAccessMapTable.pageKey, pageKey));
        res.json({ ok: true, deleted: true, pageKey });
      } catch (error) {
        console.error("[ContentAccess] POST delete error:", error);
        res.status(500).json({ error: "Failed to delete content access mapping" });
      }
      return;
    }

    const dbCheck = await validateSlugsInDb(productSlugs);
    if (!dbCheck.ok) {
      res.status(400).json({ error: dbCheck.message });
      return;
    }

    try {
      const actor = req.userEmail || String(req.userId ?? "unknown");
      await db
        .insert(contentAccessMapTable)
        .values({ pageKey, productSlugs, updatedBy: actor })
        .onConflictDoUpdate({
          target: contentAccessMapTable.pageKey,
          set: {
            productSlugs,
            updatedBy: actor,
            updatedAt: new Date(),
          },
        });
      const [row] = await db
        .select()
        .from(contentAccessMapTable)
        .where(eq(contentAccessMapTable.pageKey, pageKey))
        .limit(1);
      res.status(201).json({ mapping: row });
    } catch (error) {
      console.error("[ContentAccess] POST error:", error);
      res.status(500).json({ error: "Failed to save content access mapping" });
    }
  },
);

/**
 * PATCH /api/admin/content-access/:id
 * Update a page mapping by ID. If productSlugs is empty, deletes the row.
 */
router.patch(
  "/admin/content-access/:id",
  requirePermission("members:edit"),
  async (req: Request, res: Response) => {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid mapping id" });
      return;
    }

    const result = parseUpsertBody(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.message });
      return;
    }
    const { pageKey, productSlugs } = result.data;

    try {
      const [existing] = await db
        .select({ id: contentAccessMapTable.id })
        .from(contentAccessMapTable)
        .where(eq(contentAccessMapTable.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Mapping not found" });
        return;
      }

      if (productSlugs.length === 0) {
        await db
          .delete(contentAccessMapTable)
          .where(eq(contentAccessMapTable.id, id));
        res.json({ ok: true, deleted: true, pageKey });
        return;
      }

      const dbCheck = await validateSlugsInDb(productSlugs);
      if (!dbCheck.ok) {
        res.status(400).json({ error: dbCheck.message });
        return;
      }

      const actor = req.userEmail || String(req.userId ?? "unknown");
      const [row] = await db
        .update(contentAccessMapTable)
        .set({ pageKey, productSlugs, updatedBy: actor, updatedAt: new Date() })
        .where(eq(contentAccessMapTable.id, id))
        .returning();

      res.json({ mapping: row });
    } catch (error) {
      console.error("[ContentAccess] PATCH error:", error);
      res.status(500).json({ error: "Failed to update content access mapping" });
    }
  },
);

/**
 * DELETE /api/admin/content-access/:id
 * Remove a page mapping (page reverts to OPEN).
 */
router.delete(
  "/admin/content-access/:id",
  requirePermission("members:edit"),
  async (req: Request, res: Response) => {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid mapping id" });
      return;
    }
    try {
      const [row] = await db
        .delete(contentAccessMapTable)
        .where(eq(contentAccessMapTable.id, id))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Mapping not found" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      console.error("[ContentAccess] DELETE error:", error);
      res.status(500).json({ error: "Failed to delete content access mapping" });
    }
  },
);

// ── Validation helpers ────────────────────────────────────────────────────────

const VALID_PAGE_KEY_SET = new Set(GATEABLE_PAGE_KEYS);
const MAPPABLE_SLUG_SET = new Set(MAPPABLE_PRODUCT_SLUGS);

type ParseResult =
  | { ok: true; data: { pageKey: string; productSlugs: string[] } }
  | { ok: false; message: string };

/** Validates shape and registry membership only (no DB query). */
function parseUpsertBody(body: unknown): ParseResult {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.pageKey !== "string" || !VALID_PAGE_KEY_SET.has(b.pageKey)) {
    return {
      ok: false,
      message: `pageKey must be one of: ${[...VALID_PAGE_KEY_SET].join(", ")}`,
    };
  }

  if (!Array.isArray(b.productSlugs)) {
    return { ok: false, message: "productSlugs must be an array" };
  }

  const notInRegistry = (b.productSlugs as unknown[]).filter(
    (s) => typeof s !== "string" || !MAPPABLE_SLUG_SET.has(s as string),
  );
  if (notInRegistry.length > 0) {
    return {
      ok: false,
      message: `Unrecognized product slugs: ${notInRegistry.join(", ")}. Must be one of: ${[...MAPPABLE_SLUG_SET].join(", ")}`,
    };
  }

  const unique = [...new Set(b.productSlugs as string[])];
  return { ok: true, data: { pageKey: b.pageKey, productSlugs: unique } };
}

/** Confirms submitted slugs exist in the products table. */
async function validateSlugsInDb(
  slugs: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const rows = await db
    .select({ slug: productsTable.slug })
    .from(productsTable)
    .where(inArray(productsTable.slug, slugs));
  const found = new Set(rows.map((r) => r.slug));
  const missing = slugs.filter((s) => !found.has(s));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Product slugs not found in database: ${missing.join(", ")}`,
    };
  }
  return { ok: true };
}

export default router;
