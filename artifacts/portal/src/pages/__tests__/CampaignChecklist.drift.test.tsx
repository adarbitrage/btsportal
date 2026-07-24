/**
 * Skeleton drift guard for the member campaign checklist surface.
 *
 * The canonical step wording lives ONLY in @workspace/campaign-roadmap.
 * This test proves the checklist page renders its display strings directly
 * from the skeleton module's fields (title / description / substep action):
 *  1. Rendered-DOM check: every module string appears verbatim (up to
 *     whitespace/punctuation normalization) in the rendered page, for BOTH
 *     network branches.
 *  2. Source check: none of the locked step wording is restated literally in
 *     the page source — no per-step override map or re-authored wording.
 *  3. Number-free check: no step numbers or "step N" phrasing anywhere,
 *     including accessible names (aria-labels) and hidden text.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import {
  CAMPAIGN_ROADMAP,
  CAMPAIGN_PHASE_LABELS,
  type CampaignNetwork,
} from "@workspace/campaign-roadmap";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import CampaignChecklist, { phaseDisplayLabel } from "../CampaignChecklist";

/** Normalize for comparison: collapse whitespace, strip punctuation variance. */
function normalize(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[.,;:!?()[\]"'\u2026-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function mockFetch(network: CampaignNetwork | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ network, checkedIds: [] }),
    })),
  );
}

async function renderWithNetwork(network: CampaignNetwork | null) {
  mockFetch(network);
  render(<CampaignChecklist />);
  await waitFor(() =>
    expect(screen.getByTestId(`step-row-${CAMPAIGN_ROADMAP[0].id}`)).toBeInTheDocument(),
  );
}

beforeEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("campaign checklist drift guard — display strings come from the skeleton module", () => {
  for (const network of ["media-mavens", "clickbank"] as const) {
    it(`renders every step title, description, and ${network} substep action verbatim from the module`, async () => {
      await renderWithNetwork(network);
      const pageText = normalize(
        screen.getByTestId("campaign-checklist-page").textContent ?? "",
      );

      for (const step of CAMPAIGN_ROADMAP) {
        const row = screen.getByTestId(`step-row-${step.id}`);
        const rowText = normalize(row.textContent ?? "");

        expect(rowText, `step "${step.id}" title drifted`).toContain(normalize(step.title));
        if (step.description) {
          expect(rowText, `step "${step.id}" description drifted`).toContain(
            normalize(step.description),
          );
        }
        for (const sub of step.substeps) {
          const visible = sub.network === undefined || sub.network === network;
          if (visible) {
            expect(rowText, `substep ${sub.substepId} action drifted`).toContain(
              normalize(sub.action),
            );
          } else {
            // Other-branch substeps must NOT render.
            expect(pageText).not.toContain(normalize(sub.action));
          }
        }
      }

      // Phase headers come from the module (via the number-stripping formatter).
      for (const phase of ["build", "test", "scale"] as const) {
        const label = phaseDisplayLabel(phase);
        expect(label.length).toBeGreaterThan(0);
        expect(label, "display label must be number-free").not.toMatch(/\d/);
        // Formatter output is derived from the shared constant.
        expect(CAMPAIGN_PHASE_LABELS[phase]).toContain(label);
        expect(normalize(screen.getByTestId(`phase-header-${phase}`).textContent ?? "")).toBe(
          normalize(label),
        );
      }
    });
  }

  it("shows only the pre-network steps plus the unlock teaser before a network is chosen", async () => {
    await renderWithNetwork(null);
    for (const step of CAMPAIGN_ROADMAP) {
      const row = screen.queryByTestId(`step-row-${step.id}`);
      if (step.number <= 3) expect(row, `step "${step.id}" should show`).toBeInTheDocument();
      else expect(row, `step "${step.id}" should be hidden`).not.toBeInTheDocument();
    }
    expect(screen.getByTestId("unlock-teaser")).toBeInTheDocument();
    expect(screen.getByTestId("unlock-teaser").textContent).toContain(
      "unlocks once you choose your affiliate network above",
    );
  });

  it("page source restates NO locked step wording (no override map / re-authored copy)", () => {
    const source = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../CampaignChecklist.tsx"),
      "utf8",
    );
    const normalizedSource = normalize(source);
    for (const step of CAMPAIGN_ROADMAP) {
      if (step.title.length > 6) {
        expect(normalizedSource, `step title "${step.title}" hardcoded in page source`).not.toContain(
          normalize(step.title),
        );
      }
      if (step.description) {
        expect(
          normalizedSource,
          `step "${step.id}" description hardcoded in page source`,
        ).not.toContain(normalize(step.description));
      }
      for (const sub of step.substeps) {
        expect(
          normalizedSource,
          `substep ${sub.substepId} action hardcoded in page source`,
        ).not.toContain(normalize(sub.action));
      }
    }
  });
});

describe("campaign checklist number-free rendering", () => {
  it("renders no step numbers, counters, or 'step N' phrasing in visible OR accessible text", async () => {
    await renderWithNetwork("media-mavens");
    const page = screen.getByTestId("campaign-checklist-page");

    const visibleText = page.textContent ?? "";
    expect(visibleText).not.toMatch(/\bstep\s*\d/i);
    expect(visibleText).not.toMatch(/\b17\b/);
    expect(visibleText).not.toMatch(/\bof\s+\d+\s+steps?\b/i);
    expect(visibleText).not.toMatch(/%\s*complete/i);
    expect(visibleText).not.toMatch(/\bphase\s*\d/i);

    // Accessible-name surface: aria-labels, titles, and hidden text.
    for (const el of Array.from(page.querySelectorAll("[aria-label]"))) {
      const label = el.getAttribute("aria-label") ?? "";
      // Locked substep wording may contain digits (e.g. "T2", "5×5"); what is
      // banned is step-number phrasing like "step 3" / "Phase 2".
      expect(label, `aria-label "${label}" contains step-number phrasing`).not.toMatch(
        /\b(step|phase)\s*\d/i,
      );
    }
    for (const el of Array.from(page.querySelectorAll("[title]"))) {
      expect(el.getAttribute("title") ?? "").not.toMatch(/\bstep\s*\d/i);
    }
    // No progress card / per-phase counters remain.
    expect(screen.queryByTestId("overall-progress")).not.toBeInTheDocument();
    expect(screen.queryByTestId("phase-progress-build")).not.toBeInTheDocument();
  });

  it("keeps completed-item styling subtle (line-through) instead of green tinting", async () => {
    mockFetch("media-mavens");
    render(<CampaignChecklist />);
    await waitFor(() =>
      expect(screen.getByTestId("step-checkbox-orient")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("step-checkbox-orient"));
    const row = screen.getByTestId("step-row-orient");
    expect(row.querySelector(".line-through")).not.toBeNull();
    expect(row.className).not.toMatch(/emerald/);
  });
});

describe("campaign checklist 'up next' cue", () => {
  it("marks the first actionable visible unchecked item and recomputes as items are checked", async () => {
    await renderWithNetwork("media-mavens");

    // First unchecked item overall is the first step (single checkbox).
    let badge = screen.getByTestId("up-next");
    expect(screen.getByTestId("step-row-orient").contains(badge)).toBe(true);
    expect(badge.textContent).toMatch(/up next/i);

    // Check it — the cue moves to the next unchecked step.
    fireEvent.click(screen.getByTestId("step-checkbox-orient"));
    badge = screen.getByTestId("up-next");
    expect(screen.getByTestId("step-row-know-the-gates").contains(badge)).toBe(true);
  });

  it("targets the choose-network step once earlier steps are done and no network is chosen", async () => {
    await renderWithNetwork(null);
    fireEvent.click(screen.getByTestId("step-checkbox-orient"));
    fireEvent.click(screen.getByTestId("step-checkbox-know-the-gates"));
    const badge = screen.getByTestId("up-next");
    expect(screen.getByTestId("step-row-choose-network").contains(badge)).toBe(true);
  });

  it("never counts other-branch substeps and falls back to the step header when the target step is collapsed", async () => {
    mockFetch("clickbank");
    render(<CampaignChecklist />);
    await waitFor(() =>
      expect(screen.getByTestId("step-checkbox-orient")).toBeInTheDocument(),
    );

    // Complete everything up to (not including) the LP-assets step, whose
    // first visible substep for ClickBank is the CB branch substep.
    fireEvent.click(screen.getByTestId("step-checkbox-orient"));
    fireEvent.click(screen.getByTestId("step-checkbox-know-the-gates"));
    fireEvent.click(screen.getByTestId("substep-checkbox-select-offer-review-presell"));
    fireEvent.click(screen.getByTestId("step-checkbox-finalize-angles"));
    fireEvent.click(screen.getByTestId("step-checkbox-create-ad-assets"));

    // Cue sits on the CB substep of create-lp-assets (MM substep never counts).
    let badge = screen.getByTestId("up-next");
    const lpRow = screen.getByTestId("step-row-create-lp-assets");
    expect(lpRow.contains(badge)).toBe(true);
    const cbCheckbox = screen.getByTestId("substep-checkbox-create-lp-assets-cb-bridge-copy");
    expect(cbCheckbox.closest("li")?.contains(badge)).toBe(true);

    // Collapse the step — the cue moves to the step header, never disappears.
    fireEvent.click(screen.getByTestId("step-toggle-create-lp-assets"));
    badge = screen.getByTestId("up-next");
    expect(lpRow.contains(badge)).toBe(true);
    expect(badge.closest("li")).toBeNull();
  });
});
