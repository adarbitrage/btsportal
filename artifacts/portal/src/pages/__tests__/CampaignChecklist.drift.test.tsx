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
  memberChecklistItems,
  memberStepDescription,
  memberStepTitle,
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
    it(`renders every step title, description, and ${network} member line verbatim from the module`, async () => {
      await renderWithNetwork(network);
      const pageText = normalize(
        screen.getByTestId("campaign-checklist-page").textContent ?? "",
      );

      for (const step of CAMPAIGN_ROADMAP) {
        const row = screen.getByTestId(`step-row-${step.id}`);
        const rowText = normalize(row.textContent ?? "");

        expect(rowText, `step "${step.id}" title drifted`).toContain(
          normalize(memberStepTitle(step)),
        );
        const description = memberStepDescription(step, network);
        if (description) {
          expect(rowText, `step "${step.id}" description drifted`).toContain(
            normalize(description),
          );
        }
        const items = memberChecklistItems(step, network);
        for (const item of items) {
          expect(rowText, `member line ${item.primaryKey} drifted`).toContain(
            normalize(item.action),
          );
        }
        const renderedActions = new Set(items.map((i) => normalize(i.action)));
        for (const sub of step.substeps) {
          const eligible = sub.network === undefined || sub.network === network;
          const hidden = sub.member?.hidden === true;
          const canonical = normalize(sub.action);
          // Other-branch and member-hidden substeps must NOT render — unless
          // an identical member line legitimately shows the same text.
          if ((!eligible || hidden) && !renderedActions.has(canonical)) {
            expect(pageText, `substep ${sub.substepId} should not render`).not.toContain(
              canonical,
            );
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
        for (const memberAction of [
          sub.member?.action,
          ...Object.values(sub.member?.actionByNetwork ?? {}),
        ]) {
          if (memberAction) {
            expect(
              normalizedSource,
              `substep ${sub.substepId} member copy hardcoded in page source`,
            ).not.toContain(normalize(memberAction));
          }
        }
      }
      for (const memberDesc of [
        step.member?.description,
        ...Object.values(step.member?.descriptionByNetwork ?? {}),
      ]) {
        if (memberDesc) {
          expect(
            normalizedSource,
            `step "${step.id}" member copy hardcoded in page source`,
          ).not.toContain(normalize(memberDesc));
        }
      }
    }
  });
});

describe("network-tailored member copy", () => {
  it("MM: presell/angles say advertorial, LP step is a single checkbox with no MM note, no [network] badge chips", async () => {
    await renderWithNetwork("media-mavens");
    const page = screen.getByTestId("campaign-checklist-page");
    const pageText = normalize(page.textContent ?? "");

    expect(pageText).toContain(normalize("Review the advertorial for the offer."));
    expect(pageText).not.toContain(normalize("Review the VSL for the offer."));
    expect(pageText).not.toContain(
      normalize("Review the presell page for the offer: the advertorial [MM] or the VSL [CB]."),
    );

    // Finalize-angles description: advertorial only, never "advertorial/VSL".
    const anglesText = normalize(
      screen.getByTestId("step-row-finalize-angles").textContent ?? "",
    );
    expect(anglesText).toContain("the advertorial and customer avatar research");
    expect(anglesText).not.toContain("vsl");

    // LP assets: "(both networks)" gone, MM informational substep hidden,
    // step renders one single checkbox keyed by the step.
    const lpRow = screen.getByTestId("step-row-create-lp-assets");
    const lpText = normalize(lpRow.textContent ?? "");
    expect(lpText).toContain(normalize("5 LP headlines + 5 hero shots."));
    expect(lpText).not.toContain("both networks");
    expect(lpText).not.toContain(normalize("Landing-page copy comes from the pre-built advertorial"));
    expect(screen.getByTestId("step-checkbox-create-lp-assets")).toBeInTheDocument();
    expect(
      screen.queryByTestId("substep-checkbox-create-lp-assets-mm-advertorial-copy"),
    ).not.toBeInTheDocument();

    // Network badge chips are gone: "Media Mavens" appears only in the
    // choose-network step (radio labels + confirmation), nowhere else.
    for (const step of CAMPAIGN_ROADMAP) {
      if (step.id === "choose-network") continue;
      const rowText = normalize(screen.getByTestId(`step-row-${step.id}`).textContent ?? "");
      expect(rowText, `badge chip leaked into step "${step.id}"`).not.toContain("media mavens");
      expect(rowText, `badge chip leaked into step "${step.id}"`).not.toContain("clickbank");
    }

    // Choose-network confirms the selection.
    const chooseText = normalize(
      screen.getByTestId("step-row-choose-network").textContent ?? "",
    );
    expect(chooseText).toContain(
      normalize("You've selected Media Mavens — the steps below are tailored to it."),
    );
  });

  it("CB: presell/angles say VSL, Bridge Page Copy Bot substep still shows, MetricMover page line avoids the MM abbreviation", async () => {
    await renderWithNetwork("clickbank");
    const page = screen.getByTestId("campaign-checklist-page");
    const pageText = normalize(page.textContent ?? "");

    expect(pageText).toContain(normalize("Review the VSL for the offer."));
    expect(pageText).not.toContain(normalize("Review the advertorial for the offer."));
    const anglesText = normalize(
      screen.getByTestId("step-row-finalize-angles").textContent ?? "",
    );
    expect(anglesText).toContain("the vsl and customer avatar research");
    expect(anglesText).not.toContain("advertorial");

    expect(
      screen.getByTestId("substep-checkbox-create-lp-assets-cb-bridge-copy"),
    ).toBeInTheDocument();

    expect(pageText).toContain(
      normalize("Create a blank MetricMover page with a custom code box in Flexy."),
    );
    expect(pageText).not.toContain(normalize('Create a blank "MM" page'));

    const chooseText = normalize(
      screen.getByTestId("step-row-choose-network").textContent ?? "",
    );
    expect(chooseText).toContain(
      normalize("You've selected ClickBank — the steps below are tailored to it."),
    );
  });

  it("DIYTrax create + basic-info render as ONE checkbox line; Flexy line carries the clarified wording", async () => {
    await renderWithNetwork("media-mavens");
    const row = screen.getByTestId("step-row-create-diytrax-campaign");
    const rowText = normalize(row.textContent ?? "");

    expect(rowText).toContain(
      normalize("Create the campaign in DIYTrax and fill in the Basic Info tab (and save)."),
    );
    expect(rowText).toContain(
      normalize(
        "One-time global setup: copy the T2 landing-page URL from the Links & Pixels tab in your DIYTrax campaign and paste it into Flexy Custom Values.",
      ),
    );
    // One merged checkbox (keyed by the first canonical id) + the Flexy one.
    expect(
      screen.getByTestId("substep-checkbox-create-diytrax-campaign-create"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("substep-checkbox-create-diytrax-campaign-basic-info"),
    ).not.toBeInTheDocument();
    expect(row.querySelectorAll('[data-testid^="substep-checkbox-"]')).toHaveLength(2);
  });

  it("merged DIYTrax line shows checked when EITHER legacy id was checked, and toggling writes both keys", async () => {
    mockFetch("media-mavens");
    // Legacy member: only the old basic-info id was checked.
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () =>
        init?.method === "PUT"
          ? JSON.parse(String(init.body))
          : { network: "media-mavens", checkedIds: ["create-diytrax-campaign-basic-info"] },
    }));
    render(<CampaignChecklist />);
    await waitFor(() =>
      expect(
        screen.getByTestId("substep-checkbox-create-diytrax-campaign-create"),
      ).toBeInTheDocument(),
    );
    const box = screen.getByTestId("substep-checkbox-create-diytrax-campaign-create");
    expect(box).toHaveAttribute("data-state", "checked");

    // Toggling off clears BOTH canonical keys in the save payload.
    fireEvent.click(box);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const putCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT");
    expect(putCall).toBeDefined();
    const body = JSON.parse(String((putCall![1] as RequestInit).body));
    expect(body.checkedIds).not.toContain("create-diytrax-campaign-create");
    expect(body.checkedIds).not.toContain("create-diytrax-campaign-basic-info");

    // Toggling on writes BOTH keys.
    fireEvent.click(box);
    const putCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === "PUT");
    const lastBody = JSON.parse(String((putCalls[putCalls.length - 1][1] as RequestInit).body));
    expect(lastBody.checkedIds).toContain("create-diytrax-campaign-create");
    expect(lastBody.checkedIds).toContain("create-diytrax-campaign-basic-info");
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
