// where: __tests__/auth-bypass.test.ts
// what:  Production-build guard for the SS-011 E2E_AUTH_BYPASS Credentials Provider.
//        Asserts that the Credentials Provider is registered ONLY when
//        process.env.E2E_AUTH_BYPASS === "1".
// why:   The bypass exists for Playwright. If it ever leaked into production it
//        would let any caller mint a session by POSTing an email — a critical
//        auth bypass. This test is the production safety net.

import { describe, expect, it } from "vitest";
import {
  buildE2EBypassProviders,
  isE2EAuthBypassEnabled,
} from "@/lib/auth-bypass";

describe("E2E_AUTH_BYPASS guard", () => {
  it("isE2EAuthBypassEnabled is true only for the literal '1'", () => {
    expect(isE2EAuthBypassEnabled({ E2E_AUTH_BYPASS: "1" })).toBe(true);
    expect(isE2EAuthBypassEnabled({ E2E_AUTH_BYPASS: "0" })).toBe(false);
    expect(isE2EAuthBypassEnabled({ E2E_AUTH_BYPASS: "true" })).toBe(false);
    expect(isE2EAuthBypassEnabled({ E2E_AUTH_BYPASS: "" })).toBe(false);
    expect(isE2EAuthBypassEnabled({})).toBe(false);
  });

  it("does NOT register Credentials Provider in production-like env", () => {
    const providers = buildE2EBypassProviders({
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);
    expect(providers).toHaveLength(0);
  });

  it("does NOT register Credentials Provider when E2E_AUTH_BYPASS is unset", () => {
    expect(buildE2EBypassProviders({} as NodeJS.ProcessEnv)).toHaveLength(0);
  });

  it("does NOT register Credentials Provider for non-'1' truthy strings", () => {
    for (const value of ["0", "true", "yes", "on", "TRUE"]) {
      const providers = buildE2EBypassProviders({
        E2E_AUTH_BYPASS: value,
      } as NodeJS.ProcessEnv);
      expect(providers).toHaveLength(0);
    }
  });

  it("registers Credentials Provider exactly when E2E_AUTH_BYPASS=1", () => {
    const providers = buildE2EBypassProviders({
      E2E_AUTH_BYPASS: "1",
    } as NodeJS.ProcessEnv);
    // The guard's essence is "registered or not"; the literal `type` field
    // depends on @auth/core internals and is not load-bearing here.
    expect(providers).toHaveLength(1);
  });
});
