// where: __tests__/api-auth-status.test.ts
// what:  Tests for GET /api/auth/status — the "is my Google connection still alive?" probe.
// why:   The route must always answer 200 with an { ok } discriminator so the header
//        button can render a state without status-code branching. A dead Google token
//        (refresh token expired) must surface as ok:false, not as an unhandled throw.
//
// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
const getTokenMock = vi.fn();
const listCalendarsMock = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/auth-token", () => ({
  getAuthBearerEmail: () => null,
  getCalendarAccessToken: (...args: unknown[]) => getTokenMock(...args),
}));

vi.mock("@/lib/google-calendar", () => ({
  listCalendars: (...args: unknown[]) => listCalendarsMock(...args),
}));

const ORIGINAL_AUTH_URL = process.env.AUTH_URL;

beforeEach(() => {
  process.env.AUTH_URL = "https://app.example.com";
  authMock.mockReset();
  getTokenMock.mockReset();
  listCalendarsMock.mockReset();
});

afterEach(() => {
  if (ORIGINAL_AUTH_URL === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = ORIGINAL_AUTH_URL;
  vi.resetModules();
});

async function loadRoute() {
  const mod = await import("@/app/api/auth/status/route");
  return mod.GET as (req: NextRequest) => Promise<Response>;
}

function makeRequest(): NextRequest {
  return new NextRequest("https://app.example.com/api/auth/status", {
    method: "GET",
    headers: { origin: "https://app.example.com" },
  });
}

describe("GET /api/auth/status", () => {
  it("returns 200 ok:true when the access token works against Google", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockResolvedValueOnce("ya29.fake");
    listCalendarsMock.mockResolvedValueOnce([]);
    const GET = await loadRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 200 ok:false reason:unauthenticated when no session", async () => {
    authMock.mockResolvedValueOnce(null);
    const GET = await loadRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("returns 200 ok:false reason:token_expired when the refresh token is dead", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockRejectedValueOnce(new Error("refresh_access_token_error"));
    const GET = await loadRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "token_expired" });
  });

  it("returns 200 ok:false reason:calendar_error when the Google API call fails", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockResolvedValueOnce("ya29.fake");
    listCalendarsMock.mockRejectedValueOnce(new Error("network down"));
    const GET = await loadRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "calendar_error" });
  });

  it("sets Cache-Control: private, no-store", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getTokenMock.mockResolvedValueOnce("ya29.fake");
    listCalendarsMock.mockResolvedValueOnce([]);
    const GET = await loadRoute();
    const res = await GET(makeRequest());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
