import { Router, type Request, type Response } from "express";
import { db, mediaMavensProductsTable, mediaMavensCategoriesTable } from "@workspace/db";
import { eq, asc, and, ne } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const objectStorageService = new ObjectStorageService();

async function getValidCategoryNames(): Promise<string[]> {
  const rows = await db.select({ name: mediaMavensCategoriesTable.name }).from(mediaMavensCategoriesTable);
  return rows.map((r) => r.name);
}

function isValidUrl(value: string): boolean {
  if (!value) return true;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function validateProductBody(body: Record<string, unknown>, requireSlugName: boolean): Promise<string | null> {
  if (requireSlugName) {
    if (!body.slug || typeof body.slug !== "string" || !body.slug.trim()) {
      return "slug is required";
    }
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return "name is required";
    }
  }
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) {
    return "name must not be empty";
  }
  if (body.slug !== undefined) {
    if (typeof body.slug !== "string" || !/^[a-z0-9-]+$/.test(body.slug as string)) {
      return "slug must be lowercase letters, numbers, and hyphens only";
    }
  }
  if (body.category !== undefined) {
    const validNames = await getValidCategoryNames();
    if (typeof body.category !== "string" || !validNames.includes(body.category)) {
      return `category must be one of: ${validNames.join(", ")}`;
    }
  }
  const urlFields: string[] = ["salesPageUrl", "logoDriveUrl", "affiliateLink"];
  for (const field of urlFields) {
    if (body[field] !== undefined && body[field] !== "" && body[field] !== null) {
      if (!isValidUrl(body[field] as string)) {
        return `${field} must be a valid URL (starting with http:// or https://)`;
      }
    }
  }
  return null;
}

router.get("/media-mavens-products", async (_req: Request, res: Response) => {
  try {
    const products = await db
      .select()
      .from(mediaMavensProductsTable)
      .where(eq(mediaMavensProductsTable.isActive, true))
      .orderBy(asc(mediaMavensProductsTable.displayOrder));
    res.json(products);
  } catch (error) {
    console.error("[MediaMavens] Error listing products:", error);
    res.status(500).json({ error: "Failed to list Media Mavens products" });
  }
});

router.get("/admin/media-mavens-products", requirePermission("content:manage"), async (_req: Request, res: Response) => {
  try {
    const products = await db
      .select()
      .from(mediaMavensProductsTable)
      .orderBy(asc(mediaMavensProductsTable.displayOrder));
    res.json(products);
  } catch (error) {
    console.error("[Admin] Error listing Media Mavens products:", error);
    res.status(500).json({ error: "Failed to list Media Mavens products" });
  }
});

router.post("/admin/media-mavens-products", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;

    const validationError = await validateProductBody(body, true);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const [existing] = await db
      .select({ id: mediaMavensProductsTable.id })
      .from(mediaMavensProductsTable)
      .where(eq(mediaMavensProductsTable.slug, body.slug as string));
    if (existing) {
      res.status(409).json({ error: "A product with this slug already exists" });
      return;
    }

    const firstCategory = await db.select({ name: mediaMavensCategoriesTable.name }).from(mediaMavensCategoriesTable).orderBy(asc(mediaMavensCategoriesTable.displayOrder)).limit(1);
    const defaultCategory = firstCategory[0]?.name ?? "Health";

    const [product] = await db.insert(mediaMavensProductsTable).values({
      slug: body.slug as string,
      name: body.name as string,
      tagline: (body.tagline as string) ?? "",
      category: (body.category as string) ?? defaultCategory,
      imageUrl: (body.imageUrl as string | null) ?? null,
      description: (body.description as string) ?? "",
      costToConsumer: (body.costToConsumer as string) ?? "",
      affiliateCommission: (body.affiliateCommission as string) ?? "",
      salesPageUrl: (body.salesPageUrl as string) ?? "",
      logoDriveUrl: (body.logoDriveUrl as string) ?? "",
      affiliateLink: (body.affiliateLink as string) ?? "",
      displayOrder: (body.displayOrder as number) ?? 0,
      isActive: (body.isActive as boolean) ?? true,
    }).returning();

    res.status(201).json(product);
  } catch (error) {
    console.error("[Admin] Error creating Media Mavens product:", error);
    res.status(500).json({ error: "Failed to create Media Mavens product" });
  }
});

router.put("/admin/media-mavens-products/:id", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [existing] = await db
      .select({ id: mediaMavensProductsTable.id })
      .from(mediaMavensProductsTable)
      .where(eq(mediaMavensProductsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const body = req.body as Record<string, unknown>;

    const validationError = await validateProductBody(body, false);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    if (body.slug !== undefined) {
      const [slugConflict] = await db
        .select({ id: mediaMavensProductsTable.id })
        .from(mediaMavensProductsTable)
        .where(and(eq(mediaMavensProductsTable.slug, body.slug as string), ne(mediaMavensProductsTable.id, id)));
      if (slugConflict) {
        res.status(409).json({ error: "A product with this slug already exists" });
        return;
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.slug !== undefined) updateData.slug = body.slug;
    if (body.name !== undefined) updateData.name = body.name;
    if (body.tagline !== undefined) updateData.tagline = body.tagline;
    if (body.category !== undefined) updateData.category = body.category;
    if ("imageUrl" in body) updateData.imageUrl = body.imageUrl;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.costToConsumer !== undefined) updateData.costToConsumer = body.costToConsumer;
    if (body.affiliateCommission !== undefined) updateData.affiliateCommission = body.affiliateCommission;
    if (body.salesPageUrl !== undefined) updateData.salesPageUrl = body.salesPageUrl;
    if (body.logoDriveUrl !== undefined) updateData.logoDriveUrl = body.logoDriveUrl;
    if (body.affiliateLink !== undefined) updateData.affiliateLink = body.affiliateLink;
    if (body.displayOrder !== undefined) updateData.displayOrder = body.displayOrder;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const [updated] = await db
      .update(mediaMavensProductsTable)
      .set(updateData)
      .where(eq(mediaMavensProductsTable.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating Media Mavens product:", error);
    res.status(500).json({ error: "Failed to update Media Mavens product" });
  }
});

router.delete("/admin/media-mavens-products/:id", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [existing] = await db
      .select({ id: mediaMavensProductsTable.id })
      .from(mediaMavensProductsTable)
      .where(eq(mediaMavensProductsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    await db.delete(mediaMavensProductsTable).where(eq(mediaMavensProductsTable.id, id));
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error deleting Media Mavens product:", error);
    res.status(500).json({ error: "Failed to delete Media Mavens product" });
  }
});

router.post("/admin/media-mavens-products/reorder", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const { order } = req.body as { order: Array<{ id: number; displayOrder: number }> };
    if (!Array.isArray(order)) {
      res.status(400).json({ error: "order must be an array" });
      return;
    }

    for (const item of order) {
      if (typeof item.id !== "number" || typeof item.displayOrder !== "number") {
        res.status(400).json({ error: "Each order item must have numeric id and displayOrder" });
        return;
      }
      await db
        .update(mediaMavensProductsTable)
        .set({ displayOrder: item.displayOrder })
        .where(eq(mediaMavensProductsTable.id, item.id));
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error reordering Media Mavens products:", error);
    res.status(500).json({ error: "Failed to reorder Media Mavens products" });
  }
});

router.post("/admin/media-mavens-products/upload-image-url", requirePermission("content:manage"), async (_req: Request, res: Response) => {
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const rawPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    const objectPath = rawPath.startsWith("/objects/") ? `/storage${rawPath}` : rawPath;
    res.json({ uploadURL, objectPath });
  } catch (error) {
    console.error("[Admin] Error generating image upload URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

export default router;
