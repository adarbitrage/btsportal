import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { CheckCircle2, AlertCircle } from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL}api`;

type Status = "form" | "success" | "missing";

function getInitialToken(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("token") ?? "";
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 15,
  outline: "none",
  boxSizing: "border-box",
};

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const [token] = useState(getInitialToken);
  const [status, setStatus] = useState<Status>(token ? "form" : "missing");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) setStatus("missing");
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Password must be at least 8 characters and include at least 1 letter and 1 number.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (typeof data?.error === "string" && data.error) ||
            data?.error?.message ||
            "We couldn't reset your password. The link may have expired.",
        );
        return;
      }
      setStatus("success");
    } catch {
      setError("We couldn't reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

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
          maxWidth: 420,
          padding: "48px 40px",
          background: "white",
          borderRadius: 16,
          border: "1px solid #e8e4dc",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img
            src={`${import.meta.env.BASE_URL}images/bts-logo.png`}
            alt="Build Test Scale"
            style={{ height: 48, marginBottom: 16 }}
          />
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a1a1a", margin: "0 0 8px" }}>
            {status === "success" ? "Password updated" : "Set a new password"}
          </h1>
          {status === "form" && (
            <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>
              Choose a new password for your account.
            </p>
          )}
        </div>

        {status === "success" && (
          <div style={{ textAlign: "center" }}>
            <CheckCircle2 style={{ width: 48, height: 48, color: "#16a34a", margin: "0 auto 16px" }} />
            <p style={{ color: "#555", marginBottom: 24, lineHeight: 1.5 }}>
              Your password has been updated. You can now sign in with your new password.
            </p>
            <button
              type="button"
              onClick={() => navigate("/login")}
              style={{
                width: "100%",
                padding: "12px",
                background: "#1a56db",
                color: "white",
                border: "none",
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Sign in
            </button>
          </div>
        )}

        {status === "missing" && (
          <div style={{ textAlign: "center" }}>
            <AlertCircle style={{ width: 48, height: 48, color: "#dc2626", margin: "0 auto 16px" }} />
            <p style={{ color: "#555", marginBottom: 24, lineHeight: 1.5 }}>
              This reset link is missing or invalid. Request a fresh link to continue.
            </p>
            <Link
              href="/forgot-password"
              style={{
                display: "inline-block",
                width: "100%",
                boxSizing: "border-box",
                padding: "12px",
                background: "#1a56db",
                color: "white",
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Request a new link
            </Link>
          </div>
        )}

        {status === "form" && (
          <form onSubmit={handleSubmit}>
            {error && (
              <div
                role="alert"
                style={{
                  padding: "12px 16px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  color: "#dc2626",
                  fontSize: 14,
                  marginBottom: 20,
                }}
              >
                {error}
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
                New password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="At least 8 characters"
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = "#1a56db")}
                onBlur={(e) => (e.target.style.borderColor = "#d1d5db")}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
                Confirm new password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="Re-enter your new password"
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = "#1a56db")}
                onBlur={(e) => (e.target.style.borderColor = "#d1d5db")}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "12px",
                background: loading ? "#93b4f4" : "#1a56db",
                color: "white",
                border: "none",
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Updating..." : "Update password"}
            </button>
          </form>
        )}

        <p style={{ textAlign: "center", marginTop: 24, fontSize: 14, color: "#6b7280" }}>
          <Link href="/login" style={{ color: "#1a56db", textDecoration: "none", fontWeight: 500 }}>
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
