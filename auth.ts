// where: auth.ts (project root, NextAuth v5 convention)
// what:  Auth.js v5 with Google Provider, minimum-scope Calendar OAuth, and JWT-side token refresh.
//        SS-011: When E2E_AUTH_BYPASS=1, also register a Credentials Provider so Playwright
//        can sign in via the standard Auth.js flow without hitting real Google OAuth.
// why:   accessToken/refreshToken/expiresAt live in the JWT only. The session callback exposes
//        nothing about tokens — only an `error` flag for refresh failures. Calendar API routes
//        retrieve the access token via lib/auth-token.ts (next-auth/jwt getToken), not via session.
//        The Credentials Provider is gated on `E2E_AUTH_BYPASS === "1"` so it cannot ship in
//        production builds (guarded by __tests__/auth-bypass.test.ts).

import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { buildE2EBypassProviders } from "@/lib/auth-bypass";
import { isEmailAllowed } from "@/lib/auth-allowlist";

const GOOGLE_CALENDAR_SCOPE = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
].join(" ");

async function refreshGoogleAccessToken(refreshToken: string) {
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
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  return {
    accessToken: data.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
    // Google may or may not rotate the refresh token; keep the old one if not returned.
    refreshToken: data.refresh_token ?? refreshToken,
  };
}

const googleProvider = Google({
  authorization: {
    params: {
      scope: GOOGLE_CALENDAR_SCOPE,
      access_type: "offline",
      prompt: "consent",
    },
  },
});

const providers: NextAuthConfig["providers"] = [
  googleProvider,
  ...buildE2EBypassProviders(),
];

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  // SS-013 fix: explicit JWT strategy (Vercel deploys without DB Adapter need this
  // to avoid Auth.js falling back to "database" inference and emitting
  // CallbackRouteError. Also prevents the session callback from receiving an
  // undefined `token` when the strategy isn't pinned).
  session: { strategy: "jwt" },
  // SS-013 fix: Vercel routes requests through a proxy, so the `Host` header
  // arrives via X-Forwarded-Host. Auth.js v5 rejects unknown hosts unless we
  // either set this flag or pass a verbatim AUTH_URL — we do both for safety
  // (AUTH_URL is also configured in env).
  trustHost: true,
  callbacks: {
    async signIn({ user, account }) {
      // E2E bypass (Credentials provider) skips the allowlist.
      if (account?.provider === "credentials") return true;
      return isEmailAllowed(user?.email);
    },
    async jwt({ token, account }) {
      // Initial sign-in via Credentials (E2E only): stamp a fake access token so
      // lib/auth-token.ts has something to read. Real API calls are mocked at the
      // Playwright layer, so the value itself is never sent to Google.
      if (account?.provider === "credentials") {
        return {
          ...token,
          accessToken: "e2e-fake-access-token",
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          refreshToken: undefined,
          error: undefined,
        };
      }

      // Initial sign-in via Google: persist tokens issued by Google into the JWT.
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
        };
      }

      // Subsequent calls: return existing token if still valid.
      if (
        typeof token.expiresAt === "number" &&
        Date.now() < token.expiresAt * 1000
      ) {
        return token;
      }

      // Expired: try to refresh. Credentials sessions have no refresh token, so
      // they fall through to the error branch — but the 1-hour `expiresAt` keeps
      // the E2E flow stable for the duration of a Playwright run.
      if (typeof token.refreshToken !== "string") {
        return { ...token, error: "RefreshAccessTokenError" as const };
      }
      try {
        const refreshed = await refreshGoogleAccessToken(token.refreshToken);
        return { ...token, ...refreshed, error: undefined };
      } catch {
        return { ...token, error: "RefreshAccessTokenError" as const };
      }
    },
    async session({ session, token }) {
      // Do not expose access/refresh tokens to the client. Surface only the error flag.
      if (token.error === "RefreshAccessTokenError") {
        session.error = "RefreshAccessTokenError";
      }
      return session;
    },
  },
});
