// where: e2e/helpers/auth.ts
// what:  Playwright helpers for the SS-011 E2E auth bypass. Uses the
//        E2E_AUTH_BYPASS Credentials Provider via the standard Auth.js v5
//        sign-in flow (CSRF token → POST /api/auth/callback/credentials).
// why:   Going through the real Auth.js endpoints means we exercise the same
//        cookie-issuing path the browser uses, so route guards (proxy.ts) and
//        getToken() in API routes behave identically to a real session.
//        Hand-crafting an encrypted JWT cookie would be brittle across
//        @auth/core upgrades; this approach is stable.

import { test as base, type Page } from "@playwright/test";

/**
 * Sign the page's request context in via the E2E_AUTH_BYPASS Credentials
 * Provider. Performs the two-step Auth.js v5 flow: CSRF token then credentials
 * callback POST. After this returns, the page's BrowserContext holds the
 * `next-auth.session-token` cookie.
 */
export async function signInWithBypass(
  page: Page,
  email = "e2e@example.com",
): Promise<void> {
  // Precheck: surface "wrong dev server" early. If a developer has `bun dev`
  // running locally without E2E_AUTH_BYPASS=1, Playwright reuses it (per
  // `reuseExistingServer: !process.env.CI`) and credentials sign-in silently
  // fails with a cryptic CSRF / 405. Asserting `credentials` is registered
  // on /api/auth/providers turns that into an actionable error.
  const probe = await page.request.get("/api/auth/providers");
  if (probe.ok()) {
    const providers = (await probe.json()) as Record<string, unknown>;
    if (!("credentials" in providers)) {
      throw new Error(
        "E2E precheck failed: /api/auth/providers does not include 'credentials'. " +
          "A reused dev server was started without E2E_AUTH_BYPASS=1. " +
          "Stop it and let Playwright launch its own webServer.",
      );
    }
  }

  // Step 1: fetch CSRF token. Auth.js sets the csrf cookie as a side effect.
  const csrfResp = await page.request.get("/api/auth/csrf");
  if (!csrfResp.ok()) {
    throw new Error(
      `csrf endpoint failed: ${csrfResp.status()} ${await csrfResp.text()}`,
    );
  }
  const { csrfToken } = (await csrfResp.json()) as { csrfToken: string };

  // Step 2: POST credentials. `json=true` makes Auth.js return JSON instead of
  // a 302 redirect, which keeps the request context happy without follow-ups.
  const params = new URLSearchParams({
    csrfToken,
    email,
    callbackUrl: "/",
    json: "true",
  });
  const signInResp = await page.request.post(
    "/api/auth/callback/credentials",
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: params.toString(),
    },
  );
  if (!signInResp.ok()) {
    throw new Error(
      `credentials sign-in failed: ${signInResp.status()} ${await signInResp.text()}`,
    );
  }
}

/**
 * Test fixture providing an authenticated page. Use as:
 *
 *   import { test, expect } from "./helpers/auth";
 *   test("...", async ({ authedPage }) => { ... });
 */
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    await signInWithBypass(page);
    await use(page);
  },
});

export { expect } from "@playwright/test";
