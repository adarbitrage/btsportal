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
  useLocation: () => ["/login", vi.fn()],
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const loginMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    login: loginMock,
    resendVerificationEmail: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Each test re-imports Login after the env var is set so the module-level
// TURNSTILE_SITE_KEY constant picks up the test value.
// ---------------------------------------------------------------------------
describe("Login — captcha failure resilience", () => {
  let Login: React.ComponentType;

  beforeEach(async () => {
    capturedOnError = undefined;
    capturedOnToken = undefined;
    loginMock.mockReset();

    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
    vi.resetModules();

    const mod = await import("@/pages/Login");
    Login = mod.default;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("disables the submit button initially when the widget has not yet solved", () => {
    render(<Login />);
    const btn = screen.getByRole("button", { name: /sign in/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.queryByTestId("captcha-failed-notice")).not.toBeInTheDocument();
  });

  it("enables the button and shows the inline notice when the widget fails to load", async () => {
    render(<Login />);

    await act(async () => {
      capturedOnError?.();
    });

    const btn = screen.getByRole("button", { name: /sign in/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.getByTestId("captcha-failed-notice")).toBeInTheDocument();
    expect(screen.getByText(/security challenge could not load/i)).toBeInTheDocument();
    expect(screen.getByText(/you can still sign in/i)).toBeInTheDocument();
  });

  it("enables the button and hides the notice when the widget solves normally (no failure)", async () => {
    render(<Login />);

    await act(async () => {
      capturedOnToken?.("a-valid-token");
    });

    const btn = screen.getByRole("button", { name: /sign in/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.queryByTestId("captcha-failed-notice")).not.toBeInTheDocument();
  });

  it("clears the failure notice when the widget solves after a prior error", async () => {
    render(<Login />);

    await act(async () => {
      capturedOnError?.();
    });
    expect(screen.getByTestId("captcha-failed-notice")).toBeInTheDocument();

    await act(async () => {
      capturedOnToken?.("a-valid-token");
    });

    expect(screen.queryByTestId("captcha-failed-notice")).not.toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /sign in/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("calls login without a captcha token when the widget has failed", async () => {
    loginMock.mockResolvedValueOnce(undefined);
    render(<Login />);

    fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), {
      target: { value: "member@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/enter your password/i), {
      target: { value: "hunter2" },
    });

    await act(async () => {
      capturedOnError?.();
    });

    await act(async () => {
      fireEvent.submit(
        (screen.getByRole("button", { name: /sign in/i }) as HTMLButtonElement)
          .closest("form")!,
      );
    });

    expect(loginMock).toHaveBeenCalledWith("member@example.com", "hunter2", undefined);
  });

  it("keeps the button enabled and notice visible after a failed login attempt when captcha is down", async () => {
    loginMock.mockRejectedValueOnce(
      Object.assign(new Error("Invalid credentials"), { code: "INVALID_CREDENTIALS" }),
    );
    render(<Login />);

    fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), {
      target: { value: "member@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/enter your password/i), {
      target: { value: "wrongpassword" },
    });

    // Widget fails to load
    await act(async () => {
      capturedOnError?.();
    });

    // Submit with wrong credentials
    await act(async () => {
      fireEvent.submit(
        (screen.getByRole("button", { name: /sign in/i }) as HTMLButtonElement)
          .closest("form")!,
      );
    });

    // Login should have been attempted
    expect(loginMock).toHaveBeenCalledTimes(1);

    // Button must stay enabled — captchaFailed is still true, widget isn't coming back
    const btn = screen.getByRole("button", { name: /sign in/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    // Notice must still be visible so the user knows the challenge is unavailable
    expect(screen.getByTestId("captcha-failed-notice")).toBeInTheDocument();
  });

  it("does not allow submission when the widget is present but unsolved (normal path)", async () => {
    render(<Login />);

    fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), {
      target: { value: "member@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/enter your password/i), {
      target: { value: "hunter2" },
    });

    await act(async () => {
      fireEvent.submit(
        (screen.getByRole("button", { name: /sign in/i }) as HTMLButtonElement)
          .closest("form")!,
      );
    });

    expect(loginMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/please complete the challenge/i),
    ).toBeInTheDocument();
  });
});
