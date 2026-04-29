import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/verify-email", navigateMock],
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const resendVerificationEmailMock = vi.fn<(email: string) => Promise<string>>();
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    resendVerificationEmail: resendVerificationEmailMock,
  }),
}));

import VerifyEmail from "@/pages/VerifyEmail";

function setLocationSearch(search: string) {
  window.history.replaceState({}, "", `/verify-email${search}`);
}

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;
let fetchMock: FetchMock;

function mockFetchOnce(ok: boolean, body: Record<string, unknown>) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  resendVerificationEmailMock.mockReset();
  setLocationSearch("");
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocationSearch("");
});

describe("VerifyEmail — token verification", () => {
  it("shows the success state when the token verifies", async () => {
    mockFetchOnce(true, { message: "Email verified successfully" });

    setLocationSearch("?token=valid-token");

    render(<VerifyEmail />);

    await waitFor(() =>
      expect(screen.getByTestId("verify-email-success")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Email verified successfully/i)).toBeInTheDocument();

    // Calls the verify endpoint with the token from the query string.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/auth\/verify-email$/);
    const body = init?.body;
    expect(typeof body).toBe("string");
    expect(JSON.parse(body as string)).toEqual({ token: "valid-token" });

    // Should not show the resend form on success.
    expect(
      screen.queryByTestId("resend-verification-form"),
    ).not.toBeInTheDocument();
  });

  it("shows the missing-token error and the resend form when no token is present", async () => {
    setLocationSearch("");

    render(<VerifyEmail />);

    await waitFor(() =>
      expect(screen.getByTestId("verify-email-error")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Missing verification token/i)).toBeInTheDocument();
    expect(
      screen.getByTestId("resend-verification-form"),
    ).toBeInTheDocument();
    // Never hits the verify endpoint when the token is missing.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the resend form when the backend says the token is invalid/expired", async () => {
    mockFetchOnce(false, { error: "Invalid or expired verification token" });

    setLocationSearch("?token=stale-token");

    render(<VerifyEmail />);

    await waitFor(() =>
      expect(screen.getByTestId("verify-email-error")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Invalid or expired verification token/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("resend-verification-form")).toBeInTheDocument();
  });
});

describe("VerifyEmail — resend form", () => {
  async function renderInErrorState() {
    setLocationSearch("");
    render(<VerifyEmail />);
    await waitFor(() =>
      expect(screen.getByTestId("resend-verification-form")).toBeInTheDocument(),
    );
  }

  it("requires an email and calls resendVerificationEmail with the typed value", async () => {
    await renderInErrorState();

    resendVerificationEmailMock.mockResolvedValueOnce(
      "If your account isn't verified yet, we sent a new verification link.",
    );

    const submit = screen.getByTestId(
      "resend-verification-button",
    ) as HTMLButtonElement;
    // With no email typed yet, the submit button must be disabled — the
    // expired-link case has no other identifier we can fall back to.
    expect(submit.disabled).toBe(true);

    const input = screen.getByTestId(
      "resend-verification-email-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "stranded@example.com" } });
    expect(submit.disabled).toBe(false);

    const form = input.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() =>
      expect(resendVerificationEmailMock).toHaveBeenCalledWith(
        "stranded@example.com",
      ),
    );

    // Generic-success confirmation is rendered in place of the form, mirroring
    // the post-submit UI on the login screen so behaviour is consistent.
    await waitFor(() =>
      expect(
        screen.getByTestId("resend-verification-notice"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("resend-verification-form"),
    ).not.toBeInTheDocument();
  });

  it("surfaces the rate-limit message gracefully on a 429", async () => {
    await renderInErrorState();

    resendVerificationEmailMock.mockRejectedValueOnce(
      new Error("Too many verification email requests. Please try again later."),
    );

    const input = screen.getByTestId(
      "resend-verification-email-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "rate-limited@example.com" } });
    const form = input.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() =>
      expect(
        screen.getByTestId("resend-verification-error"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Too many verification email requests/i),
    ).toBeInTheDocument();

    // The form is still mounted so the user can retry once the limit clears,
    // and the generic-success notice was NOT shown (this wasn't a success).
    expect(screen.getByTestId("resend-verification-form")).toBeInTheDocument();
    expect(
      screen.queryByTestId("resend-verification-notice"),
    ).not.toBeInTheDocument();
  });

  it("trims surrounding whitespace before calling the resend endpoint", async () => {
    await renderInErrorState();
    resendVerificationEmailMock.mockResolvedValueOnce("ok");

    const input = screen.getByTestId(
      "resend-verification-email-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  spaced@example.com  " } });
    const form = input.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() =>
      expect(resendVerificationEmailMock).toHaveBeenCalledWith(
        "spaced@example.com",
      ),
    );
  });
});
