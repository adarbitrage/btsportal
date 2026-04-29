import { useCallback, useState } from "react";
import { Link } from "wouter";
import { Turnstile } from "@/components/Turnstile";

const API_BASE = `${import.meta.env.BASE_URL}api`;
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as
  | string
  | undefined;

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError("Please complete the challenge below before continuing.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ...(captchaToken ? { captchaToken } : {}),
        }),
      });

      if (!res.ok) {
        let message = "We couldn't send your reset link. Please try again.";
        try {
          const body = await res.json();
          const code = body?.error?.code;
          if (code === "CAPTCHA_REQUIRED" || code === "CAPTCHA_INVALID") {
            message = "Please complete the challenge below and try again.";
          }
        } catch {
          // ignore — fall through to generic message
        }
        setError(message);
        setCaptchaToken("");
        return;
      }

      setSent(true);
    } catch {
      setError("We couldn't reach the server. Please try again.");
      setCaptchaToken("");
    } finally {
      setLoading(false);
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
          }}>Reset Password</h1>
          <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>
            Enter your email and we'll send you a reset link
          </p>
        </div>

        {sent ? (
          <div style={{
            padding: "16px",
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: 8,
            color: "#166534",
            fontSize: 14,
            textAlign: "center",
            lineHeight: 1.5,
          }}>
            If an account exists with that email, we've sent a password reset link. Check your inbox.
          </div>
        ) : (
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

            <div style={{ marginBottom: 24 }}>
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
                }}
                onFocus={(e) => e.target.style.borderColor = "#1a56db"}
                onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
                placeholder="you@example.com"
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
              }}
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>
          </form>
        )}

        <p style={{
          textAlign: "center",
          marginTop: 24,
          fontSize: 14,
          color: "#6b7280",
        }}>
          <Link href="/login" style={{ color: "#1a56db", textDecoration: "none", fontWeight: 500 }}>
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
