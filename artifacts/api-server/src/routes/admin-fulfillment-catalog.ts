import { Router, type Request, type Response } from "express";
import {
  db,
  machineProductKeyMappingsTable,
  machineUnknownProductKeysTable,
  productsTable,
} from "@workspace/db";
import { asc, desc, isNull } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";

// ─── Admin Fulfillment Map: read-aggregation ─────────────────────────────────
// Backs the admin "Fulfillment Map" page. This route is READ-ONLY aggregation:
// it pulls The Machine's LIVE offer catalog (server-to-server) and joins it with
// the local mapping/product/unknown-key tables so the page can render one card
// per front-end offer. All writes (create/override a mapping) are delegated to
// the existing CRUD at /admin/integrations/machine-product-key-mappings in
// admin-panel.ts — this file never mutates anything.
//
// Machine catalog fetch uses two env vars (the Machine side calls its token
// OFFER_CATALOG_API_TOKEN; on the BTS side we read it from MACHINE_CATALOG_TOKEN):
//   - MACHINE_CATALOG_URL   full URL of the Machine /api/integrations/offer-catalog
//   - MACHINE_CATALOG_TOKEN bearer token sent as `Authorization: Bearer <token>`
// When either is missing or the catalog is unreachable we degrade gracefully:
// catalog=null + catalogAvailable=false + a human-readable catalogError, so the
// page still loads the mappings/products/unknown-keys and stays editable.

const router = Router();

const CATALOG_FETCH_TIMEOUT_MS = 8000;

async function fetchMachineCatalog(): Promise<{
  catalog: unknown | null;
  error: string | null;
}> {
  const url = process.env.MACHINE_CATALOG_URL;
  const token = process.env.MACHINE_CATALOG_TOKEN;
  if (!url || !token) {
    return {
      catalog: null,
      error:
        "MACHINE_CATALOG_URL and MACHINE_CATALOG_TOKEN are not configured — live offer catalog unavailable.",
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        catalog: null,
        error: `Machine offer catalog responded with HTTP ${res.status}.`,
      };
    }
    const catalog = (await res.json()) as unknown;
    return { catalog, error: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Machine offer catalog request timed out."
          : err.message
        : "Machine offer catalog request failed.";
    return { catalog: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

router.get(
  "/admin/fulfillment/catalog",
  requirePermission("members:view"),
  async (_req: Request, res: Response) => {
    try {
      const [catalogResult, mappingRows, productRows, unknownRows] =
        await Promise.all([
          fetchMachineCatalog(),
          db
            .select({
              id: machineProductKeyMappingsTable.id,
              machineKey: machineProductKeyMappingsTable.machineKey,
              portalSlug: machineProductKeyMappingsTable.portalSlug,
              notes: machineProductKeyMappingsTable.notes,
              createdAt: machineProductKeyMappingsTable.createdAt,
              updatedAt: machineProductKeyMappingsTable.updatedAt,
              updatedBy: machineProductKeyMappingsTable.updatedBy,
            })
            .from(machineProductKeyMappingsTable)
            .orderBy(asc(machineProductKeyMappingsTable.machineKey)),
          db
            .select({
              id: productsTable.id,
              slug: productsTable.slug,
              name: productsTable.name,
              entitlementKeys: productsTable.entitlementKeys,
            })
            .from(productsTable)
            .orderBy(asc(productsTable.name)),
          db
            .select()
            .from(machineUnknownProductKeysTable)
            .where(isNull(machineUnknownProductKeysTable.dismissedAt))
            .orderBy(desc(machineUnknownProductKeysTable.lastSeenAt))
            .limit(200),
        ]);

      // Only surface products that actually grant something. A mapping pointing
      // at a product with an empty entitlement set is a footgun (the buyer gets
      // nothing), so we keep those out of the dropdown and let the page flag any
      // existing mapping that lands on one.
      const products = productRows
        .filter(
          (p) =>
            Array.isArray(p.entitlementKeys) && p.entitlementKeys.length > 0,
        )
        .map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          entitlementKeys: p.entitlementKeys as string[],
        }));

      res.json({
        catalog: catalogResult.catalog,
        catalogAvailable: catalogResult.catalog !== null,
        catalogError: catalogResult.error,
        mappings: mappingRows,
        products,
        unknownKeys: unknownRows,
      });
    } catch (error) {
      console.error("[Admin] Fulfillment catalog error:", error);
      res.status(500).json({ error: "Failed to load fulfillment catalog" });
    }
  },
);

export default router;
