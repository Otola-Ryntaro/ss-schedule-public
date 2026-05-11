// where: __tests__/rate-limit.test.ts
// what:  Tests for the pure in-memory rate-limit helper extracted from /api/extract.
// why:   The function is pure (no IO, no SDK). _resetForTests() lets each test start
//        with a clean Map, avoiding vi.resetModules() churn used elsewhere.

import { beforeEach, describe, expect, it } from "vitest";
import { _resetForTests, checkRate } from "@/lib/rate-limit";

beforeEach(() => {
  _resetForTests();
});

describe("checkRate", () => {
  it("allows up to max requests within the window", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(checkRate("u@example.com", now + i, 5, 60_000)).toBe(true);
    }
  });

  it("rejects the (max+1)th request inside the window", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(checkRate("u@example.com", now + i, 5, 60_000)).toBe(true);
    }
    expect(checkRate("u@example.com", now + 6, 5, 60_000)).toBe(false);
  });

  it("allows again once old entries fall out of the window", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(checkRate("u@example.com", now + i, 5, 60_000)).toBe(true);
    }
    // Advance past the window — all previous entries are now stale.
    expect(checkRate("u@example.com", now + 60_001, 5, 60_000)).toBe(true);
  });

  it("isolates buckets per key", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(checkRate("a@example.com", now + i, 5, 60_000)).toBe(true);
    }
    // Different key should still be allowed.
    expect(checkRate("b@example.com", now, 5, 60_000)).toBe(true);
  });

  it("filters stale entries when checking the same bucket", () => {
    const now = 1_000_000;
    // Fill bucket to max with timestamps that will all age out by `now + windowMs`.
    for (let i = 0; i < 5; i++) {
      expect(checkRate("u@example.com", now + i, 5, 60_000)).toBe(true);
    }
    // Within window: rejected.
    expect(checkRate("u@example.com", now + 100, 5, 60_000)).toBe(false);
    // Past window: stale entries filtered, request allowed.
    expect(checkRate("u@example.com", now + 60_001, 5, 60_000)).toBe(true);
  });
});
