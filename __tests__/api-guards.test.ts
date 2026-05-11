// where: __tests__/api-guards.test.ts
// what:  Tests for the shared route guards: requireSameOrigin, requireAuth, requireRateLimit.
// why:   These wrap assertSameOrigin, auth(), and checkRate to a uniform "Response | value"
//        shape so /api/extract and /api/calendar/* can share guard logic without re-implementing
//        the narrow + try/catch boilerplate.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
const getTokenMock = vi.fn();
vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));
vi.mock("next-auth/jwt", () => ({
  getToken: (...args: unknown[]) => getTokenMock(...args),
}));

import { requireAuth, requireRateLimit, requireSameOrigin } from "@/lib/api-guards";
import { _resetForTests } from "@/lib/rate-limit";

const ORIGINAL_AUTH_URL = process.env.AUTH_URL;

beforeEach(() => {
  process.env.AUTH_URL = "https://app.example.com";
  authMock.mockReset();
  getTokenMock.mockReset();
  _resetForTests();
});

afterEach(() => {
  if (ORIGINAL_AUTH_URL === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = ORIGINAL_AUTH_URL;
});

function makeReq(headers: Record<string, string>): NextRequest {
  return new NextRequest("https://app.example.com/api/test", {
    method: "POST",
    headers,
  });
}

describe("requireSameOrigin", () => {
  it("returns null when origin matches AUTH_URL", () => {
    const req = makeReq({
      origin: "https://app.example.com",
      "sec-fetch-site": "same-origin",
    });
    expect(requireSameOrigin(req)).toBeNull();
  });

  it("returns 403 Response when origin is cross-site", () => {
    const req = makeReq({
      origin: "https://evil.example.com",
      "sec-fetch-site": "cross-site",
    });
    const result = requireSameOrigin(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it("returns 403 Response when both origin and sec-fetch-site are missing", () => {
    const req = makeReq({});
    const result = requireSameOrigin(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });
});

describe("requireAuth", () => {
  it("returns { email } when session has a user email", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    const result = await requireAuth();
    expect(result).toEqual({ email: "u@example.com", mode: "cookie" });
  });

  it("returns bearer mode when Authorization carries a valid Auth.js token", async () => {
    getTokenMock.mockResolvedValueOnce({ email: "extension@example.com" });
    const result = await requireAuth(
      makeReq({ authorization: "Bearer encrypted-session-token" }),
    );
    expect(result).toEqual({
      email: "extension@example.com",
      mode: "bearer",
    });
    expect(authMock).not.toHaveBeenCalled();
  });

  it("returns 401 Response when session is null", async () => {
    authMock.mockResolvedValueOnce(null);
    const result = await requireAuth();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns 401 Response when session has no email", async () => {
    authMock.mockResolvedValueOnce({ user: {} });
    const result = await requireAuth();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns 401 Response when session.user is missing", async () => {
    authMock.mockResolvedValueOnce({});
    const result = await requireAuth();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});

describe("requireRateLimit", () => {
  it("returns null when under the limit", () => {
    const result = requireRateLimit("u@example.com");
    expect(result).toBeNull();
  });

  it("returns 429 Response after the configured limit is exceeded", () => {
    // Default limit is 10/minute. Hit it 10 times, then expect rejection.
    for (let i = 0; i < 10; i++) {
      expect(requireRateLimit("rate@example.com")).toBeNull();
    }
    const result = requireRateLimit("rate@example.com");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(429);
  });
});
