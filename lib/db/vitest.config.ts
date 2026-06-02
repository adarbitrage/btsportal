import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Apply the idempotent companion SQL migrations to the dev DB before the
    // drift tests run, so a fresh/drifted DB stops failing for the
    // schema-rename foot-gun. Migrations-only (no push-force) so genuine
    // drift is still detected. See vitest.globalSetup.ts.
    globalSetup: ["./vitest.globalSetup.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
