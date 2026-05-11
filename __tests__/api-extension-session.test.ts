// where: __tests__/api-extension-session.test.ts
// what:  Tests for /api/extension/session.
// why:   This endpoint is the Web login -> Chrome extension token bridge. It must
//        only return the raw encrypted session token for an authenticated Web user.
//
// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
const getRawSessionTokenMock = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/auth-token", () => ({
  getRawSessionToken: (...args: unknown[]) => getRawSessionTokenMock(...args),
}));

beforeEach(() => {
  authMock.mockReset();
  getRawSessionTokenMock.mockReset();
});

async function loadRoute() {
  const mod = await import("@/app/api/extension/session/route");
  return mod.GET as (req: NextRequest) => Promise<Response>;
}

function makeReq() {
  return new NextRequest("https://app.example.com/api/extension/session");
}

describe("GET /api/extension/session", () => {
  it("returns 401 when the Web session is missing", async () => {
    authMock.mockResolvedValueOnce(null);
    const GET = await loadRoute();
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 401 when the raw token cannot be read", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getRawSessionTokenMock.mockResolvedValueOnce(null);
    const GET = await loadRoute();
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns the raw token and no-store header for an authenticated user", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "u@example.com" } });
    getRawSessionTokenMock.mockResolvedValueOnce({
      email: "u@example.com",
      expiresAt: 123,
      token: "encrypted-session-token",
    });
    const GET = await loadRoute();
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    await expect(res.json()).resolves.toEqual({
      ok: true,
      email: "u@example.com",
      expiresAt: 123,
      token: "encrypted-session-token",
    });
  });
});
