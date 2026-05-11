// where: lib/origin-guard.ts
// what:  Same-origin CSRF guard for our custom POST API routes (/api/extract, /api/calendar/*).
// why:   Auth.js v5 ships its own CSRF for /api/auth/*, but our handcrafted routes need their
//        own check. We compare Origin host against AUTH_URL host and the request's self host
//        (x-forwarded-host or host). Sec-Fetch-Site = same-origin / same-site is also accepted
//        when Origin is absent (some browsers omit Origin on same-origin POSTs).
//        Any URL parse failure or mismatch throws, which the route translates to HTTP 403.

import type { NextRequest } from "next/server";

export class OriginGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OriginGuardError";
  }
}

function safeHost(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    return new URL(input).host;
  } catch {
    return null;
  }
}

export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");

  // Both absent → cannot verify anything → reject.
  if (!origin && !fetchSite) {
    throw new OriginGuardError("missing origin and sec-fetch-site");
  }

  // Cross-site is an unambiguous reject regardless of Origin.
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
    throw new OriginGuardError(`sec-fetch-site=${fetchSite}`);
  }

  // If Origin is present, host must match either AUTH_URL or self.
  if (origin) {
    const originHost = safeHost(origin);
    if (!originHost) {
      throw new OriginGuardError("origin is not a valid URL");
    }

    const authUrlEnv = process.env.AUTH_URL;
    const authHost = authUrlEnv ? safeHost(authUrlEnv) : null;

    const forwarded = req.headers.get("x-forwarded-host");
    const hostHeader = req.headers.get("host");
    const selfHost = forwarded ?? hostHeader ?? null;

    if (originHost !== authHost && originHost !== selfHost) {
      throw new OriginGuardError(
        `origin host mismatch: ${originHost} not in [${authHost ?? "-"}, ${selfHost ?? "-"}]`,
      );
    }
    return;
  }

  // Origin is absent but Sec-Fetch-Site says same-origin / same-site → trust the browser.
  // (Already filtered cross-site above.)
}
