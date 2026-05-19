import { Router, type Request, type Response } from "express";
import { db, mediaMavensCategoriesTable, mediaMavensProductsTable } from "@workspace/db";
import { eq, asc, and, ne } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";

const router = Router();

function validateCategoryBody(body: Record<string, unknown>, requireFields: boolean): string | null {
  if (requireFields) {
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
  return null;
}

router.get("/media-mavens-categories", async (_req: Request, res: Response) => {
  try {
    const categories = await db
      .select()
      .from(mediaMavensCategoriesTable)
      .where(eq(mediaMavensCategoriesTable.isActive, true))
      .orderBy(asc(mediaMavensCategoriesTable.displayOrder));
    res.json(categories);
  } catch (error) {
    console.error("[MediaMavens] Error listing categories:", error);
    res.status(500).json({ error: "Failed to list categories" });
  }
});

router.get("/admin/media-mavens-categories", requirePermission("content:manage"), async (_req: Request, res: Response) => {
  try {
    const categories = await db
      .select()
      .from(mediaMavensCategoriesTable)
      .orderBy(asc(mediaMavensCategoriesTable.displayOrder));
    res.json(categories);
  } catch (error) {
    console.error("[Admin] Error listing categories:", error);
    res.status(500).json({ error: "Failed to list categories" });
  }
});

router.post("/admin/media-mavens-categories", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const err = validateCategoryBody(body, true);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }

    const [existing] = await db
      .select({ id: mediaMavensCategoriesTable.id })
      .from(mediaMavensCategoriesTable)
      .where(eq(mediaMavensCategoriesTable.slug, body.slug as string));
    if (existing) {
      res.status(409).json({ error: "A category with this slug already exists" });
      return;
    }

    const allRows = await db.select({ displayOrder: mediaMavensCategoriesTable.displayOrder }).from(mediaMavensCategoriesTable);
    const nextOrder = allRows.length === 0 ? 0 : Math.max(...allRows.map(r => r.displayOrder)) + 1;

    const [category] = await db.insert(mediaMavensCategoriesTable).values({
      slug: body.slug as string,
      name: body.name as string,
      displayOrder: (body.displayOrder as number | undefined) ?? nextOrder,
      isActive: (body.isActive as boolean | undefined) ?? true,
    }).returning();

    res.status(201).json(category);
  } catch (error) {
    console.error("[Admin] Error creating category:", error);
    res.status(500).json({ error: "Failed to create category" });
  }
});

router.put("/admin/media-mavens-categories/:id", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [existing] = await db
      .select()
      .from(mediaMavensCategoriesTable)
      .where(eq(mediaMavensCategoriesTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const err = validateCategoryBody(body, false);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }

    if (body.slug !== undefined && body.slug !== existing.slug) {
      const [conflict] = await db
        .select({ id: mediaMavensCategoriesTable.id })
        .from(mediaMavensCategoriesTable)
        .where(and(eq(mediaMavensCategoriesTable.slug, body.slug as string), ne(mediaMavensCategoriesTable.id, id)));
      if (conflict) {
        res.status(409).json({ error: "A category with this slug already exists" });
        return;
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.slug !== undefined) updateData.slug = body.slug;
    if (body.name !== undefined) updateData.name = body.name;
    if (body.displayOrder !== undefined) updateData.displayOrder = body.displayOrder;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const [updated] = await db
      .update(mediaMavensCategoriesTable)
      .set(updateData)
      .where(eq(mediaMavensCategoriesTable.id, id))
      .returning();

    if (body.name !== undefined && body.name !== existing.name) {
      await db
        .update(mediaMavensProductsTable)
        .set({ category: body.name as string })
        .where(eq(mediaMavensProductsTable.category, existing.name));
    }

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating category:", error);
    res.status(500).json({ error: "Failed to update category" });
  }
});

router.delete("/admin/media-mavens-categories/:id", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [existing] = await db
      .select()
      .from(mediaMavensCategoriesTable)
      .where(eq(mediaMavensCategoriesTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    const productsInCategory = await db
      .select({ id: mediaMavensProductsTable.id })
      .from(mediaMavensProductsTable)
      .where(eq(mediaMavensProductsTable.category, existing.name))
      .limit(1);

    if (productsInCategory.length > 0) {
      res.status(400).json({ error: "Cannot delete category with products. Move or remove the products first." });
      return;
    }

    await db.delete(mediaMavensCategoriesTable).where(eq(mediaMavensCategoriesTable.id, id));
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error deleting category:", error);
    res.status(500).json({ error: "Failed to delete category" });
  }
});

router.post("/admin/media-mavens-categories/reorder", requirePermission("content:manage"), async (req: Request, res: Response) => {
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
        .update(mediaMavensCategoriesTable)
        .set({ displayOrder: item.displayOrder })
        .where(eq(mediaMavensCategoriesTable.id, item.id));
    }
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error reordering categories:", error);
    res.status(500).json({ error: "Failed to reorder categories" });
  }
});

export default router;
