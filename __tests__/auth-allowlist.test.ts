// where: __tests__/auth-allowlist.test.ts
// what:  Unit tests for email allowlist logic used in auth.ts signIn callback.

import { describe, expect, it } from "vitest";
import { getAllowedEmails, isEmailAllowed } from "@/lib/auth-allowlist";

describe("getAllowedEmails", () => {
  it("returns empty array when env is unset", () => {
    expect(getAllowedEmails({})).toEqual([]);
  });

  it("parses single email", () => {
    expect(getAllowedEmails({ ALLOWED_EMAILS: "user@example.com" })).toEqual([
      "user@example.com",
    ]);
  });

  it("parses comma-separated emails and trims whitespace", () => {
    expect(
      getAllowedEmails({ ALLOWED_EMAILS: "a@example.com , B@EXAMPLE.COM" }),
    ).toEqual(["a@example.com", "b@example.com"]);
  });

  it("ignores empty entries", () => {
    expect(getAllowedEmails({ ALLOWED_EMAILS: ",," })).toEqual([]);
  });
});

describe("isEmailAllowed", () => {
  it("denies when ALLOWED_EMAILS is unset (fail-closed)", () => {
    expect(isEmailAllowed("user@example.com", {})).toBe(false);
  });

  it("denies null / undefined email", () => {
    expect(isEmailAllowed(null, { ALLOWED_EMAILS: "user@example.com" })).toBe(false);
    expect(isEmailAllowed(undefined, { ALLOWED_EMAILS: "user@example.com" })).toBe(false);
  });

  it("allows exact match", () => {
    expect(
      isEmailAllowed("user@example.com", { ALLOWED_EMAILS: "user@example.com" }),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(
      isEmailAllowed("User@Example.COM", { ALLOWED_EMAILS: "user@example.com" }),
    ).toBe(true);
  });

  it("denies email not in the list", () => {
    expect(
      isEmailAllowed("other@example.com", { ALLOWED_EMAILS: "user@example.com" }),
    ).toBe(false);
  });

  it("allows any email in a comma-separated list", () => {
    const env = { ALLOWED_EMAILS: "a@x.com,b@x.com" };
    expect(isEmailAllowed("a@x.com", env)).toBe(true);
    expect(isEmailAllowed("b@x.com", env)).toBe(true);
    expect(isEmailAllowed("c@x.com", env)).toBe(false);
  });
});
