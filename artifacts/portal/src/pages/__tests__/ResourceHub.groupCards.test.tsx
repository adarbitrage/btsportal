import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Task #2039 layout guard: the Resource Hub renders full-width collapsible
// cards stacked vertically —
//   - each Foundations series is a collapsible card, collapsed by default,
//     that expands into its numbered part list with view/download actions;
//   - Campaign Toolkit / Tracking & Templates group cards expand to reveal
//     their children, and EXTERNAL children get a working "Open" link
//     (this is the regression class: the group renderer used to assume all
//     children were drive files and only offered view/download).

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/resource-hub-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resource-hub-api")>(
    "@/lib/resource-hub-api",
  );
  return { ...actual, fetchResourceHub: vi.fn() };
});

import { fetchResourceHub, type HubItem } from "@/lib/resource-hub-api";
import ResourceHub from "@/pages/ResourceHub";

let nextId = 1;
function item(overrides: Partial<HubItem>): HubItem {
  const id = overrides.id ?? nextId++;
  return {
    id,
    slug: `item-${id}`,
    section: "working_documents",
    kind: "file",
    fileId: 1,
    fileName: "f.pdf",
    externalUrl: null,
    parentId: null,
    subGroupLabel: null,
    displayTitle: "Item",
    blurb: "Blurb",
    noteLine: null,
    sortOrder: 0,
    ...overrides,
  };
}

const copywriting = item({
  id: 100,
  section: "foundations",
  kind: "group",
  displayTitle: "Copywriting Foundations",
  children: [
    item({ id: 101, section: "foundations", parentId: 100, displayTitle: "What a Headline Actually Does" }),
  ],
});
const imageFoundations = item({
  id: 110,
  section: "foundations",
  kind: "group",
  displayTitle: "Image Foundations",
  children: [item({ id: 111, section: "foundations", parentId: 110, displayTitle: "The Three Jobs of an Ad Image" })],
});
const toolkit = item({
  id: 200,
  kind: "group",
  displayTitle: "Campaign Toolkit",
  children: [
    item({ id: 201, parentId: 200, displayTitle: "Campaign Checklist" }),
    item({ id: 202, parentId: 200, displayTitle: "Power Word Dictionary" }),
  ],
});
const tracking = item({
  id: 300,
  section: "templates_assets",
  kind: "group",
  displayTitle: "Tracking & Templates",
  blurb: "Your campaign P&L tracker plus the proven dedicated email template.",
  children: [
    item({
      id: 301,
      section: "templates_assets",
      kind: "external",
      fileId: null,
      fileName: null,
      parentId: 300,
      displayTitle: "P&L Tracker",
      externalUrl: "https://example.com/pnl-copy",
    }),
  ],
});

function renderPage() {
  vi.mocked(fetchResourceHub).mockResolvedValue({
    sections: {
      foundations: [copywriting, imageFoundations],
      working_documents: [toolkit],
      templates_assets: [tracking],
    },
    glossary: [],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ResourceHub />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ResourceHub — collapsible full-width cards (Task #2039)", () => {
  it("renders Foundations as collapsed collapsible cards that expand to the part list", async () => {
    renderPage();
    const user = userEvent.setup();

    expect(await screen.findByText("Copywriting Foundations")).toBeTruthy();
    expect(screen.getByText("Image Foundations")).toBeTruthy();
    // Collapsed by default — no part rows or actions yet.
    expect(screen.queryByTestId("row-series-part-101")).toBeNull();

    await user.click(screen.getByTestId("button-toggle-series-100"));
    expect(screen.getByText("What a Headline Actually Does")).toBeTruthy();
    const read = screen.getByTestId("link-read-101");
    expect(read.getAttribute("href")).toBe("/resource-hub/view/item-101");
    // File rows offer Read AND Download (owner request 2026-08-07); no legacy
    // blob-open ("view") action.
    expect(screen.getByTestId("button-download-101")).toBeTruthy();
    expect(screen.queryByTestId("button-view-101")).toBeNull();
    // The other series stays collapsed independently.
    expect(screen.queryByTestId("row-series-part-111")).toBeNull();
  });

  it("expands the Campaign Toolkit group to show its file children", async () => {
    renderPage();
    const user = userEvent.setup();

    await screen.findByText("Campaign Toolkit");
    expect(screen.queryByText("Campaign Checklist")).toBeNull();

    await user.click(screen.getByTestId("button-toggle-group-200"));
    expect(screen.getByText("Campaign Checklist")).toBeTruthy();
    expect(screen.getByText("Power Word Dictionary")).toBeTruthy();
    expect(screen.getByTestId("link-read-201")).toBeTruthy();
    expect(screen.getByTestId("button-download-201")).toBeTruthy();
  });

  it("renders external children inside a group with a working Open link", async () => {
    renderPage();
    const user = userEvent.setup();

    await screen.findByText("Tracking & Templates");
    await user.click(screen.getByTestId("button-toggle-group-300"));

    const open = screen.getByTestId("button-open-301");
    expect(open.getAttribute("href")).toBe("https://example.com/pnl-copy");
    expect(open.getAttribute("target")).toBe("_blank");
    // An external child never shows file read/download actions.
    expect(screen.queryByTestId("link-read-301")).toBeNull();
    expect(screen.queryByTestId("button-download-301")).toBeNull();
  });

  it("shows a Download action on every file row and none on external rows", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Campaign Toolkit");
    for (const id of ["button-toggle-series-100", "button-toggle-series-110", "button-toggle-group-200", "button-toggle-group-300"]) {
      await user.click(screen.getByTestId(id));
    }
    const testIds = Array.from(document.querySelectorAll("[data-testid]")).map(
      (el) => el.getAttribute("data-testid") ?? "",
    );
    // Every rendered file row (link-read-*) has a matching download button.
    const readIds = testIds.filter((t) => t.startsWith("link-read-")).map((t) => t.replace("link-read-", ""));
    expect(readIds.length).toBeGreaterThan(0);
    for (const id of readIds) {
      expect(testIds).toContain(`button-download-${id}`);
    }
    // External rows never get file actions; no legacy blob-open action anywhere.
    expect(testIds).not.toContain("button-download-301");
    expect(testIds.some((t) => t.startsWith("button-view-"))).toBe(false);
  });
});
