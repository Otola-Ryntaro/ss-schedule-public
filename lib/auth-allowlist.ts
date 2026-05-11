// where: lib/auth-allowlist.ts
// what:  Email allowlist helper for signIn callback.
// why:   Extracted from auth.ts so the logic is unit-testable without instantiating NextAuth.
//        ALLOWED_EMAILS env is comma-separated; unset = fail-closed (deny all).

export function getAllowedEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!email) return false;
  const allowed = getAllowedEmails(env);
  // Fail-closed: if env is unset or empty, deny everyone.
  if (allowed.length === 0) return false;
  return allowed.includes(email.toLowerCase());
}
