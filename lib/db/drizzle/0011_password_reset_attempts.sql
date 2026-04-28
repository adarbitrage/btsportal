-- Tracks recent password-reset request attempts so we can rate-limit
-- POST /auth/forgot-password per email address and per source IP.
-- One row is inserted per dimension (email + ip) for each accepted
-- attempt inside the same transaction that counts existing attempts,
-- guarded by Postgres advisory locks on the email/ip keys so concurrent
-- requests targeting the same identifier cannot bypass the cap.
-- The identifier value is sha256-hashed so we don't store the raw email
-- addresses or IPs of people who never had an account here.
-- Idempotent so it is safe to re-run against a database that already
-- has the table from `drizzle-kit push`.
CREATE TABLE IF NOT EXISTS "password_reset_attempts" (
    "id" serial PRIMARY KEY NOT NULL,
    "identifier_type" varchar(8) NOT NULL,
    "identifier_hash" varchar(64) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_attempts_identifier_created_idx"
    ON "password_reset_attempts" ("identifier_type", "identifier_hash", "created_at");
