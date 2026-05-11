// where: lib/api-guards.ts
// what:  Thin route guards shared by /api/extract and /api/calendar/* — same-origin (CSRF),
//        auth + email narrowing, and rate-limit. Each helper either returns a 4xx Response
//        (so the caller can `return` it directly) or null / a value to continue.
// why:   SS-006 had this logic inlined in the extract route; SS-007 introduces two more
//        routes that need the same guards. Centralising here keeps the routes thin and
//        ensures consistent error shapes / status codes.

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getAuthBearerEmail } from "@/lib/auth-token";
import { assertSameOrigin, OriginGuardError } from "@/lib/origin-guard";
import { checkRate } from "@/lib/rate-limit";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

export type AuthResult = {
  email: string;
  mode: "bearer" | "cookie";
};

function jsonError(status: number, error: string): Response {
  return NextResponse.json({ ok: false, error }, { status });
}

// CSRF guard. Returns a 403 Response on failure, or null on success.
// Non-OriginGuardError exceptions are rethrown so genuine bugs are not swallowed.
export function requireSameOrigin(req: NextRequest): Response | null {
  try {
    assertSameOrigin(req);
    return null;
  } catch (err) {
    if (err instanceof OriginGuardError) {
      return jsonError(403, "forbidden");
    }
    throw err;
  }
}

// Auth guard. Returns { email, mode } when authenticated, or a 401 Response.
// Email is narrowed from the session shape so callers can use it directly without re-checking.
export async function requireAuth(req?: NextRequest): Promise<AuthResult | Response> {
  if (req) {
    const bearerEmail = await getAuthBearerEmail(req);
    if (bearerEmail) {
      return { email: bearerEmail, mode: "bearer" };
    }
  }

  const session = await auth();
  const email =
    session && typeof session === "object" && "user" in session
      ? (session as { user?: { email?: string | null } }).user?.email ?? null
      : null;
  if (!email) {
    return jsonError(401, "unauthorized");
  }
  return { email, mode: "cookie" };
}

// Rate-limit guard. Returns 429 Response when the user has exceeded the per-minute window,
// or null otherwise. Limit (10/min) matches the SS-006 ticket spec.
export function requireRateLimit(email: string): Response | null {
  if (!checkRate(email, Date.now(), RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return jsonError(429, "too many requests");
  }
  return null;
}
