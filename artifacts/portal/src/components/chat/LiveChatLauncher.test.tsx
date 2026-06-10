import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { LiveChatLauncher, WIDGET_SCRIPT_ID, WIDGET_STACKED_STYLE_ID } from "./LiveChatLauncher";
import {
  TICKETDESK_WIDGET_SCRIPT_URL,
  TICKETDESK_WIDGET_WORKSPACE_ID,
  TICKETDESK_WIDGET_API_URL,
} from "@/config/support";

beforeEach(() => {
  document.getElementById(WIDGET_SCRIPT_ID)?.remove();
  document.getElementById(WIDGET_STACKED_STYLE_ID)?.remove();
});

afterEach(() => {
  document.getElementById(WIDGET_SCRIPT_ID)?.remove();
  document.getElementById(WIDGET_STACKED_STYLE_ID)?.remove();
});

describe("LiveChatLauncher", () => {
  it("injects the widget script tag into <head> with correct src and data attributes on mount", () => {
    render(<LiveChatLauncher />);

    const script = document.getElementById(WIDGET_SCRIPT_ID) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script!.tagName).toBe("SCRIPT");
    expect(script!.getAttribute("src")).toBe(TICKETDESK_WIDGET_SCRIPT_URL);
    expect(script!.async).toBe(true);
    expect(script!.getAttribute("data-workspace")).toBe(TICKETDESK_WIDGET_WORKSPACE_ID);
    expect(script!.getAttribute("data-api")).toBe(TICKETDESK_WIDGET_API_URL);
  });

  it("renders no visible DOM output (the widget renders itself via the injected script)", () => {
    const { container } = render(<LiveChatLauncher />);
    expect(container.firstChild).toBeNull();
  });

  it("removes the widget script tag from <head> on unmount", () => {
    const { unmount } = render(<LiveChatLauncher />);
    expect(document.getElementById(WIDGET_SCRIPT_ID)).not.toBeNull();
    unmount();
    expect(document.getElementById(WIDGET_SCRIPT_ID)).toBeNull();
  });

  it("does not inject a duplicate script when already present in the DOM", () => {
    render(<LiveChatLauncher />);
    render(<LiveChatLauncher />);
    const scripts = document.querySelectorAll(`#${WIDGET_SCRIPT_ID}`);
    expect(scripts.length).toBe(1);
  });

  it("does not inject the stacked offset style when stacked=false (default)", () => {
    render(<LiveChatLauncher />);
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).toBeNull();
  });

  it("injects the stacked offset style when stacked=true so the widget bubble clears the AI launcher", () => {
    render(<LiveChatLauncher stacked />);
    const style = document.getElementById(WIDGET_STACKED_STYLE_ID) as HTMLStyleElement | null;
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain("96px");
  });

  it("removes the stacked offset style on unmount when stacked=true", () => {
    const { unmount } = render(<LiveChatLauncher stacked />);
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).not.toBeNull();
    unmount();
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).toBeNull();
  });

  it("injects the stacked style when stacked prop changes from false to true", () => {
    const { rerender } = render(<LiveChatLauncher stacked={false} />);
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).toBeNull();
    act(() => rerender(<LiveChatLauncher stacked={true} />));
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).not.toBeNull();
  });

  it("removes the stacked style when stacked prop changes from true to false", () => {
    const { rerender } = render(<LiveChatLauncher stacked={true} />);
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).not.toBeNull();
    act(() => rerender(<LiveChatLauncher stacked={false} />));
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).toBeNull();
  });
});
