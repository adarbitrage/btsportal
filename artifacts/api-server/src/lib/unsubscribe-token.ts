// HMAC-signed one-click email-unsubscribe tokens (extracted from
// communication-service.ts in Task #1770).
//
// Lives in its own module — NOT in communication-service — because the
// scheduled-comms RSVP reminder needs to embed a coaching-specific
// unsubscribe URL in its email variables, and the scheduled-comms test
// suites mock the whole communication-service module (CommunicationService
// only). If token generation lived inside that module, every such test
// would crash on an undefined import. communication-service re-exports
// these for existing callers.
import crypto from "crypto";

const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || "bts-unsub-secret-change-me";

export function generateUnsubscribeToken(email: string): string {
  const hmac = crypto.createHmac("sha256", UNSUBSCRIBE_SECRET);
  hmac.update(email.toLowerCase());
  return hmac.digest("hex");
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = generateUnsubscribeToken(email);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}
