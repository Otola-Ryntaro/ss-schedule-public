// where: proxy.ts (Next.js 16, formerly middleware.ts)
// what:  Add per-request security headers and redirect unauthenticated users to
//        sign-in for the /preview UI route only.
// why:   Auth.js v5 exports `auth` as a request proxy; calling auth(handler) wraps
//        handler with a populated `req.auth` so we can branch on session presence
//        without re-decoding the JWT.
//
//        SS-013 finding: /api/* must NOT be in this matcher. API routes are
//        consumed by HTTP clients that expect 401 JSON responses, NOT redirects.
//        Each /api/calendar/* route already enforces auth via lib/api-guards.ts
//        `requireAuth()` which returns 401 + `{ok:false,error:"unauthorized"}`.
//        Adding API paths here would replace those 401s with 307 redirects to
//        /api/auth/signin and break the SS-013 acceptance criterion that
//        "/api/* unauthenticated access returns 401".

import { auth } from "@/auth";
import { NextResponse } from "next/server";

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "object-src 'none'",
  ].join("; ");
}

export default auth((req) => {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  if (req.nextUrl.pathname === "/preview" && !req.auth) {
    const signInUrl = new URL("/api/auth/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.href);
    const response = NextResponse.redirect(signInUrl);
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
});

export const config = {
  // Apply dynamic CSP to app/API routes. Auth redirects still only happen for
  // /preview; /api/* auth is enforced inside each route handler.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|opengraph-image.png|manifest.json|.*\\..*).*)"],
};
