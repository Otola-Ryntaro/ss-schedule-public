// where: lib/auth-bypass.ts
// what:  Helpers for the SS-011 E2E_AUTH_BYPASS Credentials Provider.
//        Constructs a Credentials Provider only when E2E_AUTH_BYPASS === "1",
//        so production builds never register a non-OAuth sign-in path.
// why:   Lives outside auth.ts so __tests__/auth-bypass.test.ts can import the
//        guard helpers without triggering NextAuth() at module load (NextAuth()
//        pulls in next/server which jsdom can't resolve under vitest).

import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";

// NextAuthConfig["providers"][number] is the canonical accepted shape for the
// providers array. Using it avoids a brittle `as CredentialsConfig` cast that
// reaches into @auth/core internals (which churn between beta versions).
type ProviderInput = NonNullable<NextAuthConfig["providers"]>[number];

/**
 * Returns true iff process.env (or the env passed in) opts into the E2E bypass.
 * Strict equality with "1" — any other value (including "true", "yes") leaves
 * the bypass off.
 */
export function isE2EAuthBypassEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.E2E_AUTH_BYPASS === "1";
}

/**
 * Build the bypass provider array (length 0 or 1). Spread into the NextAuth
 * providers list. The constructor is invoked only when the bypass is on, so a
 * production bundle that never sets E2E_AUTH_BYPASS=1 never even constructs
 * the provider object.
 */
export function buildE2EBypassProviders(
  env: NodeJS.ProcessEnv = process.env,
): ProviderInput[] {
  if (!isE2EAuthBypassEnabled(env)) return [];
  return [
    Credentials({
      name: "E2E Bypass",
      credentials: {
        email: { label: "Email", type: "email" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string" ? credentials.email : null;
        if (!email) return null;
        return {
          id: `e2e:${email}`,
          email,
          name: "E2E User",
        };
      },
    }),
  ];
}
