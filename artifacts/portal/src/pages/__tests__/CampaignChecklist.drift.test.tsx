/**
 * Skeleton drift guard for the member campaign checklist surface.
 *
 * The canonical 17-step wording lives ONLY in @workspace/campaign-roadmap.
 * This test proves the checklist page renders its display strings directly
 * from the skeleton module's fields (title / description / substep action):
 *  1. Rendered-DOM check: every module string appears verbatim (up to
 *     whitespace/punctuation normalization) in the rendered page, for BOTH
 *     network branches.
 *  2. Source check: none of the locked step wording is restated literally in
 *     the page source — no per-step override map or re-authored wording.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
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

import CampaignChecklist from "../CampaignChecklist";

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
    expect(screen.getByTestId(`step-card-${CAMPAIGN_ROADMAP[0].id}`)).toBeInTheDocument(),
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
        const card = screen.getByTestId(`step-card-${step.id}`);
        const cardText = normalize(card.textContent ?? "");

        expect(cardText, `step ${step.number} title drifted`).toContain(normalize(step.title));
        if (step.description) {
          expect(cardText, `step ${step.number} description drifted`).toContain(
            normalize(step.description),
          );
        }
        for (const sub of step.substeps) {
          const visible = sub.network === undefined || sub.network === network;
          if (visible) {
            expect(cardText, `substep ${sub.substepId} action drifted`).toContain(
              normalize(sub.action),
            );
          } else {
            // Other-branch substeps must NOT render.
            expect(pageText).not.toContain(normalize(sub.action));
          }
        }
      }

      // Phase headers come from the module too.
      for (const label of Object.values(CAMPAIGN_PHASE_LABELS)) {
        expect(pageText).toContain(normalize(label));
      }
    });
  }

  it("shows only steps 1-3 plus the unlock teaser before a network is chosen", async () => {
    await renderWithNetwork(null);
    for (const step of CAMPAIGN_ROADMAP) {
      const card = screen.queryByTestId(`step-card-${step.id}`);
      if (step.number <= 3) expect(card, `step ${step.number} should show`).toBeInTheDocument();
      else expect(card, `step ${step.number} should be hidden`).not.toBeInTheDocument();
    }
    expect(screen.getByTestId("unlock-teaser")).toBeInTheDocument();
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
          `step ${step.number} description hardcoded in page source`,
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
