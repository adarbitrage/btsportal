import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Guards against a data-loss bug: editing a CHILD curation item (e.g. changing
// its title or blurb) must preserve its parent-group linkage. A regression
// where the editor initializes parentId to empty and the save always sends
// parentId: null silently detaches children from their group on every edit.

vi.mock("@/lib/resource-hub-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resource-hub-api")>(
    "@/lib/resource-hub-api",
  );
  return {
    ...actual,
    fetchHubItems: vi.fn(),
    updateHubItem: vi.fn(),
    createHubItem: vi.fn(),
    deleteHubItem: vi.fn(),
  };
});

import {
  fetchHubItems,
  updateHubItem,
  type HubItem,
} from "@/lib/resource-hub-api";
import { ResourceHubCuration } from "../ResourceHubCuration";

const group: HubItem = {
  id: 10,
  section: "working_documents",
  kind: "group",
  fileId: null,
  fileName: null,
  externalUrl: null,
  parentId: null,
  subGroupLabel: null,
  displayTitle: "Headline Library",
  blurb: "Classic headline references.",
  noteLine: "Never copy verbatim.",
  sortOrder: 5,
  children: [
    {
      id: 11,
      section: "working_documents",
      kind: "file",
      fileId: 42,
      fileName: "swipe.pdf",
      externalUrl: null,
      parentId: 10,
      subGroupLabel: "Swipe Files",
      displayTitle: "100 Greatest Headlines Ever Written",
      blurb: "The legendary collection.",
      noteLine: null,
      sortOrder: 1,
    },
  ],
};

function renderComponent() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ResourceHubCuration />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ResourceHubCuration — editing a child keeps its parent group", () => {
  it("sends the existing parentId (and sub-group label) unchanged when only the title is edited", async () => {
    vi.mocked(fetchHubItems).mockResolvedValue({ items: [group] });
    vi.mocked(updateHubItem).mockResolvedValue({ item: group.children![0] });

    renderComponent();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("button-edit-curation-11"));

    const title = await screen.findByTestId("input-display-title");
    await user.clear(title);
    await user.type(title, "100 Greatest Headlines");
    await user.click(screen.getByTestId("button-save-curation-item"));

    await waitFor(() => expect(updateHubItem).toHaveBeenCalledTimes(1));
    const [id, input] = vi.mocked(updateHubItem).mock.calls[0];
    expect(id).toBe(11);
    expect(input.parentId).toBe(10);
    expect(input.subGroupLabel).toBe("Swipe Files");
    expect(input.displayTitle).toBe("100 Greatest Headlines");
  });

  it("sends parentId null only when the admin explicitly selects 'None'", async () => {
    vi.mocked(fetchHubItems).mockResolvedValue({ items: [group] });
    vi.mocked(updateHubItem).mockResolvedValue({ item: group.children![0] });

    renderComponent();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("button-edit-curation-11"));
    await user.click(await screen.findByTestId("select-parent"));
    await user.click(await screen.findByText("None (top-level card)"));
    await user.click(screen.getByTestId("button-save-curation-item"));

    await waitFor(() => expect(updateHubItem).toHaveBeenCalledTimes(1));
    const [, input] = vi.mocked(updateHubItem).mock.calls[0];
    expect(input.parentId).toBeNull();
  });
});
