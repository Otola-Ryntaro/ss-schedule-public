// where: types/next-auth.d.ts
// what:  Augment Auth.js v5 Session/JWT types. Session exposes only `error` to the client.
// why:   accessToken / refreshToken stay server-side in the JWT (read via next-auth/jwt getToken),
//        per the OAuth design rule in CLAUDE.md ("session に accessToken を露出しない").

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    error?: "RefreshAccessTokenError";
    user?: DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: "RefreshAccessTokenError";
  }
}

export {};
