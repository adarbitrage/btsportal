import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Lock,
  RefreshCw,
  Loader2,
  Save,
  ChevronsUp,
  Info,
} from "lucide-react";
import {
  adminPanelApi,
  type ContentAccessCatalogResponse,
  type ContentAccessProduct,
} from "@/lib/admin-panel-api";
import {
  MAPPABLE_PRODUCTS,
  MENTORSHIP_LADDER_ORDER,
} from "@workspace/content-access-registry";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

// ── Copy-upward logic ─────────────────────────────────────────────────────────

/**
 * For the mentorship columns only: once any ladder level is checked, all levels
 * above it also get checked. Front-end slugs pass through unchanged.
 *
 * Example: if 3month (2) and lifetime (5) are checked:
 *   - 3month triggers propagation → 6month (3) and 1year (4) get added
 *   - lifetime is already at the top → no further additions
 * Result: 3month, 6month, 1year, lifetime all checked.
 */
function applyLadderPropagation(checkedSlugs: Set<string>): Set<string> {
  const result = new Set(checkedSlugs);
  let propagate = false;
  for (const slug of MENTORSHIP_LADDER_ORDER) {
    if (result.has(slug)) propagate = true;
    if (propagate) result.add(slug);
  }
  return result;
}

// ── Short display labels for the narrow column headers ────────────────────────

const COLUMN_SHORT_LABELS: Record<string, string> = {
  yse_front_end: "YSE",
  backroad: "Backroad",
  offmarket: "Off-Market",
  reserve_income: "Reserve Inc.",
  silent_partner: "Silent Partner",
  test_like_mad: "Test Like Mad",
  launchpad: "Launchpad",
  "3month": "3-Month",
  "6month": "6-Month",
  "1year": "1-Year",
  lifetime: "Lifetime",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDraftFromMappings(
  pages: ContentAccessCatalogResponse["pages"],
  mappings: ContentAccessCatalogResponse["mappings"],
): Map<string, Set<string>> {
  const byKey = new Map<string, string[]>();
  for (const m of mappings) byKey.set(m.pageKey, m.productSlugs);

  const draft = new Map<string, Set<string>>();
  for (const page of pages) {
    draft.set(page.pageKey, new Set(byKey.get(page.pageKey) ?? []));
  }
  return draft;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ContentAccessMap() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = hasPermission(user?.role, "members:edit");

  const [catalog, setCatalog] =
    useState<ContentAccessCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Draft checkbox state — the source of truth for the matrix UI.
  const [rowDraft, setRowDraft] = useState<Map<string, Set<string>>>(new Map());
  // Which rows have been modified since last load/save.
  const [dirtyRows, setDirtyRows] = useState<Set<string>>(new Set());
  // The row currently being saved.
  const [savingRow, setSavingRow] = useState<string | null>(null);
  // When saving an empty row we ask for confirmation first.
  const [pendingClearRow, setPendingClearRow] = useState<string | null>(null);
  // True while "Apply copy-upward to all rows" is running.
  const [applyingAll, setApplyingAll] = useState(false);

  // Track whether we're mid-load to avoid stale setState calls.
  const loadCountRef = useRef(0);

  const load = useCallback(async () => {
    const thisLoad = ++loadCountRef.current;
    try {
      setLoading(true);
      setError(null);
      const res = await adminPanelApi.getContentAccessCatalog();
      if (thisLoad !== loadCountRef.current) return; // stale
      setCatalog(res);
      setRowDraft(buildDraftFromMappings(res.pages, res.mappings));
      setDirtyRows(new Set());
    } catch (err) {
      if (thisLoad !== loadCountRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load content access map",
      );
    } finally {
      if (thisLoad === loadCountRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Product name lookup from the catalog (falls back to short label) ─────────

  const productNameBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of catalog?.products ?? []) m.set(p.slug, p.name);
    return m;
  }, [catalog]);

  const colLabel = (slug: string) =>
    productNameBySlug.get(slug) ?? COLUMN_SHORT_LABELS[slug] ?? slug;

  // ── Checkbox toggle ───────────────────────────────────────────────────────────

  const toggleCell = (pageKey: string, slug: string) => {
    setRowDraft((prev) => {
      const next = new Map(prev);
      const set = new Set(prev.get(pageKey) ?? []);
      if (set.has(slug)) set.delete(slug);
      else set.add(slug);
      next.set(pageKey, set);
      return next;
    });
    setDirtyRows((prev) => new Set([...prev, pageKey]));
  };

  // ── Save a single row ─────────────────────────────────────────────────────────

  const saveRow = useCallback(
    async (pageKey: string, confirmed = false) => {
      const slugs = rowDraft.get(pageKey) ?? new Set<string>();
      const productSlugs = [...slugs];

      if (productSlugs.length === 0 && !confirmed) {
        setPendingClearRow(pageKey);
        return;
      }

      setSavingRow(pageKey);
      try {
        await adminPanelApi.upsertContentAccessMapping({ pageKey, productSlugs });
        // Only mark THIS row as clean — do NOT call load(), which would reset
        // rowDraft for the entire matrix and discard unsaved edits on other rows.
        setDirtyRows((prev) => {
          const next = new Set(prev);
          next.delete(pageKey);
          return next;
        });
        toast({
          title: productSlugs.length === 0 ? "Page set to open" : "Mapping saved",
          description:
            productSlugs.length === 0
              ? `"${pageKey}" is now open to all members.`
              : `"${pageKey}" updated with ${productSlugs.length} product(s).`,
        });
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Save failed",
          description:
            err instanceof Error ? err.message : "Unknown error saving mapping",
        });
      } finally {
        setSavingRow(null);
        setPendingClearRow(null);
      }
    },
    [rowDraft, toast],
  );

  const confirmClearRow = () => {
    if (pendingClearRow) void saveRow(pendingClearRow, true);
  };

  // ── Copy-upward — single row ──────────────────────────────────────────────────

  const copyUpwardRow = (pageKey: string) => {
    setRowDraft((prev) => {
      const next = new Map(prev);
      const propagated = applyLadderPropagation(prev.get(pageKey) ?? new Set());
      next.set(pageKey, propagated);
      return next;
    });
    setDirtyRows((prev) => new Set([...prev, pageKey]));
  };

  // ── Copy-upward — all rows ────────────────────────────────────────────────────

  const copyUpwardAll = () => {
    setApplyingAll(true);
    setRowDraft((prev) => {
      const next = new Map(prev);
      for (const [pageKey, slugs] of prev.entries()) {
        next.set(pageKey, applyLadderPropagation(slugs));
      }
      return next;
    });
    // Mark all rows dirty (the user still needs to save explicitly).
    if (catalog) {
      setDirtyRows(new Set(catalog.pages.map((p) => p.pageKey)));
    }
    setApplyingAll(false);
    toast({
      title: "Copy-upward applied to all rows",
      description:
        "Mentorship checks have been propagated up the ladder. Review and save each row.",
    });
  };

  // ── Derived: product columns ordered strictly from registry constants ─────────
  //
  // MAPPABLE_PRODUCTS is the single source of truth for column order and
  // grouping. The catalog response is used only to resolve human-readable names.
  // This guarantees ordering is registry-driven even if the server returns rows
  // in a different order.

  const frontendProducts: ContentAccessProduct[] = useMemo(
    () =>
      MAPPABLE_PRODUCTS.filter((p) => p.group === "frontend").map((p) => ({
        slug: p.slug,
        group: p.group as "frontend",
        ladderOrder: null,
        name: productNameBySlug.get(p.slug) ?? COLUMN_SHORT_LABELS[p.slug] ?? p.slug,
      })),
    [productNameBySlug],
  );

  const mentorshipProducts: ContentAccessProduct[] = useMemo(
    () =>
      MAPPABLE_PRODUCTS.filter((p) => p.group === "mentorship")
        .sort((a, b) => (a.ladderOrder ?? 0) - (b.ladderOrder ?? 0))
        .map((p) => ({
          slug: p.slug,
          group: p.group as "mentorship",
          ladderOrder: p.ladderOrder ?? null,
          name:
            productNameBySlug.get(p.slug) ??
            COLUMN_SHORT_LABELS[p.slug] ??
            p.slug,
        })),
    [productNameBySlug],
  );

  // Ordered list of all product columns for the matrix.
  const allProducts: ContentAccessProduct[] = useMemo(
    () => [...frontendProducts, ...mentorshipProducts],
    [frontendProducts, mentorshipProducts],
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  const pages = catalog?.pages ?? [];
  const isBusy = (pageKey: string) =>
    savingRow === pageKey || loading;

  return (
    <AdminLayout>
      <TooltipProvider>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold">
                <Lock className="h-6 w-6" />
                Content Access Map
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Check which products a member must own to access each page.
                Leaving all boxes unchecked keeps the page{" "}
                <strong>open</strong> — any member can see it.
              </p>
            </div>
            <div className="flex gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyUpwardAll}
                    disabled={!canEdit || loading || applyingAll || !catalog}
                    data-testid="button-copy-upward-all"
                  >
                    <ChevronsUp className="mr-1.5 h-4 w-4" />
                    Copy-upward all rows
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  Propagates mentorship checks upward across every row in the
                  matrix. Front-end columns are never touched. You still need to
                  save each row.
                </TooltipContent>
              </Tooltip>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void load()}
                disabled={loading}
                data-testid="button-refresh"
              >
                <RefreshCw
                  className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </div>

          {!canEdit && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4 shrink-0" />
              View-only — editing requires the members:edit permission.
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading content access map…
            </div>
          )}

          {!loading && error && (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              data-testid="error-banner"
            >
              {error}
            </div>
          )}

          {!loading && !error && catalog && (
            <Card>
              <CardContent className="p-0">
                {/* Horizontally-scrollable matrix */}
                <div className="overflow-x-auto">
                  <table
                    className="w-full text-sm"
                    data-testid="content-access-matrix"
                  >
                    <thead>
                      {/* Group header row */}
                      <tr className="border-b border-border bg-muted/60">
                        <th
                          className="sticky left-0 z-10 min-w-[200px] bg-muted/60 px-4 py-2 text-left font-semibold text-muted-foreground"
                          rowSpan={2}
                        >
                          Page
                        </th>
                        {frontendProducts.length > 0 && (
                          <th
                            colSpan={frontendProducts.length}
                            className="border-l border-border px-2 py-2 text-center font-semibold text-muted-foreground"
                          >
                            Front-ends
                          </th>
                        )}
                        {mentorshipProducts.length > 0 && (
                          <th
                            colSpan={mentorshipProducts.length}
                            className="border-l border-border px-2 py-2 text-center font-semibold text-muted-foreground"
                          >
                            Mentorship Ladder
                          </th>
                        )}
                        <th
                          className="border-l border-border px-2 py-2 text-center font-semibold text-muted-foreground"
                          colSpan={2}
                        >
                          Actions
                        </th>
                      </tr>
                      {/* Product sub-header row */}
                      <tr className="border-b border-border bg-muted/40">
                        {allProducts.map((p, i) => (
                          <th
                            key={p.slug}
                            className={`px-2 py-1.5 text-center text-xs font-medium text-muted-foreground${i === frontendProducts.length ? " border-l border-border" : ""}`}
                          >
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-default whitespace-nowrap">
                                  {COLUMN_SHORT_LABELS[p.slug] ?? colLabel(p.slug)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                {colLabel(p.slug)}
                                <br />
                                <code className="text-[10px] text-muted-foreground">
                                  {p.slug}
                                </code>
                              </TooltipContent>
                            </Tooltip>
                          </th>
                        ))}
                        {/* Save column */}
                        <th className="border-l border-border px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
                          Save
                        </th>
                        {/* Copy-upward column */}
                        <th className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
                          Copy↑
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {pages.map((page, rowIdx) => {
                        const draft = rowDraft.get(page.pageKey) ?? new Set<string>();
                        const isDirty = dirtyRows.has(page.pageKey);
                        const isSaving = savingRow === page.pageKey;
                        const isOpen = draft.size === 0;

                        return (
                          <tr
                            key={page.pageKey}
                            className={`border-b border-border last:border-0 ${rowIdx % 2 === 0 ? "" : "bg-muted/20"} ${isDirty ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}
                            data-testid={`row-${page.pageKey}`}
                          >
                            {/* Page label (sticky) */}
                            <td
                              className={`sticky left-0 z-10 min-w-[200px] px-4 py-2.5 ${rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20"} ${isDirty ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}
                            >
                              <div className="font-medium leading-tight">
                                {page.label}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5">
                                <code className="text-[10px] text-muted-foreground">
                                  {page.routePath}
                                </code>
                                {isOpen && !isDirty && (
                                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                    open
                                  </span>
                                )}
                                {isDirty && (
                                  <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                    unsaved
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Product checkboxes */}
                            {allProducts.map((p, colIdx) => (
                              <td
                                key={p.slug}
                                className={`px-2 py-2.5 text-center${colIdx === frontendProducts.length ? " border-l border-border" : ""}`}
                              >
                                <Checkbox
                                  checked={draft.has(p.slug)}
                                  onCheckedChange={() =>
                                    toggleCell(page.pageKey, p.slug)
                                  }
                                  disabled={!canEdit || isSaving}
                                  aria-label={`${page.label} — ${colLabel(p.slug)}`}
                                  data-testid={`cell-${page.pageKey}-${p.slug}`}
                                />
                              </td>
                            ))}

                            {/* Save button */}
                            <td className="border-l border-border px-2 py-2 text-center">
                              <Button
                                size="sm"
                                variant={isDirty ? "default" : "ghost"}
                                className="h-7 px-2"
                                onClick={() => void saveRow(page.pageKey)}
                                disabled={!canEdit || !isDirty || isSaving}
                                data-testid={`save-${page.pageKey}`}
                              >
                                {isSaving ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Save className="h-3.5 w-3.5" />
                                )}
                                <span className="sr-only">Save {page.label}</span>
                              </Button>
                            </td>

                            {/* Copy-upward button */}
                            <td className="px-2 py-2 text-center">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2"
                                    onClick={() => copyUpwardRow(page.pageKey)}
                                    disabled={!canEdit || isSaving}
                                    data-testid={`copy-upward-${page.pageKey}`}
                                  >
                                    <ChevronsUp className="h-3.5 w-3.5" />
                                    <span className="sr-only">
                                      Copy-upward {page.label}
                                    </span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="left"
                                  className="max-w-xs text-xs"
                                >
                                  Propagate mentorship checks upward for this row.
                                  Front-end columns are untouched. Then save to
                                  commit.
                                </TooltipContent>
                              </Tooltip>
                            </td>
                          </tr>
                        );
                      })}

                      {pages.length === 0 && (
                        <tr>
                          <td
                            colSpan={allProducts.length + 3}
                            className="px-4 py-8 text-center text-sm text-muted-foreground"
                          >
                            No gateable pages are registered yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Legend */}
          {!loading && !error && catalog && (
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full bg-emerald-200 dark:bg-emerald-900" />
                <strong>open</strong> — all members can access this page
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full bg-amber-200 dark:bg-amber-900" />
                <strong>unsaved</strong> — changes pending, click Save to commit
              </span>
              <span className="flex items-center gap-1.5">
                <ChevronsUp className="h-3 w-3" />
                <strong>Copy↑</strong> — propagate mentorship checks upward for
                this row (front-ends untouched)
              </span>
            </div>
          )}
        </div>
      </TooltipProvider>

      {/* Confirm: clearing all slugs reverts page to OPEN */}
      <AlertDialog
        open={!!pendingClearRow}
        onOpenChange={(open) => {
          if (!open && savingRow === null) setPendingClearRow(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert page to open?</AlertDialogTitle>
            <AlertDialogDescription>
              You are removing all product requirements from{" "}
              <strong>
                {catalog?.pages.find((p) => p.pageKey === pendingClearRow)
                  ?.label ?? pendingClearRow}
              </strong>
              . This will make the page{" "}
              <strong>open to all members</strong> — no product is required to
              access it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingClearRow(null)}>
              Keep restrictions
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmClearRow}
              disabled={savingRow !== null}
            >
              {savingRow !== null ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Yes, revert to open
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
