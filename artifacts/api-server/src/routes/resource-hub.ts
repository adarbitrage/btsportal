import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  resourceHubItemsTable,
  resourceHubGlossaryTable,
  creativeDriveFilesTable,
  type ResourceHubItem,
} from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { getAccessiblePageKeys } from "../lib/content-access-resolver";
import { logAdminAction } from "../lib/audit-log";
import { generateGlossaryDefinitions } from "../lib/resource-hub-glossary";

const router: IRouter = Router();

const PAGE_KEY = "resource-hub";
const SECTIONS = ["foundations", "working_documents", "templates_assets"] as const;
const KINDS = ["file", "external", "group"] as const;
const GLOSSARY_STATUSES = ["draft", "approved", "rejected"] as const;

function parseId(raw: string | string[]): number | null {
  const n = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

type HubItemOut = {
  id: number;
  section: string;
  kind: string;
  fileId: number | null;
  fileName: string | null;
  externalUrl: string | null;
  parentId: number | null;
  subGroupLabel: string | null;
  displayTitle: string;
  blurb: string;
  noteLine: string | null;
  sortOrder: number;
  children?: HubItemOut[];
};

function toOut(row: ResourceHubItem, fileName: string | null): HubItemOut {
  return {
    id: row.id,
    section: row.section,
    kind: row.kind,
    fileId: row.fileId,
    fileName,
    externalUrl: row.externalUrl,
    parentId: row.parentId,
    subGroupLabel: row.subGroupLabel,
    displayTitle: row.displayTitle,
    blurb: row.blurb,
    noteLine: row.noteLine,
    sortOrder: row.sortOrder,
  };
}

/** Loads all curation items joined with file names, nested groups, ordered. */
async function loadHubTree(): Promise<HubItemOut[]> {
  const rows = await db
    .select({
      item: resourceHubItemsTable,
      fileName: creativeDriveFilesTable.name,
    })
    .from(resourceHubItemsTable)
    .leftJoin(
      creativeDriveFilesTable,
      eq(resourceHubItemsTable.fileId, creativeDriveFilesTable.id),
    )
    .orderBy(asc(resourceHubItemsTable.sortOrder), asc(resourceHubItemsTable.id));

  const byId = new Map<number, HubItemOut>();
  const roots: HubItemOut[] = [];
  for (const { item, fileName } of rows) {
    byId.set(item.id, toOut(item, fileName));
  }
  for (const { item } of rows) {
    const out = byId.get(item.id)!;
    if (item.parentId && byId.has(item.parentId)) {
      const parent = byId.get(item.parentId)!;
      parent.children = parent.children ?? [];
      parent.children.push(out);
    } else {
      roots.push(out);
    }
  }
  // Children ordered by sub-group label then sort order (spec).
  for (const root of byId.values()) {
    root.children?.sort(
      (a, b) =>
        (a.subGroupLabel ?? "").localeCompare(b.subGroupLabel ?? "") ||
        a.sortOrder - b.sortOrder ||
        a.id - b.id,
    );
  }
  return roots;
}

/**
 * GET /api/resource-hub
 * Member payload: curated items grouped by section + approved glossary terms.
 * Gated on the `resource-hub` content-access page key (admin/coach bypass
 * inside getAccessiblePageKeys).
 */
router.get("/resource-hub", authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const keys = await getAccessiblePageKeys(req.userId);
    if (!keys.includes(PAGE_KEY)) {
      res.status(403).json({ error: "You don't have access to the Resource Hub" });
      return;
    }

    const roots = await loadHubTree();
    const sections: Record<string, HubItemOut[]> = {
      foundations: [],
      working_documents: [],
      templates_assets: [],
    };
    for (const root of roots) {
      // A file item whose drive file was deleted has nothing to serve — hide it.
      if (root.kind === "file" && root.fileId === null) continue;
      if (sections[root.section]) sections[root.section].push(root);
    }

    const glossary = await db
      .select({
        term: resourceHubGlossaryTable.term,
        definition: resourceHubGlossaryTable.definition,
      })
      .from(resourceHubGlossaryTable)
      .where(eq(resourceHubGlossaryTable.status, "approved"))
      .orderBy(asc(resourceHubGlossaryTable.term));

    res.json({ sections, glossary });
  } catch (error) {
    console.error("[ResourceHub] load error:", error);
    res.status(500).json({ error: "Failed to load the Resource Hub" });
  }
});

// ── Admin: curation CRUD ─────────────────────────────────────────────────────

router.get(
  "/admin/resource-hub/items",
  authenticate,
  requirePermission("content:manage"),
  async (_req: Request, res: Response) => {
    try {
      res.json({ items: await loadHubTree() });
    } catch (error) {
      console.error("[ResourceHub] admin items error:", error);
      res.status(500).json({ error: "Failed to load curation items" });
    }
  },
);

type ItemBody = {
  section?: unknown;
  kind?: unknown;
  fileId?: unknown;
  externalUrl?: unknown;
  parentId?: unknown;
  subGroupLabel?: unknown;
  displayTitle?: unknown;
  blurb?: unknown;
  noteLine?: unknown;
  sortOrder?: unknown;
};

function nullableStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function nullableId(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

router.post(
  "/admin/resource-hub/items",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const b = req.body as ItemBody;
      const section = String(b.section ?? "");
      const kind = String(b.kind ?? "");
      const displayTitle = typeof b.displayTitle === "string" ? b.displayTitle.trim() : "";
      if (!(SECTIONS as readonly string[]).includes(section)) {
        res.status(400).json({ error: "Invalid section" });
        return;
      }
      if (!(KINDS as readonly string[]).includes(kind)) {
        res.status(400).json({ error: "Invalid kind" });
        return;
      }
      if (!displayTitle) {
        res.status(400).json({ error: "Display title is required" });
        return;
      }
      const fileId = kind === "file" ? nullableId(b.fileId) : null;
      const externalUrl = kind === "external" ? nullableStr(b.externalUrl) : null;
      if (kind === "file" && !fileId) {
        res.status(400).json({ error: "A file item needs a drive file" });
        return;
      }
      if (kind === "external" && !externalUrl) {
        res.status(400).json({ error: "An external item needs a URL" });
        return;
      }

      const parentId = nullableId(b.parentId);
      if (parentId) {
        const [parent] = await db
          .select({ kind: resourceHubItemsTable.kind })
          .from(resourceHubItemsTable)
          .where(eq(resourceHubItemsTable.id, parentId))
          .limit(1);
        if (!parent || parent.kind !== "group") {
          res.status(400).json({ error: "Parent must be an existing group" });
          return;
        }
      }

      const [created] = await db
        .insert(resourceHubItemsTable)
        .values({
          slug: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          section,
          kind,
          fileId,
          externalUrl,
          parentId,
          subGroupLabel: nullableStr(b.subGroupLabel),
          displayTitle,
          blurb: typeof b.blurb === "string" ? b.blurb.trim() : "",
          noteLine: nullableStr(b.noteLine),
          sortOrder: Number.isInteger(b.sortOrder) ? (b.sortOrder as number) : 0,
        })
        .returning();
      await logAdminAction(req, "resource_hub_item_create", "resource_hub_item", String(created.id),
        `Created Resource Hub item "${displayTitle}" (${kind}, ${section})`);
      res.status(201).json({ item: created });
    } catch (error) {
      console.error("[ResourceHub] item create error:", error);
      res.status(500).json({ error: "Failed to create item" });
    }
  },
);

router.patch(
  "/admin/resource-hub/items/:id",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid item id" });
        return;
      }
      const [existing] = await db
        .select()
        .from(resourceHubItemsTable)
        .where(eq(resourceHubItemsTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      const b = req.body as ItemBody;
      const updates: Partial<typeof resourceHubItemsTable.$inferInsert> = {};
      if (b.section !== undefined) {
        if (!(SECTIONS as readonly string[]).includes(String(b.section))) {
          res.status(400).json({ error: "Invalid section" });
          return;
        }
        updates.section = String(b.section);
      }
      if (b.displayTitle !== undefined) {
        const t = typeof b.displayTitle === "string" ? b.displayTitle.trim() : "";
        if (!t) {
          res.status(400).json({ error: "Display title is required" });
          return;
        }
        updates.displayTitle = t;
      }
      if (b.blurb !== undefined) updates.blurb = typeof b.blurb === "string" ? b.blurb.trim() : "";
      if (b.noteLine !== undefined) updates.noteLine = nullableStr(b.noteLine);
      if (b.subGroupLabel !== undefined) updates.subGroupLabel = nullableStr(b.subGroupLabel);
      if (b.sortOrder !== undefined && Number.isInteger(b.sortOrder)) {
        updates.sortOrder = b.sortOrder as number;
      }
      if (b.fileId !== undefined && existing.kind === "file") {
        const fid = nullableId(b.fileId);
        if (!fid) {
          res.status(400).json({ error: "A file item needs a drive file" });
          return;
        }
        updates.fileId = fid;
      }
      if (b.externalUrl !== undefined && existing.kind === "external") {
        const url = nullableStr(b.externalUrl);
        if (!url) {
          res.status(400).json({ error: "An external item needs a URL" });
          return;
        }
        updates.externalUrl = url;
      }
      if (b.parentId !== undefined) {
        const pid = b.parentId === null ? null : nullableId(b.parentId);
        if (pid !== null) {
          if (pid === id) {
            res.status(400).json({ error: "An item cannot be its own parent" });
            return;
          }
          const [parent] = await db
            .select({ kind: resourceHubItemsTable.kind })
            .from(resourceHubItemsTable)
            .where(eq(resourceHubItemsTable.id, pid))
            .limit(1);
          if (!parent || parent.kind !== "group") {
            res.status(400).json({ error: "Parent must be an existing group" });
            return;
          }
        }
        updates.parentId = pid;
      }

      const [updated] = await db
        .update(resourceHubItemsTable)
        .set(updates)
        .where(eq(resourceHubItemsTable.id, id))
        .returning();
      await logAdminAction(req, "resource_hub_item_update", "resource_hub_item", String(id),
        `Updated Resource Hub item "${updated.displayTitle}"`, updates);
      res.json({ item: updated });
    } catch (error) {
      console.error("[ResourceHub] item update error:", error);
      res.status(500).json({ error: "Failed to update item" });
    }
  },
);

router.delete(
  "/admin/resource-hub/items/:id",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid item id" });
        return;
      }
      const deleted = await db
        .delete(resourceHubItemsTable)
        .where(eq(resourceHubItemsTable.id, id))
        .returning({ id: resourceHubItemsTable.id, displayTitle: resourceHubItemsTable.displayTitle });
      if (deleted.length === 0) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      await logAdminAction(req, "resource_hub_item_delete", "resource_hub_item", String(id),
        `Removed Resource Hub item "${deleted[0].displayTitle}"`);
      res.json({ ok: true });
    } catch (error) {
      console.error("[ResourceHub] item delete error:", error);
      res.status(500).json({ error: "Failed to delete item" });
    }
  },
);

// ── Admin: glossary review ───────────────────────────────────────────────────

router.get(
  "/admin/resource-hub/glossary",
  authenticate,
  requirePermission("content:manage"),
  async (_req: Request, res: Response) => {
    try {
      const terms = await db
        .select()
        .from(resourceHubGlossaryTable)
        .orderBy(asc(resourceHubGlossaryTable.term));
      res.json({ terms });
    } catch (error) {
      console.error("[ResourceHub] glossary list error:", error);
      res.status(500).json({ error: "Failed to load glossary" });
    }
  },
);

router.post(
  "/admin/resource-hub/glossary",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const term = typeof req.body?.term === "string" ? req.body.term.trim() : "";
      if (!term || term.length > 120) {
        res.status(400).json({ error: "A term (max 120 chars) is required" });
        return;
      }
      const definition = typeof req.body?.definition === "string" ? req.body.definition.trim() : "";
      const [created] = await db
        .insert(resourceHubGlossaryTable)
        .values({ term, definition })
        .onConflictDoNothing({ target: resourceHubGlossaryTable.term })
        .returning();
      if (!created) {
        res.status(409).json({ error: "That term already exists" });
        return;
      }
      await logAdminAction(req, "resource_hub_glossary_add", "resource_hub_glossary", String(created.id),
        `Added glossary term "${term}"`);
      res.status(201).json({ term: created });
    } catch (error) {
      console.error("[ResourceHub] glossary add error:", error);
      res.status(500).json({ error: "Failed to add term" });
    }
  },
);

router.patch(
  "/admin/resource-hub/glossary/:id",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid term id" });
        return;
      }
      const updates: Partial<typeof resourceHubGlossaryTable.$inferInsert> = {};
      if (req.body?.definition !== undefined) {
        updates.definition = typeof req.body.definition === "string" ? req.body.definition.trim() : "";
      }
      if (req.body?.status !== undefined) {
        const status = String(req.body.status);
        if (!(GLOSSARY_STATUSES as readonly string[]).includes(status)) {
          res.status(400).json({ error: "Invalid status" });
          return;
        }
        updates.status = status;
      }
      // Approving an empty definition would publish a blank entry.
      const [existing] = await db
        .select()
        .from(resourceHubGlossaryTable)
        .where(eq(resourceHubGlossaryTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Term not found" });
        return;
      }
      const finalDefinition = updates.definition ?? existing.definition;
      if (updates.status === "approved" && !finalDefinition.trim()) {
        res.status(400).json({ error: "Cannot approve a term without a definition" });
        return;
      }
      const [updated] = await db
        .update(resourceHubGlossaryTable)
        .set(updates)
        .where(eq(resourceHubGlossaryTable.id, id))
        .returning();
      await logAdminAction(req, "resource_hub_glossary_update", "resource_hub_glossary", String(id),
        `Updated glossary term "${existing.term}"`, updates);
      res.json({ term: updated });
    } catch (error) {
      console.error("[ResourceHub] glossary update error:", error);
      res.status(500).json({ error: "Failed to update term" });
    }
  },
);

router.delete(
  "/admin/resource-hub/glossary/:id",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid term id" });
        return;
      }
      const deleted = await db
        .delete(resourceHubGlossaryTable)
        .where(eq(resourceHubGlossaryTable.id, id))
        .returning({ term: resourceHubGlossaryTable.term });
      if (deleted.length === 0) {
        res.status(404).json({ error: "Term not found" });
        return;
      }
      await logAdminAction(req, "resource_hub_glossary_delete", "resource_hub_glossary", String(id),
        `Deleted glossary term "${deleted[0].term}"`);
      res.json({ ok: true });
    } catch (error) {
      console.error("[ResourceHub] glossary delete error:", error);
      res.status(500).json({ error: "Failed to delete term" });
    }
  },
);

router.post(
  "/admin/resource-hub/glossary/:id/regenerate",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: "Invalid term id" });
        return;
      }
      await generateGlossaryDefinitions({ ids: [id] });
      const [term] = await db
        .select()
        .from(resourceHubGlossaryTable)
        .where(eq(resourceHubGlossaryTable.id, id))
        .limit(1);
      await logAdminAction(req, "resource_hub_glossary_regenerate", "resource_hub_glossary", String(id),
        `Regenerated glossary definition for "${term?.term ?? id}"`);
      res.json({ term });
    } catch (error) {
      console.error("[ResourceHub] glossary regenerate error:", error);
      res.status(500).json({ error: "Failed to regenerate definition" });
    }
  },
);

router.post(
  "/admin/resource-hub/glossary/generate",
  authenticate,
  requirePermission("content:manage"),
  async (req: Request, res: Response) => {
    try {
      const result = await generateGlossaryDefinitions({});
      await logAdminAction(req, "resource_hub_glossary_generate", "resource_hub_glossary", "batch",
        `Drafted ${result.generated} glossary definitions (${result.remaining} remaining)`);
      res.json(result);
    } catch (error) {
      console.error("[ResourceHub] glossary generate error:", error);
      res.status(500).json({ error: "Glossary generation failed — check AI integration configuration" });
    }
  },
);

export default router;
