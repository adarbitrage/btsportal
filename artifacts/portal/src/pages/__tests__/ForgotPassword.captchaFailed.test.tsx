import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module-level state used by the Turnstile mock so tests can fire callbacks.
// These are re-set on each render of the mocked widget.
// ---------------------------------------------------------------------------
let capturedOnError: (() => void) | undefined;
let capturedOnToken: ((token: string) => void) | undefined;

vi.mock("@/components/Turnstile", () => ({
  Turnstile: ({
    onError,
    onToken,
  }: {
    onError?: () => void;
    onToken: (token: string) => void;
  }) => {
    capturedOnError = onError;
    capturedOnToken = onToken;
    return <div data-testid="turnstile-widget" />;
  },
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Each test re-imports ForgotPassword after the env var is set so the
// module-level TURNSTILE_SITE_KEY constant picks up the test value.
// ---------------------------------------------------------------------------
describe("ForgotPassword — captcha failure resilience", () => {
  let ForgotPassword: React.ComponentType;
  let fetchMock: ReturnType<typeof vi.fn>;

  function fillValidForm() {
    fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), {
      target: { value: "member@example.com" },
    });
  }

  beforeEach(async () => {
    capturedOnError = undefined;
    capturedOnToken = undefined;

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
    vi.resetModules();

    const mod = await import("@/pages/ForgotPassword");
    ForgotPassword = mod.default;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("disables the submit button initially when the widget has not yet solved", () => {
    render(<ForgotPassword />);
    const btn = screen.getByRole("button", { name: /send reset link/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.queryByTestId("captcha-failed-notice")).not.toBeInTheDocument();
  });

  it("enables the button and shows the inline notice when the widget fails to load", async () => {
    render(<ForgotPassword />);

    await act(async () => {
      capturedOnError?.();
    });

    const btn = screen.getByRole("button", { name: /send reset link/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.getByTestId("captcha-failed-notice")).toBeInTheDocument();
    expect(screen.getByText(/security challenge could not load/i)).toBeInTheDocument();
    expect(screen.getByText(/you can still request your reset link/i)).toBeInTheDocument();
  });

  it("enables the button and hides the notice when the widget solves normally (no failure)", async () => {
    render(<ForgotPassword />);

    await act(async () => {
      capturedOnToken?.("a-valid-token");
    });

    const btn = screen.getByRole("button", { name: /send reset link/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.queryByTestId("captcha-failed-notice")).not.toBeInTheDocument();
  });

  it("clears the failure notice when the widget solves after a prior error", async () => {
    render(<ForgotPassword />);

    await act(async () => {
      capturedOnError?.();
    });
    expect(screen.getByTestId("captcha-failed-notice")).toBeInTheDocument();

    await act(async () => {
      capturedOnToken?.("a-valid-token");
    });

    expect(screen.queryByTestId("captcha-failed-notice")).not.toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /send reset link/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("posts without a captcha token when the widget has failed", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    render(<ForgotPassword />);

    fillValidForm();

    await act(async () => {
      capturedOnError?.();
    });

    await act(async () => {
      fireEvent.submit(
        (screen.getByRole("button", { name: /send reset link/i }) as HTMLButtonElement)
          .closest("form")!,
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ email: "member@example.com" });
    expect(body.captchaToken).toBeUndefined();
  });

  it("keeps the button enabled and notice visible after a failed request when captcha is down", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { code: "SERVER_ERROR", message: "Something went wrong" } }),
    });
    render(<ForgotPassword />);

    fillValidForm();

    // Widget fails to load
    await act(async () => {
      capturedOnError?.();
    });

    // Submit
    await act(async () => {
      fireEvent.submit(
        (screen.getByRole("button", { name: /send reset link/i }) as HTMLButtonElement)
          .closest("form")!,
      );
    });

    // Request should have been attempted
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Button must stay enabled — captchaFailed is still true, widget isn't coming back
    const btn = screen.getByRole("button", { name: /send reset link/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    // Notice must still be visible so the user knows the challenge is unavailable
    expect(screen.getByTestId("captcha-failed-notice")).toBeInTheDocument();
  });

  it("does not allow submission when the widget is present but unsolved (normal path)", async () => {
    render(<ForgotPassword />);

    fillValidForm();

    await act(async () => {
      fireEvent.submit(
        (screen.getByRole("button", { name: /send reset link/i }) as HTMLButtonElement)
          .closest("form")!,
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/please complete the challenge/i),
    ).toBeInTheDocument();
  });
});
