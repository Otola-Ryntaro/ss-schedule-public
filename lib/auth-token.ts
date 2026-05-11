// where: lib/auth-token.ts
// what:  Server-only helper to fetch the Google Calendar access token from the JWT.
// why:   Per the Phase 7 design rule, the session callback must not expose accessToken.
//        Server routes call getCalendarAccessToken(req) which reads the JWT directly via
//        next-auth/jwt getToken({ req }). The signature requires NextRequest so callers
//        cannot accidentally use auth() (which goes through the client-safe session).

import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

type AuthTokenPayload = {
  email?: unknown;
  accessToken?: unknown;
  expiresAt?: unknown;
  error?: unknown;
  exp?: unknown;
  refreshToken?: unknown;
};

export function hasBearerToken(req: NextRequest): boolean {
  return req.headers.get("authorization")?.startsWith("Bearer ") === true;
}

export function shouldUseSecureCookie(req: NextRequest): boolean {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim() === "https";
  }
  return req.nextUrl.protocol === "https:";
}

async function getDecodedToken(req: NextRequest): Promise<AuthTokenPayload | null> {
  const secureCookie = shouldUseSecureCookie(req);
  const first = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie,
  });
  if (first) return first as AuthTokenPayload;

  // Bearer tokens forwarded from the Chrome extension are raw Auth.js JWT cookie
  // values. Production cookies use the "__Secure-" salt; local HTTP cookies do
  // not. Try the opposite salt as a compatibility fallback.
  const fallback = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie: !secureCookie,
  });
  return fallback ? (fallback as AuthTokenPayload) : null;
}

export async function getAuthBearerEmail(req: NextRequest): Promise<string | null> {
  if (!hasBearerToken(req)) return null;
  const token = await getDecodedToken(req);
  return typeof token?.email === "string" && token.email.length > 0
    ? token.email
    : null;
}

export async function getRawSessionToken(req: NextRequest): Promise<{
  email: string;
  expiresAt: number | null;
  token: string;
} | null> {
  const secureCookie = shouldUseSecureCookie(req);
  const decoded = await getDecodedToken(req);
  const email =
    typeof decoded?.email === "string" && decoded.email.length > 0
      ? decoded.email
      : null;
  if (!email) return null;

  const raw =
    (await getToken({
      req,
      secret: process.env.AUTH_SECRET,
      secureCookie,
      raw: true,
    })) ??
    (await getToken({
      req,
      secret: process.env.AUTH_SECRET,
      secureCookie: !secureCookie,
      raw: true,
    }));
  if (typeof raw !== "string" || raw.length === 0) return null;

  const expiresAt =
    typeof decoded?.exp === "number"
      ? decoded.exp
      : typeof decoded?.expiresAt === "number"
        ? decoded.expiresAt
        : null;
  return { email, expiresAt, token: raw };
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: number;
}> {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET not configured");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`token refresh failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (
    typeof data.access_token !== "string" ||
    typeof data.expires_in !== "number"
  ) {
    throw new Error("token refresh returned invalid payload");
  }
  return {
    accessToken: data.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}

export async function getCalendarAccessToken(
  req: NextRequest,
): Promise<string> {
  const token = await getDecodedToken(req);
  if (!token) {
    throw new Error("unauthenticated");
  }
  if (token.error === "RefreshAccessTokenError") {
    throw new Error("refresh_access_token_error");
  }
  if (typeof token.accessToken !== "string" || token.accessToken.length === 0) {
    throw new Error("access_token_missing");
  }
  // getToken() decodes the JWT but does not run the jwt callback / refresh.
  // Bearer requests from the extension do not pass through Auth.js either, so
  // refresh here from the JWT's refreshToken when the access token is stale.
  if (
    typeof token.expiresAt !== "number" ||
    Date.now() >= token.expiresAt * 1000
  ) {
    if (typeof token.refreshToken !== "string") {
      throw new Error("access_token_expired");
    }
    const refreshed = await refreshGoogleAccessToken(token.refreshToken);
    return refreshed.accessToken;
  }
  return token.accessToken;
}
