import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

const PURPOSE = "email_change_prefill" as const;

const DEFAULT_EXPIRES_IN = "14d";

export interface EmailChangePrefillPayload {
  userId: number;
  prefillEmail: string;
}

interface SignedPayload extends EmailChangePrefillPayload {
  purpose: typeof PURPOSE;
}

export function signEmailChangePrefillToken(
  payload: EmailChangePrefillPayload,
  options: { expiresIn?: string | number } = {},
): string {
  const body: SignedPayload = {
    purpose: PURPOSE,
    userId: payload.userId,
    prefillEmail: payload.prefillEmail.toLowerCase(),
  };
  return jwt.sign(body, JWT_SECRET, {
    expiresIn: options.expiresIn ?? DEFAULT_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyEmailChangePrefillToken(
  token: string,
): EmailChangePrefillPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as Partial<SignedPayload>;
    if (
      decoded?.purpose !== PURPOSE ||
      typeof decoded.userId !== "number" ||
      typeof decoded.prefillEmail !== "string" ||
      !decoded.prefillEmail
    ) {
      return null;
    }
    return {
      userId: decoded.userId,
      prefillEmail: decoded.prefillEmail.toLowerCase(),
    };
  } catch {
    return null;
  }
}

export function buildEmailChangeRestartUrl(
  portalUrl: string,
  token: string,
): string {
  const trimmed = portalUrl.replace(/\/+$/, "");
  return `${trimmed}/account?email_change_prefill=${encodeURIComponent(token)}`;
}
