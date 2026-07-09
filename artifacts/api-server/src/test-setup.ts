// The money-endpoint rate limiters (billingUserLimiter / billingIpLimiter) now
// enforce a bounded in-memory sliding window whenever Redis is unavailable —
// which is the case in this suite: the billing test files mock ../lib/redis so
// getRedis() returns null, routing every request through the in-memory
// fallback. All requests share the loopback IP (127.0.0.1), so across a single
// test file the per-IP default (20/10 min) is exceeded and unrelated
// assertions start seeing 429s.
//
// The limiters read their limits from process.env at request time, so raising
// the ceilings here neutralizes the limiter for the whole suite regardless of
// how many module instances exist (vi.mock re-evaluates the middleware per test
// file, so a shared beforeEach reset would touch the wrong in-memory store).
// No billing test asserts a 429 from these limiters; a test that wants to
// exercise blocking can still override these env values at request time.
process.env.BILLING_RATE_LIMIT_USER_MAX ??= "1000000";
process.env.BILLING_RATE_LIMIT_IP_MAX ??= "1000000";

// Dev outbound suppression gate (see lib/email-transport.ts).
// Setting "*" means "let everything through", so all existing tests that mock
// sgMail.send / twilioClient.messages.create continue to receive the real call
// through the gate without any test-specific setup.  A test that wants to
// exercise the gate itself can temporarily override or delete these values.
process.env.DEV_EMAIL_ALLOWLIST ??= "*";
process.env.DEV_SMS_ALLOWLIST ??= "*";
