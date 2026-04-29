import { useCallback, useState } from "react";
import { useAuth, type LoginError } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { Turnstile } from "@/components/Turnstile";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as
  | string
  | undefined;

function getInitialEmail(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("email") ?? "";
}

export default function Login() {
  const { login, resendVerificationEmail } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState(getInitialEmail);
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [error, setError] = useState("");
  const [emailRecentlyChanged, setEmailRecentlyChanged] = useState(false);
  const [emailUnverified, setEmailUnverified] = useState(false);
  const [unverifiedMessage, setUnverifiedMessage] = useState("");
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState("");
  const [resendError, setResendError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setEmailRecentlyChanged(false);
    setEmailUnverified(false);
    setUnverifiedMessage("");
    setResendNotice("");
    setResendError("");

    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError("Please complete the challenge below before continuing.");
      return;
    }

    setLoading(true);

    try {
      await login(email, password, captchaToken || undefined);
      navigate("/");
    } catch (err) {
      const loginErr = err as LoginError;
      if (loginErr.emailUnverified) {
        // Surface the verification-specific banner instead of the generic
        // red error block — the user's password was correct, the only
        // thing missing is clicking the link in their inbox.
        setEmailUnverified(true);
        setUnverifiedMessage(loginErr.message);
        setUnverifiedEmail(email);
      } else {
        setError(loginErr.message);
      }
      if (loginErr.emailRecentlyChanged) {
        setEmailRecentlyChanged(true);
      }
      // Reset the captcha token after any failure so the user re-solves the
      // widget before the next attempt — Turnstile tokens are single-use.
      setCaptchaToken("");
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!unverifiedEmail || resending) return;
    setResending(true);
    setResendNotice("");
    setResendError("");
    try {
      const message = await resendVerificationEmail(unverifiedEmail);
      setResendNotice(message);
    } catch (err) {
      const e = err as Error;
      setResendError(
        e.message ||
          "Could not resend the verification email. Please try again in a few minutes.",
      );
    } finally {
      setResending(false);
    }
  };

  const submitDisabled =
    loading || (TURNSTILE_SITE_KEY ? !captchaToken : false);

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#faf9f7",
      fontFamily: "Roboto, sans-serif",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 420,
        padding: "48px 40px",
        background: "white",
        borderRadius: 16,
        border: "1px solid #e8e4dc",
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img
            src={`${import.meta.env.BASE_URL}images/bts-logo.png`}
            alt="Build Test Scale"
            style={{ height: 48, marginBottom: 16 }}
          />
          <h1 style={{
            fontSize: 24,
            fontWeight: 700,
            color: "#1a1a1a",
            margin: "0 0 8px",
          }}>Welcome Back</h1>
          <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>
            Sign in to your member portal
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div style={{
              padding: "12px 16px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              color: "#dc2626",
              fontSize: 14,
              marginBottom: 20,
            }}>
              {error}
            </div>
          )}

          {emailUnverified && (
            <div
              role="status"
              data-testid="email-unverified-hint"
              style={{
                padding: "14px 16px",
                background: "#fef9c3",
                border: "1px solid #fde68a",
                borderRadius: 8,
                color: "#854d0e",
                fontSize: 14,
                marginBottom: 20,
                lineHeight: 1.5,
              }}
            >
              <div style={{ marginBottom: 12 }}>
                {unverifiedMessage ||
                  "Your account isn't verified yet. Check your inbox for the verification link, or request a new one below."}
              </div>
              {resendNotice ? (
                <div
                  data-testid="resend-verification-notice"
                  style={{
                    padding: "8px 12px",
                    background: "#ecfdf5",
                    border: "1px solid #a7f3d0",
                    borderRadius: 6,
                    color: "#065f46",
                    fontSize: 13,
                  }}
                >
                  {resendNotice}
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resending}
                    data-testid="resend-verification-button"
                    style={{
                      padding: "8px 14px",
                      background: resending ? "#fde68a" : "#854d0e",
                      color: resending ? "#854d0e" : "white",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: resending ? "not-allowed" : "pointer",
                    }}
                  >
                    {resending ? "Sending..." : "Resend verification email"}
                  </button>
                  {resendError && (
                    <div
                      data-testid="resend-verification-error"
                      style={{
                        marginTop: 10,
                        padding: "8px 12px",
                        background: "#fef2f2",
                        border: "1px solid #fecaca",
                        borderRadius: 6,
                        color: "#dc2626",
                        fontSize: 13,
                      }}
                    >
                      {resendError}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {emailRecentlyChanged && (
            <div
              role="status"
              data-testid="email-recently-changed-hint"
              style={{
                padding: "12px 16px",
                background: "#fef9c3",
                border: "1px solid #fde68a",
                borderRadius: 8,
                color: "#854d0e",
                fontSize: 14,
                marginBottom: 20,
                lineHeight: 1.5,
              }}
            >
              Looks like you changed your email recently — try signing in with
              your new address. We sent you a confirmation when the change went
              through; check your inbox if you can't remember it.
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <label style={{
              display: "block",
              fontSize: 13,
              fontWeight: 500,
              color: "#374151",
              marginBottom: 6,
            }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 14px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontSize: 15,
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => e.target.style.borderColor = "#1a56db"}
              onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
              placeholder="you@example.com"
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <label style={{
                fontSize: 13,
                fontWeight: 500,
                color: "#374151",
              }}>Password</label>
              <Link href="/forgot-password" style={{
                fontSize: 13,
                color: "#1a56db",
                textDecoration: "none",
              }}>Forgot password?</Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 14px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontSize: 15,
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => e.target.style.borderColor = "#1a56db"}
              onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
              placeholder="Enter your password"
            />
          </div>

          {TURNSTILE_SITE_KEY && (
            <div style={{ marginBottom: 20, display: "flex", justifyContent: "center" }}>
              <Turnstile
                siteKey={TURNSTILE_SITE_KEY}
                onToken={handleCaptchaToken}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={submitDisabled}
            style={{
              width: "100%",
              padding: "12px",
              background: submitDisabled ? "#93b4f4" : "#1a56db",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: submitDisabled ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p style={{
          textAlign: "center",
          marginTop: 24,
          fontSize: 14,
          color: "#6b7280",
        }}>
          Don't have an account?{" "}
          <Link href="/register" style={{ color: "#1a56db", textDecoration: "none", fontWeight: 500 }}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
