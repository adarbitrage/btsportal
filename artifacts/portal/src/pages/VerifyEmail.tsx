import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

const API_BASE = `${import.meta.env.BASE_URL}api`;

type Status = "verifying" | "success" | "error" | "missing";

export default function VerifyEmail() {
  const [, navigate] = useLocation();
  const { resendVerificationEmail } = useAuth();
  const [status, setStatus] = useState<Status>("verifying");
  const [message, setMessage] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState("");
  const [resendError, setResendError] = useState("");
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setStatus("missing");
      setMessage(
        "This verification link is missing its token. Use the link from your email, or request a fresh one below.",
      );
      return;
    }

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/verify-email`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus("error");
          setMessage(
            (typeof data?.error === "string" && data.error) ||
              data?.error?.message ||
              "Invalid or expired verification token.",
          );
          return;
        }
        setStatus("success");
        setMessage(
          (typeof data?.message === "string" && data.message) ||
            "Your email has been verified. You can now sign in to your account.",
        );
      } catch {
        setStatus("error");
        setMessage(
          "We couldn't reach the server to verify your email. Please try again, or request a new link below.",
        );
      }
    })();
  }, []);

  const handleResend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = resendEmail.trim();
      if (!trimmed || resending) return;
      setResending(true);
      setResendNotice("");
      setResendError("");
      try {
        const generic = await resendVerificationEmail(trimmed);
        setResendNotice(generic);
      } catch (err) {
        const e = err as Error;
        setResendError(
          e.message ||
            "Could not resend the verification email. Please try again in a few minutes.",
        );
      } finally {
        setResending(false);
      }
    },
    [resendEmail, resending, resendVerificationEmail],
  );

  const showResendForm = status === "error" || status === "missing";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#faf9f7",
        padding: "24px",
        fontFamily: "Roboto, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#ffffff",
          borderRadius: 12,
          padding: "40px 32px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)",
          textAlign: "center",
        }}
      >
        {status === "verifying" && (
          <div data-testid="verify-email-pending">
            <Loader2
              className="animate-spin"
              style={{
                width: 40,
                height: 40,
                color: "#1a56db",
                margin: "0 auto 16px",
              }}
            />
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              Verifying your email
            </h1>
            <p style={{ color: "#666" }}>One moment...</p>
          </div>
        )}

        {status === "success" && (
          <div data-testid="verify-email-success">
            <CheckCircle2
              style={{
                width: 48,
                height: 48,
                color: "#16a34a",
                margin: "0 auto 16px",
              }}
            />
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              Email verified
            </h1>
            <p style={{ color: "#555", marginBottom: 24 }}>{message}</p>
            <button
              type="button"
              onClick={() => navigate("/login")}
              style={{
                background: "#1a56db",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "12px 24px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Sign in
            </button>
          </div>
        )}

        {showResendForm && (
          <div data-testid="verify-email-error">
            <AlertCircle
              style={{
                width: 48,
                height: 48,
                color: "#dc2626",
                margin: "0 auto 16px",
              }}
            />
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              {status === "missing"
                ? "Missing verification token"
                : "Couldn't verify your email"}
            </h1>
            <p style={{ color: "#555", marginBottom: 24, lineHeight: 1.5 }}>
              {message}
            </p>

            {resendNotice ? (
              <div
                role="status"
                data-testid="resend-verification-notice"
                style={{
                  padding: "12px 16px",
                  background: "#ecfdf5",
                  border: "1px solid #a7f3d0",
                  borderRadius: 8,
                  color: "#065f46",
                  fontSize: 14,
                  textAlign: "center",
                  lineHeight: 1.5,
                  marginBottom: 16,
                }}
              >
                {resendNotice}
              </div>
            ) : (
              <form
                onSubmit={handleResend}
                data-testid="resend-verification-form"
                style={{ textAlign: "left" }}
              >
                <p
                  style={{
                    fontSize: 13,
                    color: "#6b7280",
                    marginBottom: 12,
                    textAlign: "center",
                  }}
                >
                  Enter your email and we'll send a fresh verification link.
                </p>
                <label
                  htmlFor="resend-verification-email"
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#374151",
                    marginBottom: 6,
                  }}
                >
                  Email
                </label>
                <input
                  id="resend-verification-email"
                  data-testid="resend-verification-email-input"
                  type="email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    fontSize: 15,
                    outline: "none",
                    boxSizing: "border-box",
                    marginBottom: 16,
                  }}
                />
                {resendError && (
                  <div
                    data-testid="resend-verification-error"
                    role="alert"
                    style={{
                      padding: "10px 12px",
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: 8,
                      color: "#dc2626",
                      fontSize: 13,
                      marginBottom: 16,
                    }}
                  >
                    {resendError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={resending || !resendEmail.trim()}
                  data-testid="resend-verification-button"
                  style={{
                    width: "100%",
                    padding: "12px",
                    background:
                      resending || !resendEmail.trim() ? "#93b4f4" : "#1a56db",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor:
                      resending || !resendEmail.trim()
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {resending ? "Sending..." : "Resend verification email"}
                </button>
              </form>
            )}

            <p
              style={{
                marginTop: 20,
                fontSize: 14,
                color: "#6b7280",
              }}
            >
              <Link
                href="/login"
                style={{
                  color: "#1a56db",
                  textDecoration: "none",
                  fontWeight: 500,
                }}
              >
                Back to sign in
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
