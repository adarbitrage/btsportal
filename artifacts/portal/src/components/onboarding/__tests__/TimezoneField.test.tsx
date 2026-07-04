import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimezoneField } from "@/components/onboarding/TimezoneField";

// Task #1684: US-first curated timezone dropdown on the onboarding profile
// step. Selecting a friendly US label must store the exact IANA value; a
// stored non-US zone must round-trip under "Other" without being blanked or
// silently rewritten.

function setup(value: string) {
  const onChange = vi.fn();
  render(<TimezoneField value={value} onChange={onChange} />);
  return { onChange };
}

describe("TimezoneField — US options", () => {
  it("shows the seven US labels in the trigger's dropdown", async () => {
    setup("America/Chicago");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("timezone-select-trigger"));

    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText("Eastern Time (ET)")).toBeInTheDocument();
    expect(within(listbox).getByText("Central Time (CT)")).toBeInTheDocument();
    expect(within(listbox).getByText("Mountain Time (MT)")).toBeInTheDocument();
    expect(within(listbox).getByText("Arizona (no DST)")).toBeInTheDocument();
    expect(within(listbox).getByText("Pacific Time (PT)")).toBeInTheDocument();
    expect(within(listbox).getByText("Alaska (AKT)")).toBeInTheDocument();
    expect(within(listbox).getByText("Hawaii (HT)")).toBeInTheDocument();
    expect(within(listbox).getByText("Other / International")).toBeInTheDocument();
  });

  it("selecting a US label stores the exact IANA value", async () => {
    const { onChange } = setup("America/Chicago");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("timezone-select-trigger"));
    await user.click(await screen.findByText("Pacific Time (PT)"));

    expect(onChange).toHaveBeenCalledWith("America/Los_Angeles");
  });

  it("pre-selects the matching US option when the stored zone is canonical", () => {
    setup("America/Denver");
    expect(screen.getByTestId("timezone-select-trigger")).toHaveTextContent("Mountain Time (MT)");
  });

  it("pre-selects the matching US option when the stored zone is a non-canonical US alias", () => {
    setup("America/Detroit");
    expect(screen.getByTestId("timezone-select-trigger")).toHaveTextContent("Eastern Time (ET)");
    expect(screen.queryByTestId("timezone-other-trigger")).not.toBeInTheDocument();
  });
});

describe("TimezoneField — Other / International", () => {
  it("a stored non-US zone renders selected under Other, not blanked", () => {
    setup("Asia/Tokyo");
    expect(screen.getByTestId("timezone-select-trigger")).toHaveTextContent("Other / International");
    expect(screen.getByTestId("timezone-other-trigger")).toHaveTextContent("Asia/Tokyo");
  });

  it("choosing Other reveals the searchable full-IANA list", async () => {
    setup("America/Chicago");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("timezone-select-trigger"));
    await user.click(await screen.findByText("Other / International"));

    expect(await screen.findByTestId("timezone-other-trigger")).toBeInTheDocument();
  });

  it("selecting a zone from the Other search saves the exact IANA value unchanged", async () => {
    const { onChange } = setup("Asia/Tokyo");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("timezone-other-trigger"));

    const input = await screen.findByPlaceholderText("Search timezone...");
    fireEvent.change(input, { target: { value: "Europe/London" } });

    const option = await screen.findByText("Europe/London");
    await user.click(option);

    expect(onChange).toHaveBeenCalledWith("Europe/London");
  });
});
