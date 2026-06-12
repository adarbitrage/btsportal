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

const registerMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    register: registerMock,
    resendVerificationEmail: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Each test re-imports Register after the env var is set so the module-level
// TURNSTILE_SITE_KEY constant picks up the test value.
// ---------------------------------------------------------------------------
describe("Register — captcha failure resilience", () => {
  let Register: React.ComponentType;

  function fillValidForm() {
    fireEvent.change(screen.getByPlaceholderText(/your full name/i), {
      target: { value: "New Member" },
    });
    fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), {
      target: { value: "member@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/min 8 chars/i), {
      target: { value: "hunter22" },
    });
    fireEvent.change(screen.getByPlaceholderText(/confirm your password/i), {
      target: { value: "hunter22" },
    });
  }

  beforeEach(async () => {
    capturedOnError = undefined;
    capturedOnToken = undefined;
    registerMock.mockReset();

    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
    vi.resetModules();

    const mod = await import("@/pages/Register");
    Register = mod.default;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("disables the submit button initially when the widget has not yet solved", () => {
    render(<Register />);
    const btn = screen.getByRole("button", { name: /create account/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.queryByTestId("captcha-failed-notice")).not.toBeInTheDocument();
  });

  it("enables the button and shows the inline notice when the widget fails to load", async () => {
    render(<Register />);

    await act(async () => {
      capturedOnError?.();
    });

    const btn = screen.getByRole("button", { name: /create account/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.getByTestId("captcha-failed-notice")).toBeInTheDocument();
    expect(screen.getByText(/security challenge could not load/i)).toBeInTheDocument();
    expect(screen.getByText(/you can still create your account/i)).toBeInTheDocument();
  });

  it("enables the button and hides the notice when the widget solves normally (no failure)", async () => {
    render(<Register />);

    await act(async () => {
      capturedOnToken?.("a-valid-token");
    });

    const btn = screen.getByRole("button", { name: /create account/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.queryByTestId("captcha-failed-notice")).not.toBeInTheDocument();
  });

  it("clears the failure notice when the widget solves after a prior error", async () => {
    render(<Register />);

    await act(async () => {
      capturedOnError?.();
    });
    expect(screen.getByTestId("captcha-failed-notice")).toBeInTheDocument();

    await act(async () => {
      capturedOnToken?.("a-valid-token");
    });

    expect(screen.queryByTestId("captcha-failed-notice")).not.toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /create account/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("calls register without a captcha token when the widget has failed", async () => {
    registerMock.mockResolvedValueOnce("Check your inbox to finish signing up.");
    render(<Register />);

    fillValidForm();

    await act(async () => {
      capturedOnError?.();
    });

    await act(async () => {
      fireEvent.submit(
        (screen.getByRole("button", { name: /create account/i }) as HTMLButtonElement)
          .closest("form")!,
      );
    });

    expect(registerMock).toHaveBeenCalledWith(
      "New Member",
      "member@example.com",
      "hunter22",
      undefined,
    );
  });

  it("keeps the button enabled and notice visible after a failed register attempt when captcha is down", async () => {
    registerMock.mockRejectedValueOnce(
      Object.assign(new Error("Something went wrong"), { code: "SERVER_ERROR" }),
    );
    render(<Register />);

    fillValidForm();

    // Widget fails to load
    await act(async () => {
      capturedOnError?.();
    });

    // Submit
    await act(async () => {
      fireEvent.submit(
        (screen.getByRole("button", { name: /create account/i }) as HTMLButtonElement)
          .closest("form")!,
      );
    });

    // Register should have been attempted
    expect(registerMock).toHaveBeenCalledTimes(1);

    // Button must stay enabled — captchaFailed is still true, widget isn't coming back
    const btn = screen.getByRole("button", { name: /create account/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    // Notice must still be visible so the user knows the challenge is unavailable
    expect(screen.getByTestId("captcha-failed-notice")).toBeInTheDocument();
  });

  it("does not allow submission when the widget is present but unsolved (normal path)", async () => {
    render(<Register />);

    fillValidForm();

    await act(async () => {
      fireEvent.submit(
        (screen.getByRole("button", { name: /create account/i }) as HTMLButtonElement)
          .closest("form")!,
      );
    });

    expect(registerMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/please complete the challenge/i),
    ).toBeInTheDocument();
  });
});
