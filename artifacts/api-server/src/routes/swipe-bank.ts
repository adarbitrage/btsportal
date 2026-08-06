/**
 * Swipe Resource Bank routes (Task #2104 Phase 1).
 *
 * Member surface (ALL routes gated born-enforced on the `swipe-bank`
 * content-access page key — listing AND content bytes; admin/coach bypass
 * lives inside the page-access resolver):
 *   GET /swipe-bank                      — taxonomy tree + active items + disclaimer
 *   GET /swipe-bank/items/:id/content    — original bytes proxied from private storage
 *   GET /swipe-bank/items/:id/thumbnail  — generated thumbnail bytes (fallback: original)
 *
 * Admin (content:manage):
 *   taxonomy CRUD, item register (via presigned-PUT upload flow, thumbnail
 *   generated here from the original), item edit/soft-disable, disclaimer copy.
 *
 * Assets are ALWAYS proxied through these authed routes (Creative Drive
 * pattern) — never signed URLs, never public paths.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  db,
  swipeBankVerticalsTable,
  swipeBankSubVerticalsTable,
  swipeBankAnglesTable,
  swipeBankItemsTable,
  type SwipeBankItem,
} from "@workspace/db";
import { eq, asc, and, count } from "drizzle-orm";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { requirePageAccess } from "../middleware/require-page-access";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { logAdminAction } from "../lib/audit-log";
import {
  generateThumbnail,
  isThumbnailableMime,
} from "../lib/swipe-bank-thumbnails";
import {
  getSwipeBankDisclaimer,
  setSwipeBankDisclaimer,
} from "../lib/swipe-bank-settings";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

export const SWIPE_BANK_PAGE_KEY = "swipe-bank";
const ITEM_TYPES = ["banner", "advertorial"] as const;
const MAX_ASSET_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

function parseId(raw: string | string[]): number | null {
  const n = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isValidLabel(raw: unknown): raw is string {
  return typeof raw === "string" && raw.trim().length > 0 && raw.trim().length <= 255;
}

function nullableId(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function itemOut(row: SwipeBankItem) {
  return {
    id: row.id,
    itemType: row.itemType,
    subVerticalId: row.subVerticalId,
    angleId: row.angleId,
    title: row.title,
    sourceLabel: row.sourceLabel,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    hasThumbnail: !!row.thumbnailObjectPath,
  };
}

async function loadTaxonomy() {
  const [verticals, subVerticals, angles] = await Promise.all([
    db
      .select()
      .from(swipeBankVerticalsTable)
      .orderBy(asc(swipeBankVerticalsTable.sortOrder), asc(swipeBankVerticalsTable.id)),
    db
      .select()
      .from(swipeBankSubVerticalsTable)
      .orderBy(asc(swipeBankSubVerticalsTable.sortOrder), asc(swipeBankSubVerticalsTable.id)),
    db
      .select()
      .from(swipeBankAnglesTable)
      .orderBy(asc(swipeBankAnglesTable.sortOrder), asc(swipeBankAnglesTable.id)),
  ]);
  return { verticals, subVerticals, angles };
}

// ── Member endpoints ──────────────────────────────────────────────────────────

router.get(
  "/swipe-bank",
  authenticate,
  requirePageAccess(SWIPE_BANK_PAGE_KEY),
  async (_req: Request, res: Response) => {
    try {
      const [{ verticals, subVerticals, angles }, items, disclaimer] =
        await Promise.all([
          loadTaxonomy(),
          db
            .select()
            .from(swipeBankItemsTable)
            .where(eq(swipeBankItemsTable.isActive, true))
            .orderBy(asc(swipeBankItemsTable.sortOrder), asc(swipeBankItemsTable.id)),
          getSwipeBankDisclaimer(),
        ]);

      res.json({
        verticals: verticals.map((v) => ({
          id: v.id,
          name: v.name,
          subVerticals: subVerticals
            .filter((s) => s.verticalId === v.id)
            .map((s) => ({
              id: s.id,
              name: s.name,
              angles: angles
                .filter((a) => a.subVerticalId === s.id)
                .map((a) => ({ id: a.id, name: a.name })),
              items: items
                .filter((i) => i.subVerticalId === s.id)
                .map(itemOut),
            })),
        })),
        disclaimer,
      });
    } catch (error) {
      console.error("[SwipeBank] list error:", error);
      res.status(500).json({ error: "Failed to load the Swipe Resource Bank" });
    }
  },
);

async function getItemById(id: number): Promise<SwipeBankItem | null> {
  const [row] = await db
    .select()
    .from(swipeBankItemsTable)
    .where(eq(swipeBankItemsTable.id, id))
    .limit(1);
  return row ?? null;
}

async function streamObject(
  res: Response,
  objectPath: string,
  opts: { mimeType?: string | null; fileName?: string },
): Promise<void> {
  const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
  const response = await objectStorageService.downloadObject(objectFile);
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (opts.mimeType) res.setHeader("Content-Type", opts.mimeType);
  if (opts.fileName) {
    const encoded = encodeURIComponent(opts.fileName).replace(/'/g, "%27");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encoded}`);
  }
  if (response.body) {
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
  } else {
    res.end();
  }
}

/** Original asset bytes. Members may fetch inactive items' bytes NEVER. */
router.get(
  "/swipe-bank/items/:id/content",
  authenticate,
  requirePageAccess(SWIPE_BANK_PAGE_KEY),
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid item id" });
        return;
      }
      const item = await getItemById(id);
      if (!item || !item.isActive) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      await streamObject(res, item.objectPath, {
        mimeType: item.mimeType || null,
        fileName: item.title,
      });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Asset not found in storage" });
        return;
      }
      console.error("[SwipeBank] content error:", error);
      res.status(500).json({ error: "Failed to serve asset" });
    }
  },
);

/** Thumbnail bytes; falls back to the original when no thumbnail exists. */
router.get(
  "/swipe-bank/items/:id/thumbnail",
  authenticate,
  requirePageAccess(SWIPE_BANK_PAGE_KEY),
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid item id" });
        return;
      }
      const item = await getItemById(id);
      if (!item || !item.isActive) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      if (item.thumbnailObjectPath) {
        await streamObject(res, item.thumbnailObjectPath, {
          mimeType: "image/webp",
        });
      } else {
        await streamObject(res, item.objectPath, {
          mimeType: item.mimeType || null,
        });
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Thumbnail not found in storage" });
        return;
      }
      console.error("[SwipeBank] thumbnail error:", error);
      res.status(500).json({ error: "Failed to serve thumbnail" });
    }
  },
);

// ── Admin: taxonomy CRUD ──────────────────────────────────────────────────────

router.get(
  "/admin/swipe-bank/overview",
  authenticate,
  requirePermission("content:manage"),
  async (_req: Request, res: Response) => {
    try {
      const [{ verticals, subVerticals, angles }, items, disclaimer] =
        await Promise.all([
          loadTaxonomy(),
          db
            .select()
            .from(swipeBankItemsTable)
            .orderBy(asc(swipeBankItemsTable.sortOrder), asc(swipeBankItemsTable.id)),
          getSwipeBankDisclaimer(),
        ]);
      res.json({
        verticals,
        subVerticals,
        angles,
        items: items.map(itemOut),
        disclaimer,
      });
    } catch (error) {
      console.error("[SwipeBank] admin overview error:", error);
      res.status(500).json({ error: "Failed to load Swipe Bank admin data" });
    }
  },
);

type TaxonomyLevel = "vertical" | "subVertical" | "angle";

const TAXONOMY_TABLES = {
  vertical: swipeBankVerticalsTable,
  subVertical: swipeBankSubVerticalsTable,
  angle: swipeBankAnglesTable,
} as const;

router.post(
  "/admin/swipe-bank/taxonomy/:level",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const level = String(req.params.level) as TaxonomyLevel;
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!isValidLabel(body.name)) {
        res.status(400).json({ error: "A name (max 255 chars) is required" });
        return;
      }
      const name = (body.name as string).trim();
      const sortOrder = Number.isInteger(body.sortOrder) ? (body.sortOrder as number) : 0;

      let created: { id: number };
      if (level === "vertical") {
        [created] = await db
          .insert(swipeBankVerticalsTable)
          .values({ name, sortOrder })
          .returning({ id: swipeBankVerticalsTable.id });
      } else if (level === "subVertical") {
        const verticalId = nullableId(body.verticalId);
        if (!verticalId) {
          res.status(400).json({ error: "verticalId is required" });
          return;
        }
        const [parent] = await db
          .select({ id: swipeBankVerticalsTable.id })
          .from(swipeBankVerticalsTable)
          .where(eq(swipeBankVerticalsTable.id, verticalId))
          .limit(1);
        if (!parent) {
          res.status(404).json({ error: "Vertical not found" });
          return;
        }
        [created] = await db
          .insert(swipeBankSubVerticalsTable)
          .values({ name, sortOrder, verticalId })
          .returning({ id: swipeBankSubVerticalsTable.id });
      } else if (level === "angle") {
        const subVerticalId = nullableId(body.subVerticalId);
        if (!subVerticalId) {
          res.status(400).json({ error: "subVerticalId is required" });
          return;
        }
        const [parent] = await db
          .select({ id: swipeBankSubVerticalsTable.id })
          .from(swipeBankSubVerticalsTable)
          .where(eq(swipeBankSubVerticalsTable.id, subVerticalId))
          .limit(1);
        if (!parent) {
          res.status(404).json({ error: "Sub-vertical not found" });
          return;
        }
        [created] = await db
          .insert(swipeBankAnglesTable)
          .values({ name, sortOrder, subVerticalId })
          .returning({ id: swipeBankAnglesTable.id });
      } else {
        res.status(400).json({ error: "Invalid taxonomy level" });
        return;
      }

      void logAdminAction(
        req,
        "swipe_bank_taxonomy_create",
        "swipe_bank_taxonomy",
        `${level}:${created.id}`,
        `Created Swipe Bank ${level} "${name}"`,
      );
      res.status(201).json({ id: created.id });
    } catch (error) {
      console.error("[SwipeBank] taxonomy create error:", error);
      res.status(500).json({ error: "Failed to create taxonomy entry" });
    }
  },
);

router.patch(
  "/admin/swipe-bank/taxonomy/:level/:id",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const level = String(req.params.level) as TaxonomyLevel;
      const table = TAXONOMY_TABLES[level];
      if (!table) {
        res.status(400).json({ error: "Invalid taxonomy level" });
        return;
      }
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updates: { name?: string; sortOrder?: number } = {};
      if (body.name !== undefined) {
        if (!isValidLabel(body.name)) {
          res.status(400).json({ error: "Invalid name" });
          return;
        }
        updates.name = (body.name as string).trim();
      }
      if (body.sortOrder !== undefined && Number.isInteger(body.sortOrder)) {
        updates.sortOrder = body.sortOrder as number;
      }
      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "Nothing to update" });
        return;
      }
      const updated = await db
        .update(table)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(table.id, id))
        .returning({ id: table.id });
      if (updated.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      void logAdminAction(
        req,
        "swipe_bank_taxonomy_update",
        "swipe_bank_taxonomy",
        `${level}:${id}`,
        `Updated Swipe Bank ${level} #${id}`,
        updates,
      );
      res.json({ ok: true });
    } catch (error) {
      console.error("[SwipeBank] taxonomy update error:", error);
      res.status(500).json({ error: "Failed to update taxonomy entry" });
    }
  },
);

router.delete(
  "/admin/swipe-bank/taxonomy/:level/:id",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const level = String(req.params.level) as TaxonomyLevel;
      const table = TAXONOMY_TABLES[level];
      if (!table) {
        res.status(400).json({ error: "Invalid taxonomy level" });
        return;
      }
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }

      // Block deletion while anything still hangs off the node — cascades
      // would silently take items (and their storage references) with them.
      if (level === "vertical") {
        const [{ value: subCount }] = await db
          .select({ value: count() })
          .from(swipeBankSubVerticalsTable)
          .where(eq(swipeBankSubVerticalsTable.verticalId, id));
        if (subCount > 0) {
          res.status(409).json({ error: "Vertical still has sub-verticals — remove them first" });
          return;
        }
      } else if (level === "subVertical") {
        const [[{ value: angleCount }], [{ value: itemCount }]] = await Promise.all([
          db
            .select({ value: count() })
            .from(swipeBankAnglesTable)
            .where(eq(swipeBankAnglesTable.subVerticalId, id)),
          db
            .select({ value: count() })
            .from(swipeBankItemsTable)
            .where(eq(swipeBankItemsTable.subVerticalId, id)),
        ]);
        if (angleCount > 0 || itemCount > 0) {
          res.status(409).json({ error: "Sub-vertical still has angles or items — remove them first" });
          return;
        }
      } else {
        const [{ value: itemCount }] = await db
          .select({ value: count() })
          .from(swipeBankItemsTable)
          .where(eq(swipeBankItemsTable.angleId, id));
        if (itemCount > 0) {
          res.status(409).json({ error: "Angle still has items — reassign them first" });
          return;
        }
      }

      const deleted = await db.delete(table).where(eq(table.id, id)).returning({ id: table.id });
      if (deleted.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      void logAdminAction(
        req,
        "swipe_bank_taxonomy_delete",
        "swipe_bank_taxonomy",
        `${level}:${id}`,
        `Deleted Swipe Bank ${level} #${id}`,
      );
      res.json({ ok: true });
    } catch (error) {
      console.error("[SwipeBank] taxonomy delete error:", error);
      res.status(500).json({ error: "Failed to delete taxonomy entry" });
    }
  },
);

// ── Admin: items ──────────────────────────────────────────────────────────────

/**
 * POST /api/admin/swipe-bank/items
 * { itemType, subVerticalId, angleId?, title, sourceLabel?, objectPath, sortOrder? }
 * Registers an asset uploaded via /storage/uploads/request-url; reads real
 * size/content-type back from storage and generates the thumbnail here
 * (original bytes are never modified).
 */
router.post(
  "/admin/swipe-bank/items",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const itemType = String(body.itemType ?? "");
      if (!(ITEM_TYPES as readonly string[]).includes(itemType)) {
        res.status(400).json({ error: "itemType must be banner or advertorial" });
        return;
      }
      if (!isValidLabel(body.title)) {
        res.status(400).json({ error: "A title (max 255 chars) is required" });
        return;
      }
      const objectPath = body.objectPath;
      if (typeof objectPath !== "string" || !objectPath.startsWith("/objects/")) {
        res.status(400).json({ error: "objectPath must be a normalized /objects/... path" });
        return;
      }
      const subVerticalId = nullableId(body.subVerticalId);
      if (!subVerticalId) {
        res.status(400).json({ error: "subVerticalId is required" });
        return;
      }
      const [sub] = await db
        .select({ id: swipeBankSubVerticalsTable.id })
        .from(swipeBankSubVerticalsTable)
        .where(eq(swipeBankSubVerticalsTable.id, subVerticalId))
        .limit(1);
      if (!sub) {
        res.status(404).json({ error: "Sub-vertical not found" });
        return;
      }
      const angleId = nullableId(body.angleId);
      if (angleId) {
        const [angle] = await db
          .select({ subVerticalId: swipeBankAnglesTable.subVerticalId })
          .from(swipeBankAnglesTable)
          .where(eq(swipeBankAnglesTable.id, angleId))
          .limit(1);
        if (!angle || angle.subVerticalId !== subVerticalId) {
          res.status(400).json({ error: "Angle must belong to the chosen sub-vertical" });
          return;
        }
      }

      let stored: { size: number; contentType: string };
      try {
        stored = await objectStorageService.getObjectEntityMetadata(objectPath);
      } catch (err) {
        if (err instanceof ObjectNotFoundError) {
          res.status(400).json({ error: "Uploaded object not found in storage" });
          return;
        }
        throw err;
      }
      if (stored.size > MAX_ASSET_SIZE_BYTES) {
        res.status(400).json({ error: "File exceeds the 100MB size limit" });
        return;
      }
      const mimeType =
        stored.contentType ||
        (typeof body.mimeType === "string" ? body.mimeType : "") ||
        "application/octet-stream";

      // Thumbnail pipeline: images get a downscaled webp stored alongside
      // the original. Failure to thumbnail is loud (registration fails) so
      // the team never silently ships a broken grid.
      let thumbnailObjectPath: string | null = null;
      if (isThumbnailableMime(mimeType)) {
        const original = await objectStorageService.getObjectEntityBytes(objectPath);
        const thumb = await generateThumbnail(original, mimeType);
        if (thumb) {
          thumbnailObjectPath = await objectStorageService.saveObjectEntityBytes(
            `uploads/swipe-thumb-${randomUUID()}`,
            thumb.bytes,
            thumb.contentType,
          );
        }
      }

      // Lock down the raw storage objects: without an ACL policy the generic
      // /api/storage/objects/* route serves them to ANY authenticated member,
      // bypassing the swipe-bank ownership gate. A private owner-only policy
      // makes that route deny everyone but the uploading admin; members only
      // ever get bytes through the gated /swipe-bank proxy routes.
      const aclPolicy = { owner: String(req.userId), visibility: "private" as const };
      await objectStorageService.trySetObjectEntityAclPolicy(objectPath, aclPolicy);
      if (thumbnailObjectPath) {
        await objectStorageService.trySetObjectEntityAclPolicy(thumbnailObjectPath, aclPolicy);
      }

      const [item] = await db
        .insert(swipeBankItemsTable)
        .values({
          itemType,
          subVerticalId,
          angleId,
          title: (body.title as string).trim(),
          sourceLabel: typeof body.sourceLabel === "string" ? body.sourceLabel.trim() : "",
          objectPath,
          thumbnailObjectPath,
          mimeType,
          sizeBytes: stored.size,
          sortOrder: Number.isInteger(body.sortOrder) ? (body.sortOrder as number) : 0,
        })
        .returning();

      void logAdminAction(
        req,
        "swipe_bank_item_create",
        "swipe_bank_item",
        String(item.id),
        `Registered Swipe Bank ${itemType} "${item.title}" (#${item.id})`,
      );
      res.status(201).json({ item: itemOut(item) });
    } catch (error) {
      console.error("[SwipeBank] item create error:", error);
      res.status(500).json({ error: "Failed to register item" });
    }
  },
);

router.patch(
  "/admin/swipe-bank/items/:id",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid item id" });
        return;
      }
      const existing = await getItemById(id);
      if (!existing) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updates: Partial<typeof swipeBankItemsTable.$inferInsert> = {};
      const changes: string[] = [];

      if (body.itemType !== undefined) {
        if (!(ITEM_TYPES as readonly string[]).includes(String(body.itemType))) {
          res.status(400).json({ error: "itemType must be banner or advertorial" });
          return;
        }
        updates.itemType = String(body.itemType);
        changes.push(`type→${updates.itemType}`);
      }
      if (body.title !== undefined) {
        if (!isValidLabel(body.title)) {
          res.status(400).json({ error: "Invalid title" });
          return;
        }
        updates.title = (body.title as string).trim();
        changes.push("title");
      }
      if (body.sourceLabel !== undefined) {
        updates.sourceLabel =
          typeof body.sourceLabel === "string" ? body.sourceLabel.trim() : "";
        changes.push("sourceLabel");
      }
      if (body.sortOrder !== undefined && Number.isInteger(body.sortOrder)) {
        updates.sortOrder = body.sortOrder as number;
        changes.push("sortOrder");
      }
      if (body.isActive !== undefined) {
        updates.isActive = body.isActive === true;
        changes.push(updates.isActive ? "enabled" : "soft-disabled");
      }
      if (body.subVerticalId !== undefined) {
        const svId = nullableId(body.subVerticalId);
        if (!svId) {
          res.status(400).json({ error: "Invalid subVerticalId" });
          return;
        }
        const [sub] = await db
          .select({ id: swipeBankSubVerticalsTable.id })
          .from(swipeBankSubVerticalsTable)
          .where(eq(swipeBankSubVerticalsTable.id, svId))
          .limit(1);
        if (!sub) {
          res.status(404).json({ error: "Sub-vertical not found" });
          return;
        }
        updates.subVerticalId = svId;
        changes.push(`subVertical→${svId}`);
      }
      if (body.angleId !== undefined) {
        const aId = body.angleId === null ? null : nullableId(body.angleId);
        if (aId !== null) {
          if (!aId) {
            res.status(400).json({ error: "Invalid angleId" });
            return;
          }
          const targetSubVertical = updates.subVerticalId ?? existing.subVerticalId;
          const [angle] = await db
            .select({ subVerticalId: swipeBankAnglesTable.subVerticalId })
            .from(swipeBankAnglesTable)
            .where(eq(swipeBankAnglesTable.id, aId))
            .limit(1);
          if (!angle || angle.subVerticalId !== targetSubVertical) {
            res.status(400).json({ error: "Angle must belong to the item's sub-vertical" });
            return;
          }
        }
        updates.angleId = aId;
        changes.push(`angle→${aId ?? "none"}`);
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "Nothing to update" });
        return;
      }

      const [item] = await db
        .update(swipeBankItemsTable)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(swipeBankItemsTable.id, id))
        .returning();
      void logAdminAction(
        req,
        "swipe_bank_item_update",
        "swipe_bank_item",
        String(id),
        `Updated Swipe Bank item "${item.title}" (#${id}): ${changes.join(", ")}`,
      );
      res.json({ item: itemOut(item) });
    } catch (error) {
      console.error("[SwipeBank] item update error:", error);
      res.status(500).json({ error: "Failed to update item" });
    }
  },
);

/** Admin preview of any item's bytes (incl. soft-disabled), for the CRUD UI. */
router.get(
  "/admin/swipe-bank/items/:id/content",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid item id" });
        return;
      }
      const item = await getItemById(id);
      if (!item) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      await streamObject(res, item.objectPath, {
        mimeType: item.mimeType || null,
        fileName: item.title,
      });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Asset not found in storage" });
        return;
      }
      console.error("[SwipeBank] admin content error:", error);
      res.status(500).json({ error: "Failed to serve asset" });
    }
  },
);

// ── Admin: disclaimer copy ────────────────────────────────────────────────────

router.put(
  "/admin/swipe-bank/disclaimer",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const actor = `admin:${req.userId}`;
      let saved;
      try {
        saved = await setSwipeBankDisclaimer(req.body, actor);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Invalid disclaimer" });
        return;
      }
      void logAdminAction(
        req,
        "swipe_bank_disclaimer_update",
        "system_setting",
        "swipe_bank.disclaimer",
        "Updated Swipe Resource Bank disclaimer copy",
      );
      res.json({ disclaimer: saved });
    } catch (error) {
      console.error("[SwipeBank] disclaimer update error:", error);
      res.status(500).json({ error: "Failed to update disclaimer" });
    }
  },
);

export default router;
