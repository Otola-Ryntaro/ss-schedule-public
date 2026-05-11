import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // SS-011: E2E_AUTH_BYPASS gates the Credentials Provider in auth.ts so Playwright
    // can sign in without real Google OAuth. AUTH_SECRET is required for JWT signing
    // even with Credentials; we use a fixed dev value here so the dev server boots
    // cleanly under CI even when .env.local is absent.
    env: {
      E2E_AUTH_BYPASS: "1",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-test-secret-do-not-use-in-prod",
      // Stub Google credentials so Auth.js initialisation does not throw if the
      // dev environment lacks them. The Google provider is never exercised by
      // E2E tests, so these values are inert.
      AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID ?? "e2e-stub-id",
      AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET ?? "e2e-stub-secret",
    },
  },
});
