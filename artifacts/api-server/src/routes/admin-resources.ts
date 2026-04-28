import { Router, type Request, type Response } from "express";
import { db, lessonResourcesTable, lessonsTable } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { ObjectStorageService } from "../lib/objectStorage";
import { getUserEntitlements } from "../lib/entitlements";

const router = Router();

const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "application/zip",
];

const MAX_FILE_SIZE = 50 * 1024 * 1024;

router.post("/admin/lessons/:lessonId/resources/upload-url", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const lessonId = parseInt(req.params.lessonId as string, 10);
    if (isNaN(lessonId)) {
      res.status(400).json({ error: "Invalid lesson ID" });
      return;
    }

    const { fileName, fileSize, fileType } = req.body;
    if (!fileName || !fileSize || !fileType) {
      res.status(400).json({ error: "fileName, fileSize, and fileType are required" });
      return;
    }

    if (!ALLOWED_FILE_TYPES.includes(fileType)) {
      res.status(400).json({ error: `File type not allowed. Allowed: PDF, XLSX, DOCX, PNG, JPG, ZIP` });
      return;
    }

    if (fileSize > MAX_FILE_SIZE) {
      res.status(400).json({ error: "File size exceeds 50MB limit" });
      return;
    }

    const [lesson] = await db.select().from(lessonsTable).where(eq(lessonsTable.id, lessonId));
    if (!lesson) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }

    const storageService = new ObjectStorageService();
    const uploadURL = await storageService.getObjectEntityUploadURL();
    const objectPath = storageService.normalizeObjectEntityPath(uploadURL);

    res.json({ uploadURL, objectPath });
  } catch (error) {
    console.error("[Admin] Error requesting upload URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.post("/admin/lessons/:lessonId/resources", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const lessonId = parseInt(req.params.lessonId as string, 10);
    if (isNaN(lessonId)) {
      res.status(400).json({ error: "Invalid lesson ID" });
      return;
    }

    const { fileName, fileUrl, fileSize, fileType } = req.body;
    if (!fileName || !fileUrl || !fileType) {
      res.status(400).json({ error: "fileName, fileUrl, and fileType are required" });
      return;
    }

    const [maxOrder] = await db
      .select({ max: sql<number>`COALESCE(MAX(${lessonResourcesTable.sortOrder}), -1)` })
      .from(lessonResourcesTable)
      .where(eq(lessonResourcesTable.lessonId, lessonId));

    const [resource] = await db.insert(lessonResourcesTable).values({
      lessonId,
      fileName,
      fileUrl,
      fileSize: fileSize || 0,
      fileType,
      sortOrder: (maxOrder?.max ?? -1) + 1,
    }).returning();

    res.status(201).json(resource);
  } catch (error) {
    console.error("[Admin] Error creating resource:", error);
    res.status(500).json({ error: "Failed to create resource" });
  }
});

router.get("/admin/lessons/:lessonId/resources", requirePermission("content:view"), async (req: Request, res: Response) => {
  try {
    const lessonId = parseInt(req.params.lessonId as string, 10);
    if (isNaN(lessonId)) {
      res.status(400).json({ error: "Invalid lesson ID" });
      return;
    }

    const resources = await db.select()
      .from(lessonResourcesTable)
      .where(eq(lessonResourcesTable.lessonId, lessonId))
      .orderBy(asc(lessonResourcesTable.sortOrder));

    res.json(resources);
  } catch (error) {
    console.error("[Admin] Error listing resources:", error);
    res.status(500).json({ error: "Failed to list resources" });
  }
});

router.delete("/admin/resources/:id", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid resource ID" });
      return;
    }

    const [deleted] = await db.delete(lessonResourcesTable).where(eq(lessonResourcesTable.id, id)).returning();
    if (!deleted) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    res.json(deleted);
  } catch (error) {
    console.error("[Admin] Error deleting resource:", error);
    res.status(500).json({ error: "Failed to delete resource" });
  }
});

router.patch("/admin/lessons/:lessonId/resources/reorder", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) {
      res.status(400).json({ error: "orders must be an array of { id, sortOrder }" });
      return;
    }

    for (const { id, sortOrder } of orders) {
      await db.update(lessonResourcesTable).set({ sortOrder }).where(eq(lessonResourcesTable.id, id));
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error reordering resources:", error);
    res.status(500).json({ error: "Failed to reorder resources" });
  }
});

router.post("/admin/content/images/upload-url", requirePermission("content:manage"), async (_req: Request, res: Response) => {
  try {
    const storageService = new ObjectStorageService();
    const uploadURL = await storageService.getObjectEntityUploadURL();
    const objectPath = storageService.normalizeObjectEntityPath(uploadURL);

    res.json({ uploadURL, objectPath });
  } catch (error) {
    console.error("[Admin] Error requesting image upload URL:", error);
    res.status(500).json({ error: "Failed to generate image upload URL" });
  }
});

router.get("/lessons/:lessonId/resources/:resourceId/download", async (req: Request, res: Response) => {
  try {
    const lessonId = parseInt(req.params.lessonId as string, 10);
    const resourceId = parseInt(req.params.resourceId as string, 10);
    if (isNaN(lessonId) || isNaN(resourceId)) {
      res.status(400).json({ error: "Invalid IDs" });
      return;
    }

    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const [lesson] = await db.select().from(lessonsTable).where(eq(lessonsTable.id, lessonId));
    if (!lesson) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }

    const entitlements = await getUserEntitlements(req.userId);
    if (!entitlements.has(lesson.requiredEntitlement)) {
      res.status(403).json({ error: "You do not have access to this resource. Upgrade your plan to unlock it." });
      return;
    }

    const [resource] = await db.select()
      .from(lessonResourcesTable)
      .where(eq(lessonResourcesTable.id, resourceId));

    if (!resource || resource.lessonId !== lessonId) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    await db.update(lessonResourcesTable)
      .set({ downloadCount: resource.downloadCount + 1 })
      .where(eq(lessonResourcesTable.id, resourceId));

    const storageService = new ObjectStorageService();
    const file = await storageService.getObjectEntityFile(resource.fileUrl);
    const downloadResponse = await storageService.downloadObject(file);

    res.setHeader("Content-Disposition", `attachment; filename="${resource.fileName}"`);
    res.setHeader("Content-Type", resource.fileType);

    const body = downloadResponse.body;
    if (body) {
      const { Readable } = await import("stream");
      const nodeStream = Readable.fromWeb(body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("[Admin] Error downloading resource:", error);
    res.status(500).json({ error: "Failed to download resource" });
  }
});

export default router;
