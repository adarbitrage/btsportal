import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  db,
  creativeDriveFoldersTable,
  creativeDriveFilesTable,
  type CreativeDriveFolder,
} from "@workspace/db";
import { eq, isNull, asc, and } from "drizzle-orm";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getAccessiblePageKeys } from "../lib/content-access-resolver";
import { logAdminAction } from "../lib/audit-log";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const PAGE_KEY = "creative-drive";
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200MB

function getParam(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

function parseId(raw: string | string[]): number | null {
  const n = parseInt(getParam(raw), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Nullable folder id from query/body: undefined→invalid, null→root. */
function parseNullableFolderId(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined || raw === "" || raw === "root") return null;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function isValidName(raw: unknown): raw is string {
  return (
    typeof raw === "string" &&
    raw.trim().length > 0 &&
    raw.trim().length <= 255 &&
    !raw.includes("/") &&
    !raw.includes("\\")
  );
}

async function getFolderById(id: number): Promise<CreativeDriveFolder | null> {
  const [row] = await db
    .select()
    .from(creativeDriveFoldersTable)
    .where(eq(creativeDriveFoldersTable.id, id))
    .limit(1);
  return row ?? null;
}

/** Walks parent chain from `folder` up to the root (inclusive), root-first. */
async function buildBreadcrumb(
  folderId: number,
): Promise<Array<{ id: number; name: string }> | null> {
  const crumbs: Array<{ id: number; name: string }> = [];
  const seen = new Set<number>();
  let currentId: number | null = folderId;
  while (currentId !== null) {
    if (seen.has(currentId)) break; // defensive: cycle guard
    seen.add(currentId);
    const folder = await getFolderById(currentId);
    if (!folder) return crumbs.length === 0 ? null : crumbs.reverse();
    crumbs.push({ id: folder.id, name: folder.name });
    currentId = folder.parentId;
  }
  return crumbs.reverse();
}

/** True when `candidateAncestorId` is `folderId` itself or one of its descendants' path to root — i.e. moving folderId under candidate would create a cycle. */
async function wouldCreateCycle(
  folderId: number,
  newParentId: number,
): Promise<boolean> {
  if (folderId === newParentId) return true;
  const seen = new Set<number>();
  let currentId: number | null = newParentId;
  while (currentId !== null) {
    if (currentId === folderId) return true;
    if (seen.has(currentId)) return false;
    seen.add(currentId);
    const folder = await getFolderById(currentId);
    if (!folder) return false;
    currentId = folder.parentId;
  }
  return false;
}

async function listChildren(folderId: number | null) {
  const folderWhere =
    folderId === null
      ? isNull(creativeDriveFoldersTable.parentId)
      : eq(creativeDriveFoldersTable.parentId, folderId);
  const fileWhere =
    folderId === null
      ? isNull(creativeDriveFilesTable.folderId)
      : eq(creativeDriveFilesTable.folderId, folderId);

  const [folders, files] = await Promise.all([
    db
      .select({
        id: creativeDriveFoldersTable.id,
        name: creativeDriveFoldersTable.name,
        parentId: creativeDriveFoldersTable.parentId,
        createdAt: creativeDriveFoldersTable.createdAt,
        updatedAt: creativeDriveFoldersTable.updatedAt,
      })
      .from(creativeDriveFoldersTable)
      .where(folderWhere)
      .orderBy(asc(creativeDriveFoldersTable.name)),
    db
      .select({
        id: creativeDriveFilesTable.id,
        folderId: creativeDriveFilesTable.folderId,
        name: creativeDriveFilesTable.name,
        mimeType: creativeDriveFilesTable.mimeType,
        sizeBytes: creativeDriveFilesTable.sizeBytes,
        createdAt: creativeDriveFilesTable.createdAt,
        updatedAt: creativeDriveFilesTable.updatedAt,
      })
      .from(creativeDriveFilesTable)
      .where(fileWhere)
      .orderBy(asc(creativeDriveFilesTable.sortOrder), asc(creativeDriveFilesTable.name)),
  ]);
  return { folders, files };
}

// ── Member access gate ────────────────────────────────────────────────────────

/** Whole-drive gate via the Content Access Map `creative-drive` page key.
 *  Admin/coach bypass happens inside getAccessiblePageKeys. */
async function requireDriveAccess(req: Request, res: Response): Promise<boolean> {
  if (!req.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  const keys = await getAccessiblePageKeys(req.userId);
  if (!keys.includes(PAGE_KEY)) {
    res.status(403).json({ error: "You don't have access to the Creative Drive" });
    return false;
  }
  return true;
}

// ── Member endpoints (read-only) ─────────────────────────────────────────────

/**
 * GET /api/creative-drive/browse?folderId=<id|root>
 * Lists the folders + files inside a folder (root when folderId omitted),
 * with a breadcrumb trail back to the root.
 */
router.get(
  "/creative-drive/browse",
  authenticate,
  async (req: Request, res: Response) => {
    try {
      if (!(await requireDriveAccess(req, res))) return;

      const folderId = parseNullableFolderId(req.query.folderId);
      if (folderId === undefined) {
        res.status(400).json({ error: "Invalid folderId" });
        return;
      }

      let breadcrumb: Array<{ id: number; name: string }> = [];
      if (folderId !== null) {
        const folder = await getFolderById(folderId);
        if (!folder) {
          res.status(404).json({ error: "Folder not found" });
          return;
        }
        breadcrumb = (await buildBreadcrumb(folderId)) ?? [];
      }

      const { folders, files } = await listChildren(folderId);
      res.json({ folderId, breadcrumb, folders, files });
    } catch (error) {
      console.error("[CreativeDrive] browse error:", error);
      res.status(500).json({ error: "Failed to load Creative Drive" });
    }
  },
);

/**
 * GET /api/creative-drive/files/:id/content
 * Streams the file bytes from object storage through the API (authenticated,
 * gated on the creative-drive page key). `?download=1` forces a Save-As
 * Content-Disposition; otherwise the file is served inline so images/PDFs
 * render directly in <img>/<iframe> previews.
 */
router.get(
  "/creative-drive/files/:id/content",
  authenticate,
  async (req: Request, res: Response) => {
    try {
      if (!(await requireDriveAccess(req, res))) return;

      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid file id" });
        return;
      }
      const [file] = await db
        .select()
        .from(creativeDriveFilesTable)
        .where(eq(creativeDriveFilesTable.id, id))
        .limit(1);
      if (!file) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      const objectFile = await objectStorageService.getObjectEntityFile(file.objectPath);
      const response = await objectStorageService.downloadObject(objectFile);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (file.mimeType) {
        res.setHeader("Content-Type", file.mimeType);
      }
      const encodedName = encodeURIComponent(file.name).replace(/'/g, "%27");
      const disposition = req.query.download === "1" ? "attachment" : "inline";
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename*=UTF-8''${encodedName}`,
      );

      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "File content not found in storage" });
        return;
      }
      console.error("[CreativeDrive] content error:", error);
      res.status(500).json({ error: "Failed to serve file" });
    }
  },
);

// ── Admin endpoints ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/creative-drive/folders
 * Flat list of every folder (for move-target pickers).
 */
router.get(
  "/admin/creative-drive/folders",
  requirePermission("content:manage"),
  async (_req: Request, res: Response) => {
    try {
      const folders = await db
        .select()
        .from(creativeDriveFoldersTable)
        .orderBy(asc(creativeDriveFoldersTable.name));
      res.json({ folders });
    } catch (error) {
      console.error("[CreativeDrive] folder list error:", error);
      res.status(500).json({ error: "Failed to list folders" });
    }
  },
);

/**
 * POST /api/admin/creative-drive/folders  { name, parentId? }
 */
router.post(
  "/admin/creative-drive/folders",
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const { name } = req.body ?? {};
      if (!isValidName(name)) {
        res.status(400).json({ error: "Folder name is required (no slashes, max 255 chars)" });
        return;
      }
      const parentId = parseNullableFolderId(req.body?.parentId);
      if (parentId === undefined) {
        res.status(400).json({ error: "Invalid parentId" });
        return;
      }
      if (parentId !== null && !(await getFolderById(parentId))) {
        res.status(404).json({ error: "Parent folder not found" });
        return;
      }

      const [folder] = await db
        .insert(creativeDriveFoldersTable)
        .values({ name: name.trim(), parentId })
        .returning();

      void logAdminAction(
        req,
        "creative_drive_folder_create",
        "creative_drive_folder",
        String(folder.id),
        `Created Creative Drive folder "${folder.name}"${parentId ? ` in folder #${parentId}` : " at root"}`,
      );
      res.status(201).json({ folder });
    } catch (error) {
      console.error("[CreativeDrive] folder create error:", error);
      res.status(500).json({ error: "Failed to create folder" });
    }
  },
);

/**
 * PATCH /api/admin/creative-drive/folders/:id  { name?, parentId? }
 * Rename and/or move. Passing parentId: null moves to root.
 */
router.patch(
  "/admin/creative-drive/folders/:id",
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid folder id" });
        return;
      }
      const existing = await getFolderById(id);
      if (!existing) {
        res.status(404).json({ error: "Folder not found" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const updates: Partial<{ name: string; parentId: number | null }> = {};
      const changes: string[] = [];

      if ("name" in body) {
        if (!isValidName(body.name)) {
          res.status(400).json({ error: "Invalid folder name" });
          return;
        }
        updates.name = (body.name as string).trim();
        changes.push(`renamed "${existing.name}" → "${updates.name}"`);
      }

      if ("parentId" in body) {
        const parentId = parseNullableFolderId(body.parentId);
        if (parentId === undefined) {
          res.status(400).json({ error: "Invalid parentId" });
          return;
        }
        if (parentId !== null) {
          if (!(await getFolderById(parentId))) {
            res.status(404).json({ error: "Target folder not found" });
            return;
          }
          if (await wouldCreateCycle(id, parentId)) {
            res.status(400).json({ error: "Cannot move a folder into itself or its own subfolder" });
            return;
          }
        }
        updates.parentId = parentId;
        changes.push(`moved to ${parentId ? `folder #${parentId}` : "root"}`);
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "Nothing to update" });
        return;
      }

      const [folder] = await db
        .update(creativeDriveFoldersTable)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(creativeDriveFoldersTable.id, id))
        .returning();

      void logAdminAction(
        req,
        "creative_drive_folder_update",
        "creative_drive_folder",
        String(id),
        `Updated Creative Drive folder #${id}: ${changes.join(", ")}`,
      );
      res.json({ folder });
    } catch (error) {
      console.error("[CreativeDrive] folder update error:", error);
      res.status(500).json({ error: "Failed to update folder" });
    }
  },
);

/**
 * DELETE /api/admin/creative-drive/folders/:id
 * Blocked while the folder still contains files or subfolders.
 */
router.delete(
  "/admin/creative-drive/folders/:id",
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid folder id" });
        return;
      }
      const existing = await getFolderById(id);
      if (!existing) {
        res.status(404).json({ error: "Folder not found" });
        return;
      }

      const { folders, files } = await listChildren(id);
      if (folders.length > 0 || files.length > 0) {
        res.status(409).json({
          error: "Folder is not empty — move or delete its contents first",
        });
        return;
      }

      await db
        .delete(creativeDriveFoldersTable)
        .where(eq(creativeDriveFoldersTable.id, id));

      void logAdminAction(
        req,
        "creative_drive_folder_delete",
        "creative_drive_folder",
        String(id),
        `Deleted Creative Drive folder "${existing.name}" (#${id})`,
      );
      res.json({ ok: true });
    } catch (error) {
      console.error("[CreativeDrive] folder delete error:", error);
      res.status(500).json({ error: "Failed to delete folder" });
    }
  },
);

/**
 * POST /api/admin/creative-drive/files  { name, folderId?, objectPath, mimeType?, sizeBytes? }
 * Registers a file already uploaded via the /storage/uploads/request-url flow.
 * The real size/content-type are read back from storage so client-declared
 * metadata can't be spoofed.
 */
router.post(
  "/admin/creative-drive/files",
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { name, objectPath } = body;
      if (!isValidName(name)) {
        res.status(400).json({ error: "File name is required (no slashes, max 255 chars)" });
        return;
      }
      if (typeof objectPath !== "string" || !objectPath.startsWith("/objects/")) {
        res.status(400).json({ error: "objectPath must be a normalized /objects/... path" });
        return;
      }
      const folderId = parseNullableFolderId(body.folderId);
      if (folderId === undefined) {
        res.status(400).json({ error: "Invalid folderId" });
        return;
      }
      if (folderId !== null && !(await getFolderById(folderId))) {
        res.status(404).json({ error: "Folder not found" });
        return;
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
      if (stored.size > MAX_FILE_SIZE_BYTES) {
        res.status(400).json({ error: "File exceeds the 200MB size limit" });
        return;
      }

      const mimeType =
        stored.contentType ||
        (typeof body.mimeType === "string" ? body.mimeType : "") ||
        "application/octet-stream";

      const [file] = await db
        .insert(creativeDriveFilesTable)
        .values({
          name: (name as string).trim(),
          folderId,
          objectPath,
          mimeType,
          sizeBytes: stored.size,
        })
        .returning();

      void logAdminAction(
        req,
        "creative_drive_file_upload",
        "creative_drive_file",
        String(file.id),
        `Uploaded Creative Drive file "${file.name}" (${mimeType}, ${stored.size} bytes)${folderId ? ` to folder #${folderId}` : " at root"}`,
      );
      res.status(201).json({ file });
    } catch (error) {
      console.error("[CreativeDrive] file create error:", error);
      res.status(500).json({ error: "Failed to save file" });
    }
  },
);

/**
 * PATCH /api/admin/creative-drive/files/:id  { name?, folderId? }
 */
router.patch(
  "/admin/creative-drive/files/:id",
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid file id" });
        return;
      }
      const [existing] = await db
        .select()
        .from(creativeDriveFilesTable)
        .where(eq(creativeDriveFilesTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const updates: Partial<{ name: string; folderId: number | null }> = {};
      const changes: string[] = [];

      if ("name" in body) {
        if (!isValidName(body.name)) {
          res.status(400).json({ error: "Invalid file name" });
          return;
        }
        updates.name = (body.name as string).trim();
        changes.push(`renamed "${existing.name}" → "${updates.name}"`);
      }
      if ("folderId" in body) {
        const folderId = parseNullableFolderId(body.folderId);
        if (folderId === undefined) {
          res.status(400).json({ error: "Invalid folderId" });
          return;
        }
        if (folderId !== null && !(await getFolderById(folderId))) {
          res.status(404).json({ error: "Target folder not found" });
          return;
        }
        updates.folderId = folderId;
        changes.push(`moved to ${folderId ? `folder #${folderId}` : "root"}`);
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "Nothing to update" });
        return;
      }

      const [file] = await db
        .update(creativeDriveFilesTable)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(creativeDriveFilesTable.id, id))
        .returning();

      void logAdminAction(
        req,
        "creative_drive_file_update",
        "creative_drive_file",
        String(id),
        `Updated Creative Drive file #${id}: ${changes.join(", ")}`,
      );
      res.json({ file });
    } catch (error) {
      console.error("[CreativeDrive] file update error:", error);
      res.status(500).json({ error: "Failed to update file" });
    }
  },
);

/**
 * DELETE /api/admin/creative-drive/files/:id
 * Removes the DB row and best-effort deletes the storage object.
 */
router.delete(
  "/admin/creative-drive/files/:id",
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid file id" });
        return;
      }
      const [existing] = await db
        .select()
        .from(creativeDriveFilesTable)
        .where(eq(creativeDriveFilesTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      await db.delete(creativeDriveFilesTable).where(eq(creativeDriveFilesTable.id, id));

      // Best-effort storage cleanup — the DB row is authoritative, and an
      // orphaned blob is preferable to a dangling DB reference.
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(existing.objectPath);
        await objectFile.delete();
      } catch (cleanupErr) {
        console.error(
          `[CreativeDrive] failed to delete storage object ${existing.objectPath}:`,
          cleanupErr,
        );
      }

      void logAdminAction(
        req,
        "creative_drive_file_delete",
        "creative_drive_file",
        String(id),
        `Deleted Creative Drive file "${existing.name}" (#${id})`,
      );
      res.json({ ok: true });
    } catch (error) {
      console.error("[CreativeDrive] file delete error:", error);
      res.status(500).json({ error: "Failed to delete file" });
    }
  },
);

export default router;
