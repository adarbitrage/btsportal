import { getParam } from "../lib/params";
import { Router, type Request, type Response } from "express";
import { db, affiliateNetworksTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const objectStorageService = new ObjectStorageService();

router.get("/affiliate-networks", async (_req: Request, res: Response) => {
  try {
    const networks = await db
      .select()
      .from(affiliateNetworksTable)
      .where(eq(affiliateNetworksTable.isActive, true))
      .orderBy(asc(affiliateNetworksTable.displayOrder));
    res.json(networks);
  } catch (error) {
    console.error("[AffiliateNetworks] Error listing networks:", error);
    res.status(500).json({ error: "Failed to list affiliate networks" });
  }
});

router.get("/admin/affiliate-networks", requirePermission("content:manage"), async (_req: Request, res: Response) => {
  try {
    const networks = await db
      .select()
      .from(affiliateNetworksTable)
      .orderBy(asc(affiliateNetworksTable.displayOrder));
    res.json(networks);
  } catch (error) {
    console.error("[Admin] Error listing affiliate networks:", error);
    res.status(500).json({ error: "Failed to list affiliate networks" });
  }
});

router.post("/admin/affiliate-networks", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      slug: string;
      name: string;
      tagline?: string;
      description?: string;
      logoUrl?: string;
      logoBg?: string;
      highlights?: string[];
      publishers?: string;
      approvalLabel?: string;
      recommendedForBeginners?: boolean;
      accentPreset?: string;
      accentBorder?: string;
      accentBadgeBg?: string;
      accentBadgeText?: string;
      accentBadgeBorder?: string;
      registerUrl?: string;
      loginUrl?: string;
      extraCtaLabel?: string;
      extraCtaHref?: string;
      extraCtaStyle?: string;
      displayOrder?: number;
      isActive?: boolean;
    };

    if (!body.slug || !body.name) {
      res.status(400).json({ error: "slug and name are required" });
      return;
    }

    const [existing] = await db
      .select({ id: affiliateNetworksTable.id })
      .from(affiliateNetworksTable)
      .where(eq(affiliateNetworksTable.slug, body.slug));
    if (existing) {
      res.status(409).json({ error: "A network with this slug already exists" });
      return;
    }

    const [network] = await db.insert(affiliateNetworksTable).values({
      slug: body.slug,
      name: body.name,
      tagline: body.tagline ?? "",
      description: body.description ?? "",
      logoUrl: body.logoUrl ?? null,
      logoBg: body.logoBg ?? "bg-white",
      highlights: body.highlights ?? [],
      publishers: body.publishers ?? "",
      approvalLabel: body.approvalLabel ?? "",
      recommendedForBeginners: body.recommendedForBeginners ?? false,
      accentPreset: body.accentPreset ?? "emerald",
      accentBorder: body.accentBorder ?? "border-emerald-300",
      accentBadgeBg: body.accentBadgeBg ?? "bg-emerald-50",
      accentBadgeText: body.accentBadgeText ?? "text-emerald-800",
      accentBadgeBorder: body.accentBadgeBorder ?? "border-emerald-200",
      registerUrl: body.registerUrl ?? null,
      loginUrl: body.loginUrl ?? null,
      extraCtaLabel: body.extraCtaLabel ?? null,
      extraCtaHref: body.extraCtaHref ?? null,
      extraCtaStyle: body.extraCtaStyle ?? "default",
      displayOrder: body.displayOrder ?? 0,
      isActive: body.isActive ?? true,
    }).returning();

    res.status(201).json(network);
  } catch (error) {
    console.error("[Admin] Error creating affiliate network:", error);
    res.status(500).json({ error: "Failed to create affiliate network" });
  }
});

router.put("/admin/affiliate-networks/:id", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [existing] = await db
      .select({ id: affiliateNetworksTable.id })
      .from(affiliateNetworksTable)
      .where(eq(affiliateNetworksTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Network not found" });
      return;
    }

    const body = req.body as Partial<{
      slug: string;
      name: string;
      tagline: string;
      description: string;
      logoUrl: string | null;
      logoBg: string;
      highlights: string[];
      publishers: string;
      approvalLabel: string;
      recommendedForBeginners: boolean;
      accentPreset: string;
      accentBorder: string;
      accentBadgeBg: string;
      accentBadgeText: string;
      accentBadgeBorder: string;
      registerUrl: string | null;
      loginUrl: string | null;
      extraCtaLabel: string | null;
      extraCtaHref: string | null;
      extraCtaStyle: string;
      displayOrder: number;
      isActive: boolean;
    }>;

    const updateData: Record<string, unknown> = {};
    if (body.slug !== undefined) updateData.slug = body.slug;
    if (body.name !== undefined) updateData.name = body.name;
    if (body.tagline !== undefined) updateData.tagline = body.tagline;
    if (body.description !== undefined) updateData.description = body.description;
    if ("logoUrl" in body) updateData.logoUrl = body.logoUrl;
    if (body.logoBg !== undefined) updateData.logoBg = body.logoBg;
    if (body.highlights !== undefined) updateData.highlights = body.highlights;
    if (body.publishers !== undefined) updateData.publishers = body.publishers;
    if (body.approvalLabel !== undefined) updateData.approvalLabel = body.approvalLabel;
    if (body.recommendedForBeginners !== undefined) updateData.recommendedForBeginners = body.recommendedForBeginners;
    if (body.accentPreset !== undefined) updateData.accentPreset = body.accentPreset;
    if (body.accentBorder !== undefined) updateData.accentBorder = body.accentBorder;
    if (body.accentBadgeBg !== undefined) updateData.accentBadgeBg = body.accentBadgeBg;
    if (body.accentBadgeText !== undefined) updateData.accentBadgeText = body.accentBadgeText;
    if (body.accentBadgeBorder !== undefined) updateData.accentBadgeBorder = body.accentBadgeBorder;
    if ("registerUrl" in body) updateData.registerUrl = body.registerUrl;
    if ("loginUrl" in body) updateData.loginUrl = body.loginUrl;
    if ("extraCtaLabel" in body) updateData.extraCtaLabel = body.extraCtaLabel;
    if ("extraCtaHref" in body) updateData.extraCtaHref = body.extraCtaHref;
    if (body.extraCtaStyle !== undefined) updateData.extraCtaStyle = body.extraCtaStyle;
    if (body.displayOrder !== undefined) updateData.displayOrder = body.displayOrder;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const [updated] = await db
      .update(affiliateNetworksTable)
      .set(updateData)
      .where(eq(affiliateNetworksTable.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating affiliate network:", error);
    res.status(500).json({ error: "Failed to update affiliate network" });
  }
});

router.delete("/admin/affiliate-networks/:id", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [existing] = await db
      .select({ id: affiliateNetworksTable.id })
      .from(affiliateNetworksTable)
      .where(eq(affiliateNetworksTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Network not found" });
      return;
    }

    await db.delete(affiliateNetworksTable).where(eq(affiliateNetworksTable.id, id));
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error deleting affiliate network:", error);
    res.status(500).json({ error: "Failed to delete affiliate network" });
  }
});

router.post("/admin/affiliate-networks/reorder", requirePermission("content:manage"), async (req: Request, res: Response) => {
  try {
    const { order } = req.body as { order: Array<{ id: number; displayOrder: number }> };
    if (!Array.isArray(order)) {
      res.status(400).json({ error: "order must be an array" });
      return;
    }

    for (const item of order) {
      await db
        .update(affiliateNetworksTable)
        .set({ displayOrder: item.displayOrder })
        .where(eq(affiliateNetworksTable.id, item.id));
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error reordering affiliate networks:", error);
    res.status(500).json({ error: "Failed to reorder affiliate networks" });
  }
});

router.post("/admin/affiliate-networks/upload-logo-url", requirePermission("content:manage"), async (_req: Request, res: Response) => {
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const rawPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    const objectPath = rawPath.startsWith("/objects/") ? `/storage${rawPath}` : rawPath;
    res.json({ uploadURL, objectPath });
  } catch (error) {
    console.error("[Admin] Error generating logo upload URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

export default router;
