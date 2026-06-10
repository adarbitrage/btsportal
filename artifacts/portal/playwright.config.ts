import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const PORTAL_BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:25265";
// The raw API origin the auth helper and the vite proxy talk to. Keep the port
// here in lockstep with the proxy target in vite.config.ts and AUTH_URL in
// tests/e2e/auth.ts.
const API_AUTH_URL = process.env.E2E_AUTH_URL ?? "http://127.0.0.1:8080";

const PORTAL_PORT = Number(new URL(PORTAL_BASE_URL).port || "25265");
const API_PORT = Number(new URL(API_AUTH_URL).port || "8080");

// When E2E_NO_WEBSERVER is set we assume the API + portal are already running
// (e.g. you started them by hand) and skip booting our own. Otherwise the two
// servers below are started/stopped automatically by `playwright test`, so the
// whole suite runs from a single command. Set REDIS_URL in the environment
// before running to exercise the Redis-backed flows (rate-limiter etc.) that
// otherwise skip themselves.
const manageServers = !process.env.E2E_NO_WEBSERVER;

function resolveSystemChromium(): string | undefined {
  const candidates = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const found = execSync("command -v chromium", { encoding: "utf8" }).trim();
    if (found) return found;
  } catch {
    /* not on PATH */
  }
  return undefined;
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: PORTAL_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  // Boot the API server (8080) and the portal dev server (25265) automatically
  // so the whole suite runs from one command (`pnpm --filter @workspace/portal
  // run test:e2e`). Both run in development mode: the API only sets a `secure`
  // auth cookie under NODE_ENV=production, and the helper injects it over plain
  // http, so production mode would silently drop the login cookie. Any REDIS_URL
  // present in the environment is inherited by the API process, which enables
  // the Redis-backed worker/rate-limiter flows. Set E2E_NO_WEBSERVER=1 to run
  // against servers you started by hand instead.
  webServer: manageServers
    ? [
        {
          command:
            "pnpm --filter @workspace/api-server exec tsx ./src/index.ts",
          port: API_PORT,
          env: { PORT: String(API_PORT), NODE_ENV: "development" },
          reuseExistingServer: true,
          stdout: "pipe",
          stderr: "pipe",
          timeout: 120_000,
        },
        {
          command: "pnpm --filter @workspace/portal run dev",
          url: PORTAL_BASE_URL,
          env: { PORT: String(PORTAL_PORT), NODE_ENV: "development" },
          reuseExistingServer: true,
          stdout: "pipe",
          stderr: "pipe",
          timeout: 120_000,
        },
      ]
    : undefined,
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // On Replit/NixOS the bundled playwright chromium can't find the
          // host's mesa/glib libs, so prefer the system chromium when it
          // exists. Override with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
            resolveSystemChromium(),
          args: ["--no-sandbox"],
        },
      },
    },
  ],
});
