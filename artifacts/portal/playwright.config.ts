import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const PORTAL_BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:25265";

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
