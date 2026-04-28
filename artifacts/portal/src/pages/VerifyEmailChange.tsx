import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL}api`;

type Status = "verifying" | "success" | "error" | "missing";

export default function VerifyEmailChange() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<Status>("verifying");
  const [message, setMessage] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setStatus("missing");
      setMessage("This verification link is missing its token. Please use the link from your email.");
      return;
    }

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/verify-email-change`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus("error");
          setMessage(
            data?.error ||
              "We couldn't confirm this email change. The link may have expired or already been used.",
          );
          return;
        }
        setStatus("success");
        setNewEmail(data?.email || "");
        setMessage(
          data?.message ||
            "Your email address has been updated. Please sign in again with your new email.",
        );
      } catch (err) {
        setStatus("error");
        setMessage("Network error confirming the change. Please try again.");
      }
    })();
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#faf9f7",
        padding: "24px",
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
          <>
            <Loader2 className="animate-spin" style={{ width: 40, height: 40, color: "#1a56db", margin: "0 auto 16px" }} />
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              Confirming your new email
            </h1>
            <p style={{ color: "#666" }}>One moment...</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle2 style={{ width: 48, height: 48, color: "#16a34a", margin: "0 auto 16px" }} />
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Email updated</h1>
            {newEmail && (
              <p style={{ color: "#1a56db", fontWeight: 600, marginBottom: 12 }}>{newEmail}</p>
            )}
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
              Sign in with your new email
            </button>
          </>
        )}

        {(status === "error" || status === "missing") && (
          <>
            <AlertCircle style={{ width: 48, height: 48, color: "#dc2626", margin: "0 auto 16px" }} />
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              {status === "missing" ? "Missing verification token" : "Couldn't confirm change"}
            </h1>
            <p style={{ color: "#555", marginBottom: 24 }}>{message}</p>
            <Link
              href="/account"
              style={{
                display: "inline-block",
                background: "#1a56db",
                color: "#fff",
                borderRadius: 8,
                padding: "12px 24px",
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Go to Account
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
