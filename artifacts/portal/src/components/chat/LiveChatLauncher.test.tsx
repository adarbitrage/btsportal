import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiveChatLauncher } from "./LiveChatLauncher";

const TICKETDESK_URL = "https://tickets.buildtestscale.com/";

let openSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openSpy = vi.fn();
  vi.stubGlobal("open", openSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function getLauncherButton() {
  return screen.getByLabelText("Open live chat support");
}

// The launcher button shares title="Live Chat Support" with the iframe, so we
// target the embed by tag to avoid an ambiguous match.
function queryIframe(container: HTMLElement) {
  return container.querySelector("iframe");
}

describe("LiveChatLauncher", () => {
  it("opens an in-page panel with the TicketDesk iframe (not a new tab) when the launcher is clicked", async () => {
    const { container } = render(<LiveChatLauncher />);

    // Closed state: only the launcher button, no iframe yet.
    expect(getLauncherButton()).toBeInTheDocument();
    expect(queryIframe(container)).toBeNull();

    await userEvent.click(getLauncherButton());

    // The embed renders in-page, pointing at the TicketDesk URL.
    const iframe = queryIframe(container);
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("title")).toBe("Live Chat Support");
    expect(iframe!.getAttribute("src")).toBe(TICKETDESK_URL);

    // Crucially, it did NOT open a new tab.
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("supports minimize and close controls that return to the launcher", async () => {
    const { container } = render(<LiveChatLauncher />);

    // Open, then minimize.
    await userEvent.click(getLauncherButton());
    expect(queryIframe(container)).not.toBeNull();

    await userEvent.click(screen.getByTitle("Minimize"));
    expect(queryIframe(container)).toBeNull();
    expect(getLauncherButton()).toBeInTheDocument();

    // Re-open, then close.
    await userEvent.click(getLauncherButton());
    expect(queryIframe(container)).not.toBeNull();

    await userEvent.click(screen.getByTitle("Close"));
    expect(queryIframe(container)).toBeNull();
    expect(getLauncherButton()).toBeInTheDocument();
  });

  it("exposes an 'Open in new tab' header control that opens TicketDesk in a new tab", async () => {
    render(<LiveChatLauncher />);

    await userEvent.click(getLauncherButton());
    await userEvent.click(screen.getByTitle("Open in new tab"));

    expect(openSpy).toHaveBeenCalledWith(
      TICKETDESK_URL,
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("falls back to a new-tab 'Open Live Chat' button when the embed never loads (e.g. blocked by X-Frame-Options/CSP)", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<LiveChatLauncher />);

      fireEvent.click(getLauncherButton());

      // Still loading: iframe present, no fallback yet.
      expect(queryIframe(container)).not.toBeNull();
      expect(screen.queryByText("Live chat couldn't load here")).toBeNull();

      // A frame-ancestors/X-Frame-Options block means onLoad never fires, so the
      // 8s watchdog is what surfaces the fallback. Advance past it.
      act(() => {
        vi.advanceTimersByTime(8000);
      });

      // The iframe is replaced by the fallback message + new-tab CTA.
      expect(queryIframe(container)).toBeNull();
      expect(screen.getByText("Live chat couldn't load here")).toBeInTheDocument();

      // The fallback CTA opens TicketDesk in a new tab.
      const fallbackButton = screen.getByRole("button", { name: /Open Live Chat/i });
      fireEvent.click(fallbackButton);
      expect(openSpy).toHaveBeenCalledWith(
        TICKETDESK_URL,
        "_blank",
        "noopener,noreferrer",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the fallback timeout and shows the embed once the iframe loads", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<LiveChatLauncher />);

      fireEvent.click(getLauncherButton());

      const iframe = queryIframe(container);
      expect(iframe).not.toBeNull();
      act(() => {
        fireEvent.load(iframe!);
      });

      // Even after the watchdog window passes, no fallback because it loaded.
      act(() => {
        vi.advanceTimersByTime(8000);
      });

      expect(queryIframe(container)).not.toBeNull();
      expect(screen.queryByText("Live chat couldn't load here")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
