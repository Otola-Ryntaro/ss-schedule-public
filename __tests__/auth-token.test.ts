// where: __tests__/auth-token.test.ts
// what:  Tests for lib/auth-token.ts's direct JWT cookie read.
// why:   Vercel serves HTTPS, so Auth.js writes __Secure-authjs.session-token.
//        next-auth/jwt getToken() must receive secureCookie:true or it looks for
//        the local-dev cookie name and returns null.
//
// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getTokenMock = vi.fn();

vi.mock("next-auth/jwt", () => ({
  getToken: (...args: unknown[]) => getTokenMock(...args),
}));

const ORIGINAL_AUTH_GOOGLE_ID = process.env.AUTH_GOOGLE_ID;
const ORIGINAL_AUTH_GOOGLE_SECRET = process.env.AUTH_GOOGLE_SECRET;
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.AUTH_GOOGLE_ID = "google-client-id";
  process.env.AUTH_GOOGLE_SECRET = "google-client-secret";
  process.env.AUTH_SECRET = "test-secret";
  getTokenMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_AUTH_GOOGLE_ID === undefined) delete process.env.AUTH_GOOGLE_ID;
  else process.env.AUTH_GOOGLE_ID = ORIGINAL_AUTH_GOOGLE_ID;
  if (ORIGINAL_AUTH_GOOGLE_SECRET === undefined) {
    delete process.env.AUTH_GOOGLE_SECRET;
  } else {
    process.env.AUTH_GOOGLE_SECRET = ORIGINAL_AUTH_GOOGLE_SECRET;
  }
  if (ORIGINAL_AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
});

function makeRequest(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

describe("getCalendarAccessToken", () => {
  it("uses secure Auth.js cookie names for HTTPS requests", async () => {
    getTokenMock.mockResolvedValueOnce({
      accessToken: "ya29.fake",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
    const { getCalendarAccessToken } = await import("@/lib/auth-token");
    await expect(
      getCalendarAccessToken(
        makeRequest("https://app.example.com/api/calendar/list"),
      ),
    ).resolves.toBe("ya29.fake");
    expect(getTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ secureCookie: true, secret: "test-secret" }),
    );
  });

  it("uses secure Auth.js cookie names behind HTTPS proxies", async () => {
    getTokenMock.mockResolvedValueOnce({
      accessToken: "ya29.fake",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
    const { getCalendarAccessToken } = await import("@/lib/auth-token");
    await getCalendarAccessToken(
      makeRequest("http://app.example.com/api/calendar/list", {
        "x-forwarded-proto": "https",
      }),
    );
    expect(getTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ secureCookie: true }),
    );
  });

  it("uses local-dev Auth.js cookie names for HTTP requests", async () => {
    getTokenMock.mockResolvedValueOnce({
      accessToken: "ya29.fake",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
    const { getCalendarAccessToken } = await import("@/lib/auth-token");
    await getCalendarAccessToken(
      makeRequest("http://localhost:3000/api/calendar/list"),
    );
    expect(getTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ secureCookie: false }),
    );
  });

  it("refreshes an expired Google access token from the JWT refresh token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "ya29.refreshed",
        expires_in: 3600,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    getTokenMock.mockResolvedValueOnce({
      accessToken: "ya29.expired",
      expiresAt: Math.floor(Date.now() / 1000) - 60,
      refreshToken: "refresh-token",
    });

    const { getCalendarAccessToken } = await import("@/lib/auth-token");
    await expect(
      getCalendarAccessToken(
        makeRequest("https://app.example.com/api/calendar/list", {
          authorization: "Bearer encrypted-session-token",
        }),
      ),
    ).resolves.toBe("ya29.refreshed");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({
        method: "POST",
        body: expect.any(URLSearchParams),
      }),
    );
    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("client_id")).toBe("google-client-id");
    expect(body.get("client_secret")).toBe("google-client-secret");
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-token");
  });

  it("throws unauthenticated when getToken cannot find a session JWT", async () => {
    getTokenMock.mockResolvedValueOnce(null);
    const { getCalendarAccessToken } = await import("@/lib/auth-token");
    await expect(
      getCalendarAccessToken(
        makeRequest("https://app.example.com/api/calendar/list"),
      ),
    ).rejects.toThrow("unauthenticated");
  });
});
