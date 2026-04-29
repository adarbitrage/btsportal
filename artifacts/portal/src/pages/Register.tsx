import { useCallback, useRef, useState } from "react";
import { useAuth, type RegisterError } from "@/lib/auth";
import { Link } from "wouter";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as
  | string
  | undefined;

export default function Register() {
  const { register, resendVerificationEmail } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Once the server accepts the signup we show a generic confirmation
  // instead of navigating into the app. The endpoint is intentionally
  // enumeration-resistant: it returns the same message whether the email
  // is brand new or already in use, so we can't (and shouldn't) tell the
  // user which case happened.
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState("");
  const [resendError, setResendError] = useState("");
  const turnstileRef = useRef<TurnstileHandle | null>(null);

  const handleCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Password must be at least 8 characters with at least 1 letter and 1 number");
      return;
    }

    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError("Please complete the challenge below before continuing.");
      return;
    }

    setLoading(true);
    try {
      const message = await register(
        name,
        email,
        password,
        captchaToken || undefined,
      );
      setConfirmation(message);
      setSubmittedEmail(email);
    } catch (err: any) {
      setError(err.message);
      // Keep the Turnstile token across a 429: the per-IP rate limiter on
      // the backend runs BEFORE captcha verification, so on a rate-limit
      // hit the token was never sent to Cloudflare and remains valid for a
      // retry. Reset it on any other failure (CAPTCHA_INVALID, server
      // error, validation rejection after captcha was already verified)
      // because Turnstile tokens are single-use once siteverify consumes
      // them. (See `routes/auth.ts` — middleware ordering doc.) When we do
      // clear the token, also reset the widget so a fresh challenge appears
      // instead of leaving the user with a "solved" widget but a disabled
      // submit button.
      const code = (err as RegisterError | undefined)?.code;
      if (code !== "RATE_LIMIT_EXCEEDED") {
        setCaptchaToken("");
        turnstileRef.current?.reset();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!submittedEmail || resending) return;
    setResending(true);
    setResendNotice("");
    setResendError("");
    try {
      const message = await resendVerificationEmail(submittedEmail);
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

  const inputStyle = {
    width: "100%",
    padding: "10px 14px",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box" as const,
    transition: "border-color 0.15s",
  };

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
          }}>{submittedEmail ? "Check your inbox" : "Create Account"}</h1>
          <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>
            {submittedEmail
              ? "We've sent the next step to your email."
              : "Join the BTS member community"}
          </p>
        </div>

        {submittedEmail ? (
          <div>
            <div style={{
              padding: "16px 18px",
              background: "#f0f9ff",
              border: "1px solid #bae6fd",
              borderRadius: 8,
              color: "#075985",
              fontSize: 14,
              marginBottom: 20,
              lineHeight: 1.5,
            }}>
              {confirmation}
            </div>
            <p style={{ fontSize: 14, color: "#374151", margin: "0 0 8px" }}>
              We just sent a message to <strong>{submittedEmail}</strong>. Open it
              and follow the link to finish.
            </p>
            <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 16px" }}>
              Don't see it? Check your spam folder, then try again in a few minutes.
            </p>
            {resendNotice ? (
              <div
                data-testid="register-resend-verification-notice"
                style={{
                  padding: "10px 14px",
                  background: "#ecfdf5",
                  border: "1px solid #a7f3d0",
                  borderRadius: 8,
                  color: "#065f46",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {resendNotice}
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={resending}
                  data-testid="register-resend-verification-button"
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: resending ? "#93b4f4" : "#1a56db",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: resending ? "not-allowed" : "pointer",
                    textDecoration: "underline",
                    fontFamily: "inherit",
                  }}
                >
                  {resending ? "Sending..." : "Didn't get the email? Resend it"}
                </button>
                {resendError && (
                  <div
                    data-testid="register-resend-verification-error"
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
              </div>
            )}
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

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
              Full Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = "#1a56db"}
              onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
              placeholder="Your full name"
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = "#1a56db"}
              onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
              placeholder="you@example.com"
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = "#1a56db"}
              onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
              placeholder="Min 8 chars, 1 letter, 1 number"
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = "#1a56db"}
              onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
              placeholder="Confirm your password"
            />
          </div>

          {TURNSTILE_SITE_KEY && (
            <div style={{ marginBottom: 20, display: "flex", justifyContent: "center" }}>
              <Turnstile
                ref={turnstileRef}
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
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>
        )}

        <p style={{
          textAlign: "center",
          marginTop: 24,
          fontSize: 14,
          color: "#6b7280",
        }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "#1a56db", textDecoration: "none", fontWeight: 500 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
